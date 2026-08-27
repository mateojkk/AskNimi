import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { streamSSE } from 'hono/streaming'
import { existsSync } from 'node:fs'
import { config } from './config.ts'
import { store, type DeviceRecord } from './db.ts'
import { streamChat, type ChatTurn } from './ai.ts'
import { verifyPayment } from './payments.ts'

const db = store.load()
const app = new Hono()

// ── helpers ────────────────────────────────────────────────────────────

const randomId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function getOrCreateDevice(deviceId: string): DeviceRecord {
  if (!db.devices[deviceId]) {
    db.devices[deviceId] = { freeUsed: 0, credits: 0, createdAt: new Date().toISOString() }
    store.save()
  }
  return db.devices[deviceId]
}

function remainingFree(rec: DeviceRecord): number {
  return Math.max(0, config.freeMessages - rec.freeUsed)
}

/** Naive in-memory rate limiter: 20 requests per minute per device */
const hits = new Map<string, number[]>()
function rateLimited(deviceId: string): boolean {
  const now = Date.now()
  const window = (hits.get(deviceId) ?? []).filter(t => now - t < 60_000)
  window.push(now)
  hits.set(deviceId, window)
  return window.length > 20
}

const packById = (id: string) => config.packs.find(p => p.id === id)

// ── session / state ────────────────────────────────────────────────────

app.post('/api/session', async (c) => {
  const { deviceId } = await c.req.json<{ deviceId?: string }>()
  if (!deviceId) return c.json({ error: 'deviceId required' }, 400)

  const rec = getOrCreateDevice(deviceId)
  return c.json({
    deviceId,
    freeRemaining: remainingFree(rec),
    credits: rec.credits,
    packs: config.packs,
    merchantAddress: config.merchantAddress || null,
    aiConfigured: Boolean(config.groqApiKey),
  })
})

// ── checkout: create a payment session ─────────────────────────────────

app.post('/api/checkout', async (c) => {
  const { deviceId, packId } = await c.req.json<{ deviceId?: string, packId?: string }>()
  const pack = packById(packId ?? '')
  if (!deviceId || !pack) return c.json({ error: 'deviceId and valid packId required' }, 400)
  if (!config.merchantAddress) return c.json({ error: 'Payments not configured yet.' }, 503)

  const sessionId = randomId()
  const memo = `asknim:${sessionId}`
  db.payments[sessionId] = {
    deviceId,
    packId: pack.id,
    priceLuna: pack.priceLuna,
    credits: pack.credits,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  store.save()

  return c.json({
    sessionId,
    memo,
    recipient: config.merchantAddress,
    priceLuna: pack.priceLuna,
    credits: pack.credits,
  })
})

// ── checkout: confirm with the on-chain tx hash ────────────────────────

app.post('/api/checkout/:sessionId/confirm', async (c) => {
  const sessionId = c.req.param('sessionId')
  const { txHash, deviceId } = await c.req.json<{ txHash?: string, deviceId?: string }>()
  const payment = db.payments[sessionId]

  if (!payment || payment.deviceId !== deviceId) {
    return c.json({ error: 'Unknown checkout session.' }, 404)
  }
  if (payment.status === 'confirmed') {
    const rec = getOrCreateDevice(deviceId ?? payment.deviceId)
    return c.json({ ok: true, credits: rec.credits, alreadyConfirmed: true })
  }
  if (!txHash) return c.json({ error: 'txHash required' }, 400)

  const result = await verifyPayment(txHash, {
    priceLuna: payment.priceLuna,
    memo: `asknim:${sessionId}`,
  })

  if (!result.ok) {
    payment.status = 'rejected'
    payment.rejectionReason = result.reason
    payment.txHash = txHash
    store.save()
    return c.json({ error: result.reason }, 400)
  }

  // Replay protection: the same tx may never fund two sessions
  if (db.usedTxHashes[txHash]) {
    return c.json({ error: 'Transaction already used for another purchase.' }, 400)
  }

  payment.status = 'confirmed'
  payment.txHash = txHash
  payment.confirmedAt = new Date().toISOString()
  db.usedTxHashes[txHash] = true

  const rec = getOrCreateDevice(payment.deviceId)
  rec.credits += payment.credits
  store.save()

  return c.json({ ok: true, credits: rec.credits })
})

// ── chat: metered, streamed ────────────────────────────────────────────

app.post('/api/chat', async (c) => {
  const body = await c.req.json<{
    deviceId?: string
    messages?: ChatTurn[]
    preset?: string
  }>()
  const deviceId = body.deviceId
  const turns = Array.isArray(body.messages) ? body.messages : []

  if (!deviceId) return c.json({ error: 'deviceId required' }, 400)
  if (rateLimited(deviceId)) return c.json({ error: 'Slow down a moment.' }, 429)
  if (turns.length === 0) return c.json({ error: 'messages required' }, 400)
  if ((turns[turns.length - 1]?.content ?? '').length > config.maxMessageChars) {
    return c.json({ error: `Message too long (max ${config.maxMessageChars} chars).` }, 400)
  }

  const rec = getOrCreateDevice(deviceId)
  const free = remainingFree(rec) > 0
  if (!free && rec.credits <= 0) {
    return c.json({ error: 'Out of credits', code: 'NEEDS_TOPUP' }, 402)
  }

  // Meter first (in-process atomic), refund if generation fails
  if (free) rec.freeUsed += 1
  else rec.credits -= 1
  store.save()

  return streamSSE(c, async (sse) => {
    try {
      await streamChat(turns, body.preset, delta => sse.write(delta))
      await sse.writeSSE({
        event: 'done',
        data: JSON.stringify({ freeRemaining: remainingFree(rec), credits: rec.credits }),
      })
    }
    catch (err) {
      // Refund the metered message on server-side failure
      if (free) rec.freeUsed -= 1
      else rec.credits += 1
      store.save()
      await sse.writeSSE({
        event: 'error',
        data: String(err instanceof Error ? err.message : err),
      })
    }
  })
})

app.get('/api/health', c => c.json({ ok: true, aiConfigured: Boolean(config.groqApiKey) }))

// ── static frontend (production) ───────────────────────────────────────

if (existsSync('dist')) {
  app.use('*', serveStatic({ root: 'dist' }))
  app.get('*', serveStatic({ root: 'dist', rewriteRequestPath: () => '/index.html' }))
}

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AskNim API listening on http://localhost:${info.port}`)
  console.log(`  AI: ${config.groqApiKey ? `Groq (${config.groqModel})` : 'echo mode — set GROQ_API_KEY'}`)
  console.log(`  Merchant: ${config.merchantAddress || 'NOT CONFIGURED — payments disabled'}`)
})

