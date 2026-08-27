import { useCallback, useEffect, useRef, useState } from 'react'
import {
  confirmCheckout,
  createCheckout,
  startSession,
  streamChat,
  type ChatMessage,
  type CheckoutSession,
  type SessionState,
} from './lib/api.ts'
import { getDeviceId, getLocalDeviceId, insideNimiqPay, listAccounts, payLanguage, payWithMemo } from './lib/nimiq.ts'
import { PRESET_KEYS, t } from './i18n.ts'
import { Paywall } from './components/Paywall.tsx'

export default function App() {
  const [deviceId, setDeviceId] = useState<string | null>(null)
  const [session, setSession] = useState<SessionState | null>(null)
  const [insidePay, setInsidePay] = useState<boolean | null>(null)
  const [lang, setLang] = useState('en')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [showPaywall, setShowPaywall] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [address, setAddress] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── bootstrap ──────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      setLang(payLanguage())
      const inPay = await insideNimiqPay()
      setInsidePay(inPay)
      const id = inPay ? await getDeviceId() : getLocalDeviceId()
      setDeviceId(id)
      setSession(await startSession(id))
    })().catch(err => setError(String(err)))
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

  // ── send / stream ──────────────────────────────────────────────
  const send = useCallback(async (text: string, preset?: string) => {
    if (!deviceId || !session || busy || !text.trim()) return
    setError(null)
    const history: ChatMessage[] = [...messages, { role: 'user', content: text }]
    setMessages(history)
    setInput('')
    setBusy(true)
    setStreaming('')

    try {
      const balance = await streamChat(deviceId, history, preset, (delta) => {
        setStreaming(s => s + delta)
      })
      setMessages(prev => [...prev, { role: 'assistant', content: '' }])
      // finalize: replace placeholder with the full streamed text
      setStreaming((finalText) => {
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: finalText.trim() }])
        return ''
      })
      setSession(s => s && { ...s, freeRemaining: balance.freeRemaining, credits: balance.credits })
    }
    catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'NEEDS_TOPUP') {
        setMessages(messages) // roll back the optimistic user message
        setShowPaywall(true)
      }
      else {
        setError(e.message || t(lang, 'errorGeneric'))
        setMessages(messages)
      }
      setStreaming('')
    }
    finally {
      setBusy(false)
    }
  }, [deviceId, session, busy, messages, lang])

  // ── wallet connect (optional identity display) ─────────────────
  const connect = useCallback(async () => {
    try {
      const [addr] = await listAccounts()
      setAddress(addr)
    }
    catch {
      setError(t(lang, 'errorGeneric'))
    }
  }, [lang])

  // ── payment flow ───────────────────────────────────────────────
  const buyPack = useCallback(async (packId: string) => {
    if (!deviceId || !session) return
    const checkout: CheckoutSession = await createCheckout(deviceId, packId)
    const txHash = await payWithMemo(checkout.recipient, checkout.priceLuna, checkout.memo)
    const result = await confirmCheckout(checkout.sessionId, txHash, deviceId)
    setSession(s => s && { ...s, credits: result.credits })
    setShowPaywall(false)
  }, [deviceId, session])

  const freeLeft = session?.freeRemaining ?? 0
  const credits = session?.credits ?? 0
  const hasBalance = freeLeft > 0 || credits > 0

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <span className="brand-mark">asknim</span>
          <span className="brand-tag">{t(lang, 'tagline')}</span>
        </div>
        <div className="balance">
          {freeLeft > 0 && <span className="pill pill-free">{t(lang, 'freeLeft', { n: freeLeft })}</span>}
          {credits > 0 && <span className="pill pill-credit">{t(lang, 'credits', { n: credits })}</span>}
          {insidePay && !address && (
            <button className="pill pill-action" onClick={connect}>{t(lang, 'connect')}</button>
          )}
          {address && <span className="pill pill-addr">{address.slice(0, 6)}…{address.slice(-4)}</span>}
        </div>
      </header>

      {insidePay === false && <div className="demo-banner">{t(lang, 'demoMode')}</div>}

      <main className="chat">
        {messages.length === 0 && !streaming && (
          <div className="welcome">
            <div className="welcome-logo">asknim</div>
            <h1>{t(lang, 'welcomeTitle')}</h1>
            <p>{t(lang, 'welcomeBody', { n: 3 })}</p>
            <div className="presets">
              {PRESET_KEYS.map(p => (
                <button key={p.id} className="preset" onClick={() => send(p.sample, p.id)}>
                  {t(lang, p.key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            <div className="bubble">{m.content}</div>
          </div>
        ))}

        {(streaming || (busy && !streaming)) && (
          <div className="msg msg-assistant">
            <div className={`bubble${streaming ? '' : ' bubble-thinking'}`}>
              {streaming || <span className="dots"><i /><i /><i /></span>}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}

      <footer className="composer">
        <input
          value={input}
          placeholder={t(lang, 'placeholder')}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && send(input)}
          disabled={busy || !deviceId}
        />
        <button
          className="send"
          onClick={() => send(input)}
          disabled={busy || !input.trim() || !deviceId}
          aria-label="Send"
        >
          ➤
        </button>
      </footer>

      {showPaywall && session && (
        <Paywall
          lang={lang}
          packs={session.packs}
          insidePay={Boolean(insidePay)}
          onClose={() => setShowPaywall(false)}
          onBuy={buyPack}
        />
      )}

      {!hasBalance && session && !showPaywall && messages.length > 0 && (
        <button className="topup-float" onClick={() => setShowPaywall(true)}>
          {t(lang, 'topUp')}
        </button>
      )}
    </div>
  )
}
