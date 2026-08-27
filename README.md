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

## Repo layout (npm-workspaces monorepo)

```
asknim/
├── apps/
│   ├── web/     # Vite + React mini app (static build)
│   └── api/     # Hono API — Node dev server + Vercel Functions entry
│       ├── api/[[...route]].ts   # Vercel serverless handler
│       └── server/               # app, config, store, ai, payments
└── package.json # workspaces + dev scripts
```

## Run locally

1. `npm install`
2. `apps/api/.env` — set `GROQ_API_KEY` (free at console.groq.com) and your `MERCHANT_NIM_ADDRESS`
3. `npm run dev:all` — web on :5173 (proxies `/api`), API on :8787
4. Open Nimiq Pay → Mini Apps → enter `http://<your-lan-ip>:5173`
   (outside Nimiq Pay the app runs in a clearly-labeled demo mode)

**Free testing:** Nimiq Pay has a hidden dev menu — long-press the settings button for 10s → switch to **Testnet** → tap **Get free NIM** (110,000 test-NIM per request). Set `NIMIQ_RPC_URL` to a testnet RPC while testing so payment verification matches.

## Deploy to Vercel (two projects)

The API runs on Vercel Functions (serverless), so the JSON-file store switches to **Upstash Redis** automatically when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set (free tier at upstash.com).

1. **Push this repo to GitHub.**
2. **API project:** Vercel → Add New → Project → import repo → **Root Directory: `apps/api`** (framework: Other). Add env vars: `GROQ_API_KEY`, `GROQ_MODEL`, `MERCHANT_NIM_ADDRESS`, `NIMIQ_RPC_URL`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `FREE_MESSAGES`. Deploy — note the domain (e.g. `asknim-api.vercel.app`).
3. **Web project:** Add New → Project → same repo → **Root Directory: `apps/web`** (framework: Vite). Before deploying, edit `apps/web/vercel.json` and point the rewrite `destination` at your API domain from step 2 — the browser only ever calls same-origin `/api/*`, no CORS anywhere.
4. Redeploy web if you changed the rewrite. Open `https://<web-domain>` inside Nimiq Pay via `https://nimpay.app/miniapps/open/<web-domain>`.

## Principles

- **Day-one useful** — translate, summarize, explain, write, brainstorm. No crypto knowledge required.
- **Privacy first** — no accounts, no email; a pseudonymous per-device identifier (with an explicit user-approved reason prompt) meters the free tier.
- **Server-authoritative** — quiz the bundle: prices, credit balances, and payment truth all live on the server.
- **Feeless economics** — 1 NIM ≈ 50 answers. Try that on Polygon gas.

## Stack

React 19 · Vite · TypeScript · Hono · Groq · `@nimiq/mini-app-sdk`

## License

MIT
