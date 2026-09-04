import { init, requestDeviceIdentifier } from '@nimiq/mini-app-sdk'

/**
 * Thin wrapper around the Nimiq Pay Mini App SDK.
 *
 * Outside Nimiq Pay (e.g. a desktop browser during development) the
 * provider never appears and init() times out — callers use
 * `insideNimiqPay()` to fall back to demo mode.
 */

type NimiqProvider = Awaited<ReturnType<typeof init>>

let nimiqPromise: Promise<NimiqProvider> | null = null

export function getNimiq(): Promise<NimiqProvider> {
  nimiqPromise ??= init({ timeout: 10_000 })
  return nimiqPromise
}

export async function insideNimiqPay(): Promise<boolean> {
  try {
    await getNimiq()
    return true
  }
  catch {
    return false
  }
}

/** Ask Nimiq Pay for the user's wallet addresses (triggers a confirmation dialog). */
export async function listAccounts(): Promise<string[]> {
  const nimiq = await getNimiq()
  const res = await nimiq.listAccounts()
  if ('error' in res && res.error) throw new Error(String(res.error.message ?? 'Account request failed'))
  return res as unknown as string[]
}

/**
 * Send a NIM payment with a text memo tagging the checkout session.
 * @returns the transaction hash
 */
export async function payWithMemo(recipient: string, valueLuna: number, memo: string): Promise<string> {
  const nimiq = await getNimiq()
  const res = await nimiq.sendBasicTransactionWithData({
    recipient,
    value: valueLuna,
    data: memo,
  })
  if (typeof res !== 'string') {
    const errObj = (res as { error?: { message?: string, type?: string } }).error
    const message = errObj?.message || errObj?.type || 'Payment was canceled or failed in Nimiq Pay'
    throw new Error(message)
  }
  return res
}

/**
 * Stable pseudonymous per-device id (64-hex SHA-256), scoped to this
 * mini app's origin. First call prompts the user with our reason.
 */
export async function getDeviceId(): Promise<string> {
  return requestDeviceIdentifier({ reason: 'Track your free messages and credit balance' })
}

/** Browser fallback id for demo mode (never used inside Nimiq Pay). */
export function getLocalDeviceId(): string {
  let id = localStorage.getItem('asknim-demo-device')
  if (!id) {
    id = `demo-${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`
    localStorage.setItem('asknim-demo-device', id)
  }
  return id
}

/** Nimiq Pay exposes the user's selected language (ISO 639-1). */
export function payLanguage(): string {
  return (window as any).nimiqPay?.language
    || navigator.language.split('-')[0]
    || 'en'
}

/**
 * Detect whether the user's Nimiq Pay wallet is currently on Testnet or Mainnet.
 * Testnet block height is currently ~10.5M; Mainnet is ~60.7M.
 */
export async function detectNetwork(): Promise<'testnet' | 'mainnet'> {
  try {
    const nimiq = await getNimiq()
    const blockNumber = await nimiq.getBlockNumber()
    return (typeof blockNumber === 'number' && blockNumber > 30_000_000) ? 'mainnet' : 'testnet'
  }
  catch {
    return 'testnet'
  }
}
