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
  if (typeof tx.confirmations === 'number' && tx.confirmations < 1) {
    return 'Transaction has no confirmations yet.'
  }

  const to = normalizeAddress(tx.to ?? tx.recipientAddress)
  if (to !== normalizeAddress(config.merchantAddress)) {
    return 'Payment did not go to the merchant address.'
  }

  const value = Number(tx.value ?? 0)
  if (!Number.isFinite(value) || value < expected.priceLuna) {
    return `Payment amount too low: ${value} luna < ${expected.priceLuna} luna.`
  }

  const data = (tx.data ?? tx.extraData ?? '').trim()
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

  let lastReason = 'Transaction not found on any network (it may still be unconfirmed, try again in a moment).'

  for (const net of networks) {
    const tx = await fetchTx(net.url, txHash)
    if (!tx) continue

    const problem = checkTx(tx, expected)
    if (problem === null) {
      return { ok: true, network: net.name }
    }
    // Found on this chain but failed a check — a hash only exists on the
    // chain it was broadcast to, so this is the real answer, but keep the
    // loop going in the (vanishingly unlikely) cross-chain hash collision.
    lastReason = `${net.name}: ${problem}`
  }

  return { ok: false, reason: lastReason }
}
