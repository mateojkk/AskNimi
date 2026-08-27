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
export async function readDb(): Promise<DB> {
  if (remote()) {
    try {
      const res = await fetch(`${config.upstashUrl}/get/${encodeURIComponent(DB_KEY)}`, {
        headers: { authorization: `Bearer ${config.upstashToken}` },
        signal: AbortSignal.timeout(8000),
      })
      const json = await res.json() as { result: string | null }
      return json.result ? JSON.parse(json.result) as DB : emptyDb()
    }
    catch (err) {
      console.error('[store] remote read failed, using empty db:', err)
      return emptyDb()
    }
  }
  try {
    return JSON.parse(fs.readFileSync(config.dataFile, 'utf-8')) as DB
  }
  catch {
    return emptyDb()
  }
}

export async function writeDb(db: DB): Promise<void> {
  if (remote()) {
    await fetch(`${config.upstashUrl}/set/${encodeURIComponent(DB_KEY)}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${config.upstashToken}` },
      body: JSON.stringify(db),
      signal: AbortSignal.timeout(8000),
    })
    return
  }
  fs.mkdirSync(config.dataDir, { recursive: true })
  const tmp = `${config.dataFile}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2))
  fs.renameSync(tmp, config.dataFile)
}
