export interface SessionState {
  deviceId: string
  freeRemaining: number
  credits: number
  packs: { id: string, label: string, priceLuna: number, credits: number }[]
  merchantAddress: string | null
  aiConfigured: boolean
  testnetCreditCap?: number
}

export interface CheckoutSession {
  sessionId: string
  memo: string
  recipient: string
  priceLuna: number
  credits: number
}

export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

async function json<T>(resOrPromise: Response | Promise<Response>): Promise<T> {
  const res = await resOrPromise
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: '' })) as { error?: string, code?: string }
    const message = body?.error || res.statusText || `Request failed (${res.status})`
    const err = new Error(message) as Error & { code?: string, status?: number }
    err.code = body?.code
    err.status = res.status
    throw err
  }
  return res.json() as Promise<T>
}

export function startSession(deviceId: string): Promise<SessionState> {
  return json(fetch('/api/session', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId }),
  }).then(r => r))
}

export function createCheckout(deviceId: string, packId: string, network?: string): Promise<CheckoutSession> {
  return json(fetch('/api/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, packId, network }),
  }).then(r => r))
}

export function confirmCheckout(sessionId: string, txHash: string, deviceId: string): Promise<{ ok: boolean, credits: number, pending?: boolean, reason?: string }> {
  return json(fetch('/api/confirm', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, txHash, deviceId }),
  }).then(r => r))
}

/**
 * Stream an AI answer. Calls onDelta for each text chunk and onDone
 * once the server reports the remaining balance.
 */
export async function streamChat(
  deviceId: string,
  messages: ChatMessage[],
  preset: string | undefined,
  onDelta: (text: string) => void,
): Promise<{ freeRemaining: number, credits: number }> {
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, messages, preset }),
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText })) as { error?: string, code?: string }
    const err = new Error(body.error ?? res.statusText) as Error & { code?: string }
    err.code = body.code
    throw err
  }

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let final = { freeRemaining: 0, credits: 0 }

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE frames are separated by a blank line
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const dataLines = frame.split('\n')
        .filter(l => l.startsWith('data:'))
        // SSE spec: exactly one space after "data:". Strip only that one
        // space — token deltas like " there" carry meaningful leading spaces.
        .map(l => (l.startsWith('data: ') ? l.slice(6) : l.slice(5)))
        .join('\n')
      const eventLine = frame.split('\n').find(l => l.startsWith('event:'))
      const event = eventLine?.slice(6).trim()

      if (event === 'done') {
        final = JSON.parse(dataLines) as typeof final
      }
      else if (event === 'error') {
        throw new Error(dataLines)
      }
      else if (dataLines) {
        onDelta(dataLines)
      }
    }
  }
  return final
}
