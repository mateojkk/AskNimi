import { useState } from 'react'
import type { SessionState } from '../lib/api.ts'
import { t, type StringKey } from '../i18n.ts'

interface Props {
  lang: string
  packs: SessionState['packs']
  insidePay: boolean
  onClose: () => void
  onBuy: (packId: string) => Promise<void>
}

const fmt = (luna: number) => (luna / 100_000).toLocaleString('en-US', { maximumFractionDigits: 2 })

export function Paywall({ lang, packs, insidePay, onClose, onBuy }: Props) {
  const [phase, setPhase] = useState<'pick' | 'waiting' | 'verifying' | 'done' | 'failed'>('pick')
  const [failure, setFailure] = useState('')

  const buy = async (packId: string) => {
    if (!insidePay) {
      setFailure('Demo mode: open AskNim inside Nimiq Pay to pay.')
      setPhase('failed')
      return
    }
    try {
      setPhase('waiting')
      await onBuy(packId) // pay + confirm; throws on failure
      setPhase('done')
      setTimeout(onClose, 900)
    }
    catch (err) {
      setFailure(err instanceof Error ? err.message : t(lang, 'paymentFailed'))
      setPhase('failed')
    }
  }

  const label = (key: StringKey) => t(lang, key)

  return (
    <div className="sheet-backdrop" onClick={phase === 'pick' ? onClose : undefined}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        {phase === 'pick' && (
          <>
            <div className="sheet-handle" />
            <h2>{label('needCredits')}</h2>
            <p className="sheet-sub">{label('needCreditsBody')}</p>
            <div className="packs">
              {packs.map((p, i) => (
                <button key={p.id} className={`pack${i === 1 ? ' pack-best' : ''}`} onClick={() => buy(p.id)}>
                  <span className="pack-price">{fmt(p.priceLuna)} NIM</span>
                  <span className="pack-credits">{p.credits} {label('credits').replace(/^\d+\s*/, '')}</span>
                  {i === 1 && <span className="pack-badge">★</span>}
                </button>
              ))}
            </div>
            <p className="sheet-note">{label('payWithNimiq')}</p>
          </>
        )}
        {phase === 'waiting' && <div className="sheet-status">⏳ {label('waitingPayment')}</div>}
        {phase === 'verifying' && <div className="sheet-status">⛓ {label('verifying')}</div>}
        {phase === 'done' && <div className="sheet-status sheet-ok">✓ {label('paymentSuccess')}</div>}
        {phase === 'failed' && (
          <div className="sheet-status sheet-fail">
            ✕ {label('paymentFailed')}
            <small>{failure}</small>
            <button onClick={() => setPhase('pick')}>OK</button>
          </div>
        )}
      </div>
    </div>
  )
}
