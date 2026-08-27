import { config } from './config.ts'

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
 * This is the same server-side-verification pattern the Cycle I
 * winners used — never trust the client's claim of having paid.
 */
export interface VerifyResult {
  ok: boolean
  reason?: string
}

interface NimiqTx {
  from?: string
  to?: string
  recipientAddress?: string
  senderAddress?: string
  value?: number | string
  data?: string
  extraData?: string
  confirmations?: number
  blockNumber?: number
}

const normalizeAddress = (a: string | undefined) => (a ?? '').replace(/\s+/g, '').toUpperCase()

export async function verifyPayment(
  txHash: string,
  expected: { priceLuna: number, memo: string },
): Promise<VerifyResult> {
  if (!config.merchantAddress) {
    return { ok: false, reason: 'MERCHANT_NIM_ADDRESS is not configured on the server.' }
  }

  let tx: NimiqTx
  try {
    const res = await fetch(config.nimiqRpcUrl, {
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
    const json = await res.json() as { result?: NimiqTx | null, error?: unknown }
    if (!json.result) return { ok: false, reason: 'Transaction not found on-chain (yet).' }
    tx = json.result
  }
  catch (err) {
    return { ok: false, reason: `RPC request failed: ${err instanceof Error ? err.message : 'unknown error'}` }
  }

  if (typeof tx.confirmations === 'number' && tx.confirmations < 1) {
    return { ok: false, reason: 'Transaction has no confirmations yet.' }
  }

  const to = normalizeAddress(tx.to ?? tx.recipientAddress)
  if (to !== normalizeAddress(config.merchantAddress)) {
    return { ok: false, reason: 'Payment did not go to the merchant address.' }
  }

  const value = Number(tx.value ?? 0)
  if (!Number.isFinite(value) || value < expected.priceLuna) {
    return { ok: false, reason: `Payment amount too low: ${value} luna < ${expected.priceLuna} luna.` }
  }

  const data = (tx.data ?? tx.extraData ?? '').trim()
  if (data !== expected.memo) {
    return { ok: false, reason: 'Payment memo does not match the checkout session.' }
  }

  return { ok: true }
}
