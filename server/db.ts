import fs from 'node:fs'
import path from 'node:path'
import { config } from './config.ts'

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

/**
 * Tiny JSON file store. A competition app with modest traffic does not
 * need more — atomic writes keep it crash-safe.
 */
class Store {
  private db!: DB
  private file = path.join(config.dataDir, 'db.json')

  load(): DB {
    if (this.db) return this.db
    try {
      this.db = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as DB
    }
    catch {
      this.db = { devices: {}, payments: {}, usedTxHashes: {} }
    }
    return this.db
  }

  save(): void {
    fs.mkdirSync(config.dataDir, { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2))
    fs.renameSync(tmp, this.file)
  }
}

export const store = new Store()
