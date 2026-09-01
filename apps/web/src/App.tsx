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
import { PRESETS, t } from './i18n.ts'
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

  useEffect(() => {
    ;(async () => {
      setLang(payLanguage())
      const inPay = await insideNimiqPay()
      setInsidePay(inPay)
      let id: string
      if (inPay) {
        try {
          id = await getDeviceId()
        }
        catch (err) {
          // Identifier prompt denied or provider hiccup: keep the app usable
          // with a local id (metering still works, just not cross-device).
          console.warn('[asknim] device identifier unavailable, using local id', err)
          id = getLocalDeviceId()
        }
      }
      else {
        id = getLocalDeviceId()
      }
      setDeviceId(id)
      setSession(await startSession(id))
    })().catch((err) => {
      console.error('[asknim] init failed', err)
      setError(t(lang, 'errorGeneric'))
    })
  }, [])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streaming])

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
      setStreaming((finalText) => {
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: finalText.trim() }])
        return ''
      })
      setSession(s => s && { ...s, freeRemaining: balance.freeRemaining, credits: balance.credits })
    }
    catch (err) {
      const e = err as Error & { code?: string }
      if (e.code === 'NEEDS_TOPUP') {
        setMessages(messages)
        setShowPaywall(true)
      }
      else {
        console.error('[asknim] chat failed', err)
        setError(e.message || t(lang, 'errorGeneric'))
        setMessages(messages)
      }
      setStreaming('')
    }
    finally {
      setBusy(false)
    }
  }, [deviceId, session, busy, messages, lang])

  const connect = useCallback(async () => {
    try {
      const [addr] = await listAccounts()
      setAddress(addr)
    }
    catch {
      setError(t(lang, 'errorGeneric'))
    }
  }, [lang])

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
  const empty = messages.length === 0 && !streaming && !busy

  return (
    <div className="app">
      <header className="header">
        <div className="brand">
          <img src="/logo.png" alt="AskNim" className="brand-logo" />
          <div>
            <div className="brand-name">ask<em>nim</em></div>
            <div className="brand-sub">{t(lang, 'tagline')}</div>
          </div>
        </div>
        <div className="balance">
          {freeLeft > 0 && <span className="chip chip-free">{t(lang, 'freeLeft', { n: freeLeft })}</span>}
          {credits > 0 && <span className="chip chip-credit">{t(lang, 'credits', { n: credits })}</span>}
          {insidePay && !address && (
            <button className="chip chip-btn" onClick={connect}>{t(lang, 'connect')}</button>
          )}
          {address && <span className="chip chip-addr">{address.slice(0, 6)}…{address.slice(-4)}</span>}
        </div>
      </header>

      {insidePay === false && <div className="demo-banner">{t(lang, 'demoMode')}</div>}

      <main className="chat">
        {empty && (
          <div className="welcome">
            <img src="/logo.png" alt="" className="hero-logo" />
            <h1>ask <em>anything</em></h1>
            <p>
              Your pocket AI, inside Nimiq Pay. <strong>{freeLeft || 3} answers are free</strong>. Top up with a feeless NIM tap.
            </p>
            <div className="presets">
              {PRESETS.map(p => (
                <button key={p.id} className="preset" onClick={() => send(p.sample, p.id)}>
                  <span className="preset-title">{t(lang, p.key)}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`msg msg-${m.role}`}>
            {m.role === 'assistant' && <img src="/logo.png" alt="" className="avatar" />}
            <div className="bubble">{m.content}</div>
          </div>
        ))}

        {(streaming || busy) && (
          <div className="msg msg-assistant">
            <img src="/logo.png" alt="" className="avatar" />
            <div className="bubble">
              {streaming
                ? <>{streaming}<span className="caret" /></>
                : <span className="thinking"><i /><i /><i /></span>}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </main>

      {error && <div className="error-bar" onClick={() => setError(null)}>{error}</div>}

      <footer className="composer">
        <div className="composer-input">
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
            <svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
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
