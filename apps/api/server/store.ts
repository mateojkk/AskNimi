import fs from 'node:fs'
import { config } from './config'

export interface DeviceRecord {
  /** Free messages consumed */
  freeUsed: number
  /** Paid message credits remaining */
  credits: number
  createdAt: string
}

export type PaymentStatus = 'pending' | 'confirmed' | 'rejected'

export interface PaymentRecord {
  deviceId: string
  packId: string
  priceLuna: number
  credits: number
  status: PaymentStatus
  txHash?: string
  rejectionReason?: string
  /** Chain the payment was verified on: 'mainnet' or 'testnet' */
  network?: 'mainnet' | 'testnet'
  createdAt: string
  confirmedAt?: string
}

export interface DB {
  devices: Record<string, DeviceRecord>
  payments: Record<string, PaymentRecord>
  /** Transaction hashes already credited — replay protection */
  usedTxHashes: Record<string, true>
}

const emptyDb = (): DB => ({ devices: {}, payments: {}, usedTxHashes: {} })
const DB_KEY = 'asknim:db'
const remote = () => Boolean(config.upstashUrl && config.upstashToken)

/** Which persistence backend is active — surfaced via /api/health so a
 *  misconfigured deployment is visible immediately. */
export function storeMode(): 'redis' | 'filesystem' {
  return remote() ? 'redis' : 'filesystem'
}

/**
 * Dual-backend data store:
 *  - Local development: a JSON file (atomic tmp+rename writes)
 *  - Vercel/serverless: Upstash Redis via its REST API (the serverless
 *    filesystem is ephemeral and read-only). No SDK — plain fetch.
 *
 * Concurrency note: reads/writes are whole-document. At competition
 * traffic levels this is perfectly fine; if you scale this up, switch
 * to per-key records or a transactional DB.
 */
let memoryDb: DB = emptyDb()

export async function readDb(): Promise<DB> {
  if (remote()) {
    try {
      const res = await fetch(`${config.upstashUrl}/get/${encodeURIComponent(DB_KEY)}`, {
        headers: { authorization: `Bearer ${config.upstashToken}` },
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json() as { result: string | null }
      if (json.result) {
        memoryDb = JSON.parse(json.result) as DB
        return memoryDb
      }
      return memoryDb
    }
    catch (err) {
      console.error('[store] remote read failed, using in-memory db:', err)
      return memoryDb
    }
  }
  try {
    const disk = JSON.parse(fs.readFileSync(config.dataFile, 'utf-8')) as DB
    memoryDb = disk
    return disk
  }
  catch {
    return memoryDb
  }
}

export async function writeDb(db: DB): Promise<boolean> {
  memoryDb = db
  if (remote()) {
    try {
      const res = await fetch(`${config.upstashUrl}/set/${encodeURIComponent(DB_KEY)}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.upstashToken}` },
        body: JSON.stringify(db),
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) throw new Error(`upstash responded ${res.status}`)
      return true
    }
    catch (err) {
      // Never fail the API because persistence failed: the request still
      // works on the in-memory copy of this warm instance. Log loudly —
      // credits/state will not survive to the next cold start.
      console.error('[store] remote write failed (state stays in-memory):', err)
      return false
    }
  }
  // Filesystem backend: fine locally, but on serverless fallback to in-memory + /tmp
  try {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const tmp = `${config.dataFile}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
    fs.renameSync(tmp, config.dataFile)
    return true
  }
  catch (err) {
    console.warn('[store] filesystem write failed (state retained in memory):', err instanceof Error ? err.message : err)
    return false
  }
}
