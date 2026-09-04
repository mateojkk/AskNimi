import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { config } from './config'
import { readDb, writeDb, storeMode, type DB, type DeviceRecord } from './store'
import { streamChat, type ChatTurn } from './ai'
import { verifyPayment } from './payments'

export const app = new Hono()

// ── helpers ────────────────────────────────────────────────────────────

const randomId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`

function getOrCreateDevice(db: DB, deviceId: string): DeviceRecord {
  if (!db.devices[deviceId]) {
    db.devices[deviceId] = { freeUsed: 0, credits: 0, createdAt: new Date().toISOString() }
  }
  return db.devices[deviceId]
}

const remainingFree = (rec: DeviceRecord) =>
  Math.max(0, config.freeMessages - rec.freeUsed)

/** Naive in-memory rate limiter: 20 requests per minute per device.
 *  Per-instance on serverless — a soft guardrail, not a hard limit. */
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

  const db = await readDb()
  const rec = getOrCreateDevice(db, deviceId)
  await writeDb(db)

  return c.json({
    deviceId,
    freeRemaining: remainingFree(rec),
    credits: rec.credits,
    packs: config.packs,
    merchantAddress: config.merchantAddress || null,
    aiConfigured: Boolean(config.groqApiKey),
    testnetCreditCap: config.testnetCreditCap,
  })
})

// ── checkout: create a payment session ─────────────────────────────────

app.post('/api/checkout', async (c) => {
  const { deviceId, packId } = await c.req.json<{ deviceId?: string, packId?: string }>()
  const pack = packById(packId ?? '')
  if (!deviceId || !pack) return c.json({ error: 'deviceId and valid packId required' }, 400)
  if (!config.merchantAddress) return c.json({ error: 'Payments not configured yet.' }, 503)

  const db = await readDb()
  const rec = getOrCreateDevice(db, deviceId)
  if (rec.credits >= config.testnetCreditCap) {
    return c.json({
      error: `You already have ${rec.credits} answers (maximum limit: ${config.testnetCreditCap}). Use some answers before topping up again.`
    }, 400)
  }

  const sessionId = randomId()
  // Nimiq caps tx data at 64 bytes for basic-address recipients; a memo that
  // exceeds it would be rejected on-chain and then fail verification with an
  // opaque "memo mismatch". Fail loudly here instead. (Current format ≈26 B.)
  const memo = `asknim:${sessionId}`
  if (Buffer.byteLength(memo, 'utf8') > 64) {
    return c.json({ error: 'Checkout memo too long for on-chain data (64-byte cap).' }, 500)
  }
  db.payments[sessionId] = {
    deviceId,
    packId: pack.id,
    priceLuna: pack.priceLuna,
    credits: pack.credits,
    status: 'pending',
    createdAt: new Date().toISOString(),
  }
  await writeDb(db)

  return c.json({
    sessionId,
    memo,
    recipient: config.merchantAddress,
    priceLuna: pack.priceLuna,
    credits: pack.credits,
  })
})

// ── checkout: confirm with the on-chain tx hash ────────────────────────

async function handleConfirm(
  c: Context,
  sessionId: string,
  txHash: string,
  deviceId?: string,
) {
  const db = await readDb()
  const payment = db.payments[sessionId]
  if (!payment || payment.deviceId !== deviceId) {
    return c.json({ error: 'Unknown checkout session.' }, 404)
  }
  if (payment.status === 'confirmed') {
    const rec = getOrCreateDevice(db, deviceId ?? payment.deviceId)
    return c.json({ ok: true, credits: rec.credits, alreadyConfirmed: true })
  }
  if (!txHash) return c.json({ error: 'txHash required' }, 400)

  const result = await verifyPayment(txHash, {
    priceLuna: payment.priceLuna,
    memo: `asknim:${sessionId}`,
  })

  if (!result.ok) {
    // A not-yet-found / not-yet-confirmed transaction is transient: the user
    // just broadcast it and Nimiq mining takes ~1-2 min. Don't gate it behind
    // a permanent 'rejected' record — tell the client to keep polling instead.
    if (result.pending) {
      return c.json({ pending: true, ok: false, reason: result.reason }, 202)
    }
    payment.status = 'rejected'
    payment.rejectionReason = result.reason
    payment.txHash = txHash
    await writeDb(db)
    return c.json({ error: result.reason }, 400)
  }

  // Replay protection: the same tx may never fund two sessions
  if (db.usedTxHashes[txHash]) {
    return c.json({ error: 'Transaction already used for another purchase.' }, 400)
  }

  payment.status = 'confirmed'
  payment.txHash = txHash
  payment.network = result.network
  payment.confirmedAt = new Date().toISOString()
  db.usedTxHashes[txHash] = true

  const rec = getOrCreateDevice(db, payment.deviceId)
  rec.credits += payment.credits
  await writeDb(db)

  return c.json({ ok: true, credits: rec.credits, network: result.network })
}

app.post('/api/confirm', async (c) => {
  const { sessionId, txHash, deviceId } = await c.req.json<{ sessionId?: string, txHash?: string, deviceId?: string }>()
  if (!sessionId) return c.json({ error: 'sessionId required' }, 400)
  return handleConfirm(c, sessionId, txHash ?? '', deviceId)
})

app.post('/api/checkout/:sessionId/confirm', async (c) => {
  const sessionId = c.req.param('sessionId')
  const { txHash, deviceId } = await c.req.json<{ txHash?: string, deviceId?: string }>()
  return handleConfirm(c, sessionId, txHash ?? '', deviceId)
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

  const db = await readDb()
  const rec = getOrCreateDevice(db, deviceId)
  const free = remainingFree(rec) > 0
  if (!free && rec.credits <= 0) {
    return c.json({ error: 'Out of credits', code: 'NEEDS_TOPUP' }, 402)
  }

  // Meter first, refund if generation fails
  if (free) rec.freeUsed += 1
  else rec.credits -= 1
  await writeDb(db)

  return streamSSE(c, async (sse) => {
    try {
      await streamChat(turns, body.preset, delta => sse.writeSSE({ data: delta }))
      await sse.writeSSE({
        event: 'done',
        data: JSON.stringify({ freeRemaining: remainingFree(rec), credits: rec.credits }),
      })
    }
    catch (err) {
      // Refund the metered message on server-side failure
      if (free) rec.freeUsed -= 1
      else rec.credits += 1
      const fresh = await readDb() // re-read to minimize clobbering concurrent updates
      const persisted = fresh.devices[deviceId]
      if (persisted) {
        if (free) persisted.freeUsed -= 1
        else persisted.credits += 1
        await writeDb(fresh)
      }
      await sse.writeSSE({
        event: 'error',
        data: String(err instanceof Error ? err.message : err),
      })
    }
  })
})

app.get('/api/health', c => c.json({
  ok: true,
  aiConfigured: Boolean(config.groqApiKey),
  store: storeMode(),
  merchantConfigured: Boolean(config.merchantAddress),
}))
