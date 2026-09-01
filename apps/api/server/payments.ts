import { config } from './config'

/**
 * Verifies a NIM payment on-chain via the Nimiq JSON-RPC API.
 *
 * The frontend sends the payment with `sendBasicTransactionWithData`
 * (the memo tags the checkout session), then hands us the tx hash.
 * We independently confirm on-chain that:
 *   1. the transaction exists and has at least one confirmation
 *   2. it was sent TO our merchant address
 *   3. the value covers the pack price
 *   4. the attached data matches the session memo
 *
 * The server probes BOTH networks with the tx hash — a transaction hash
 * only confirms on the chain where the payment actually happened, so the
 * chain decides, never the client. Mainnet payments earn real credits;
 * testnet payments (free faucet NIM) earn capped credits for testing.
 */
export interface VerifyResult {
  ok: boolean
  /** Which chain the payment was found and verified on (when ok). */
  network?: 'mainnet' | 'testnet'
  /** The transaction was seen on-chain but isn't final yet — it is
   *  safe for the caller to retry. (e.g. still propagating or the
   *  block isn't confirmed yet.) */
  pending?: boolean
  reason?: string
}

interface NimiqTx {
  from?: string
  to?: string
  /** Address aliases seen across RPC variants / envelope wrappers. */
  recipientAddress?: string
  recipient?: string
  sender?: string
  senderAddress?: string
  value?: number | string
  /** Memo on a Nimiq basic transaction is delivered as the recipientData
   *  field, HEX-encoded (the bytes of the UTF-8 data payload). Some RPC
   *  wrappers also expose it as `data`/`extraData`. */
  data?: string
  extraData?: string
  recipientData?: string
  senderData?: string
  confirmations?: number
  blockNumber?: number
}

const normalizeAddress = (a: string | undefined) => (a ?? '').replace(/\s+/g, '').toUpperCase()

/** Decodes a Nimiq RPC data field back to its UTF-8 memo.
 *  Nimiq serializes raw bytes (tx data) as hex; if a particular endpoint
 *  already returns plain UTF-8, we leave non-hex strings untouched. */
function decodeData(hex: string | undefined): string {
  if (!hex) return ''
  let h = hex.trim()
  if (h.startsWith('0x') || h.startsWith('0X')) h = h.slice(2)
  h = h.replace(/\s+/g, '')
  if (h.length === 0) return ''
  // Not hex (e.g. already UTF-8 text) → hand it back as-is.
  if (!/^[0-9a-fA-F]+$/.test(h)) return hex.trim()
  if (h.length % 2 !== 0) h = '0' + h        // right-align odd nibble (defensive)
  try {
    return Buffer.from(h, 'hex').toString('utf8').replace(/\x00+$/g, '')
  }
  catch {
    return ''
  }
}

/** Some Nimiq JSON-RPC servers wrap results in a { data, metadata } envelope. */
function unwrap(result: unknown): NimiqTx | null {
  if (result === null || result === undefined) return null
  if (typeof result === 'object' && result !== null && 'data' in result) {
    const inner = (result as { data?: unknown }).data
    if (inner && typeof inner === 'object') return inner as NimiqTx
    return null
  }
  return result as NimiqTx
}

async function fetchTx(rpcUrl: string, txHash: string): Promise<NimiqTx | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getTransactionByHash',
        params: [txHash],
      }),
      signal: AbortSignal.timeout(15_000),
    })
    const json = await res.json() as { result?: unknown, error?: unknown }
    return unwrap(json.result)
  }
  catch {
    return null
  }
}

function checkTx(tx: NimiqTx, expected: { priceLuna: number, memo: string }): string | null {
  const to = normalizeAddress(tx.to ?? tx.recipient ?? tx.recipientAddress)
  if (to !== normalizeAddress(config.merchantAddress)) {
    return 'Payment did not go to the merchant address.'
  }

  const value = Number(tx.value ?? 0)
  if (!Number.isFinite(value) || value < expected.priceLuna) {
    return `Payment amount too low: ${value} luna < ${expected.priceLuna} luna.`
  }

  // The memo rides along as the transaction's recipientData, which Nimiq RPC
  // hex-encodes. Verified live: this RPC exposes NO `data` key at all — only
  // senderData/recipientData — so pick the first non-empty candidate rather
  // than the first non-nullish ("" would otherwise shadow the real memo).
  const memoRaw = [tx.recipientData, tx.data, tx.extraData, tx.senderData]
    .find(v => typeof v === 'string' && v.length > 0) ?? ''
  const data = decodeData(memoRaw)
  if (data !== expected.memo) {
    return 'Payment memo does not match the checkout session.'
  }

  return null
}

export async function verifyPayment(
  txHash: string,
  expected: { priceLuna: number, memo: string },
): Promise<VerifyResult> {
  if (!config.merchantAddress) {
    return { ok: false, reason: 'MERCHANT_NIM_ADDRESS is not configured on the server.' }
  }

  const networks = [
    { name: 'mainnet' as const, url: config.nimiqRpcUrl },
    { name: 'testnet' as const, url: config.testnetRpcUrl },
  ].filter(n => Boolean(n.url))

  let pendingReason = 'We cannot see your transaction yet; it may still be propagating. Try again in a moment.'

  for (const net of networks) {
    const tx = await fetchTx(net.url, txHash)
    if (!tx) continue                                  // not on this chain — maybe pending elsewhere

    // Seen on this chain but not confirmed yet: safe to retry (mining takes ~1-2 min).
    const conf = tx.confirmations
    if (typeof conf !== 'number' || conf < 1) {
      return {
        ok: false,
        pending: true,
        reason: 'Transaction is not yet confirmed on-chain. Try again in a moment.',
      }
    }

    const problem = checkTx(tx, expected)
    if (problem === null) {
      return { ok: true, network: net.name }
    }
    // Confirmed on this chain but failed a check — a hash only exists on the
    // chain it was broadcast to, so this is the real answer.
    return { ok: false, reason: `${net.name}: ${problem}` }
  }

  // Not found on any configured network → still propagating (retriable).
  return { ok: false, pending: true, reason: pendingReason }
}
