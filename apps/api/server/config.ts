import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Minimal .env loader — no dependency needed.
 * Reads the .env next to this package (apps/api/.env) so the server
 * works regardless of the process cwd. Values already present in
 * process.env take precedence.
 */
export function loadEnvFile(): void {
  let file: string
  try {
    file = fileURLToPath(new URL('../.env', import.meta.url))
  }
  catch {
    // Bundled to CJS (e.g. the Vercel serverless build) where
    // import.meta.url does not exist. There, configuration comes from
    // real environment variables — nothing to load from a file.
    return
  }
  try {
    const raw = fs.readFileSync(file, 'utf-8')
    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const eq = trimmed.indexOf('=')
      if (eq === -1) continue
      const key = trimmed.slice(0, eq).trim()
      const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
      if (process.env[key] === undefined && value !== '') {
        process.env[key] = value
      }
    }
  }
  catch {
    // No .env file — fine, rely on real environment variables.
  }
}

loadEnvFile()

export interface CreditPack {
  id: string
  label: string
  /** Price in Luna (1 NIM = 100_000 Luna) */
  priceLuna: number
  /** AI messages granted */
  credits: number
}

export const config = {
  port: Number(process.env.PORT ?? 8787),

  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL ?? 'openai/gpt-oss-120b',

  /** Nimiq JSON-RPC endpoint used to verify incoming payments (mainnet) */
  nimiqRpcUrl: process.env.NIMIQ_RPC_URL ?? 'https://rpc.nimiqwatch.com',

  /** Testnet RPC — probed too, so faucet-NIM payments verify for testing.
   *  Credits from testnet payments are capped by testnetCreditCap. */
  testnetRpcUrl: process.env.NIMIQ_TESTNET_RPC_URL ?? 'https://rpc.testnet.nimiqwatch.com/',

  /** Max credits a device can hold from TESTNET (free faucet NIM) payments */
  testnetCreditCap: Number(process.env.TESTNET_CREDIT_CAP ?? 300),

  /** Your Nimiq wallet address (spaces stripped at load time) */
  merchantAddress: (process.env.MERCHANT_NIM_ADDRESS ?? '').replace(/\s+/g, ''),

  /** Free AI messages for a brand-new device (onboarding) */
  freeMessages: Number(process.env.FREE_MESSAGES ?? 3),

  /** Credit packs offered in the paywall */
  packs: [
    { id: 'starter', label: '1 NIM', priceLuna: 100_000, credits: 50 },
    { id: 'value', label: '5 NIM', priceLuna: 500_000, credits: 300 },
  ] satisfies CreditPack[],

  /** Server-side guardrails */
  maxMessageChars: 2000,
  maxHistoryMessages: 12,
  maxTokens: 1024,

  /** Upstash Redis REST credentials (enables the serverless store) */
  upstashUrl: process.env.UPSTASH_REDIS_REST_URL ?? '',
  upstashToken: process.env.UPSTASH_REDIS_REST_TOKEN ?? '',

  dataDir: path.resolve(process.env.DATA_DIR ?? (process.env.VERCEL ? '/tmp/data' : 'data')),
  dataFile: path.resolve(process.env.DATA_DIR ?? (process.env.VERCEL ? '/tmp/data' : 'data'), 'db.json'),
}
