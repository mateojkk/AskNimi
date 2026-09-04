import { useState } from 'react'
import type { SessionState } from '../lib/api.ts'
import { t, type StringKey } from '../i18n.ts'

interface Props {
  lang: string
  packs: SessionState['packs']
  insidePay: boolean
  credits?: number
  freeRemaining?: number
  maxCredits?: number
  onClose: () => void
  onBuy: (packId: string, onSent?: () => void) => Promise<void>
}

const fmt = (luna: number) => (luna / 100_000).toLocaleString('en-US', { maximumFractionDigits: 2 })

export function Paywall({ lang, packs, insidePay, credits, freeRemaining, maxCredits, onClose, onBuy }: Props) {
  const [phase, setPhase] = useState<'pick' | 'waiting' | 'verifying' | 'done' | 'failed'>('pick')
  const [failure, setFailure] = useState('')

  const label = (key: StringKey) => t(lang, key)

  const currentCredits = credits ?? 0
  const totalBalance = currentCredits + (freeRemaining ?? 0)
  const hasBalance = totalBalance > 0
  const isPackDisabled = (packCredits: number) =>
    maxCredits !== undefined && (currentCredits + packCredits > maxCredits)
  const isAllMaxed = maxCredits !== undefined && packs.every(p => currentCredits + p.credits > maxCredits)

  const buy = async (packId: string) => {
    const pack = packs.find(p => p.id === packId)
    if (pack && isPackDisabled(pack.credits)) return
    if (!insidePay) {
      setFailure('Demo mode: open AskNim inside Nimiq Pay to pay.')
      setPhase('failed')
      return
    }
    try {
      setPhase('waiting')
      await onBuy(packId, () => setPhase('verifying'))
      setPhase('done')
      setTimeout(onClose, 900)
    }
    catch (err) {
      const msg = (err instanceof Error && err.message) ? err.message : label('paymentFailed')
      setFailure(msg)
      setPhase('failed')
    }
  }

  return (
    <div className="sheet-backdrop" onClick={phase === 'pick' ? onClose : undefined}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <div className="sheet-handle" />
        {phase === 'pick' && (
          <>
            <h2>{hasBalance ? label('topUpAnswers') : label('needCredits')}</h2>
            <p className="sheet-sub">
              {hasBalance
                ? t(lang, 'topUpAnswersBody', { n: totalBalance })
                : label('needCreditsBody')}
            </p>

            {isAllMaxed && (
              <div className="sheet-warn">
                {t(lang, 'maxLimitReached', { n: maxCredits })}
              </div>
            )}

            <div className="packs">
              {packs.map((p, i) => {
                const disabled = isPackDisabled(p.credits)
                return (
                  <button
                    key={p.id}
                    className={`pack${i === 1 && !disabled ? ' pack-best' : ''}`}
                    onClick={() => !disabled && buy(p.id)}
                    disabled={disabled}
                    style={disabled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                  >
                    {i === 1 && !disabled && <span className="pack-badge">Best value</span>}
                    {disabled && (
                      <span className="pack-badge" style={{ background: '#333', color: '#aaa', borderColor: '#444' }}>
                        {label('exceedsLimit')}
                      </span>
                    )}
                    <span className="pack-price">{fmt(p.priceLuna)}</span>
                    <span className="pack-unit">NIM</span>
                    <span className="pack-credits">{p.credits} answers</span>
                  </button>
                )
              })}
            </div>
            <div className="sheet-note">
              {label('payWithNimiq')} · feeless · instant
            </div>
          </>
        )}
        {phase === 'waiting' && <div className="sheet-status">{label('waitingPayment')}</div>}
        {phase === 'verifying' && (
          <div className="sheet-status">
            {label('verifying')}
            <small style={{ marginTop: 8, opacity: 0.8, fontSize: '0.85em' }}>Confirming transaction on-chain…</small>
          </div>
        )}
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
