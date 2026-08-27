# AskNim

**Your pocket AI. Pennies per question.**

AskNim is a Mini App that lives inside [Nimiq Pay](https://www.nimiq.com): a helpful AI assistant with zero signup — your wallet *is* your account — where every answer is metered and paid with **feeless NIM micro-payments**. No subscriptions, no card details, no accounts. You get 3 answers free, then top up in two taps.

> Built for the [Nimiq Mini Apps Competition — Cycle II](https://miniappscompetition.com).

## Why it matters

AI assistants want subscriptions. Nimiq rails want micro-payments. AskNim sits exactly where those two meet: because Nimiq is **feeless with 1-second confirmations**, charging **a fraction of a cent per question** actually works — something no EVM gas model can offer. The AI provider cost is absorbed by pack pricing; the user experience stays as light as asking a friend.

## How it works

```
AskNim (Vite + React + TS)
   │  runs in Nimiq Pay's WebView
   │  @nimiq/mini-app-sdk ── device id · wallet · payments
   ▼
AskNim server (Node + Hono)
   ├── Groq (Llama 3.3 70B) — streamed answers, keys never leave the server
   ├── Credit ledger — 3 free messages per device, then paid credits
   └── Payment verification — every NIM payment confirmed on-chain
         via Nimiq JSON-RPC (amount · recipient · memo · replay protection)
```

**Payment loop:** the app requests a checkout session → the user approves a `sendBasicTransactionWithData` NIM payment in Nimiq Pay (the memo tags the session) → the server independently verifies the transaction on-chain before crediting. The client's word is never trusted.

## Try it

1. `npm install`
2. Copy `.env.example` → `.env`, set `GROQ_API_KEY` (free at console.groq.com) and your `MERCHANT_NIM_ADDRESS`
3. `npm run dev:all` — web on :5173, API on :8787
4. Open Nimiq Pay → Mini Apps → enter `http://<your-lan-ip>:5173`
   (outside Nimiq Pay the app runs in a clearly-labeled demo mode)

Production: `npm run build && npm start` — the server serves the built app and the API on one port.

## Principles

- **Day-one useful** — translate, summarize, explain, write, brainstorm. No crypto knowledge required.
- **Privacy first** — no accounts, no email; a pseudonymous per-device identifier (with an explicit user-approved reason prompt) meters the free tier.
- **Server-authoritative** — quiz the bundle: prices, credit balances, and payment truth all live on the server.
- **Feeless economics** — 1 NIM ≈ 50 answers. Try that on Polygon gas.

## Stack

React 19 · Vite · TypeScript · Hono · Groq · `@nimiq/mini-app-sdk`

## License

MIT
