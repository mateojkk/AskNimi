# AskNim

**Your pocket AI. Pennies per question.**

AskNim is a Mini App that lives inside [Nimiq Pay](https://www.nimiq.com): a helpful AI assistant with zero signup. Your wallet *is* your account, every answer is metered, and every top-up is a **feeless NIM micro-payment**. No subscriptions, no card details, no accounts. You get 3 answers free, then top up in two taps.

> Built for the [Nimiq Mini Apps Competition, Cycle II](https://miniappscompetition.com).

## Why it matters

AI assistants want subscriptions. Nimiq rails want micro-payments. AskNim sits exactly where those two meet: because Nimiq is **feeless with 1-second confirmations**, charging **a fraction of a cent per question** actually works, something no EVM gas model can offer. The AI provider cost is absorbed by pack pricing; the user experience stays as light as asking a friend.

## How it works

```
AskNim (Vite + React + TS)
   |  runs in Nimiq Pay's WebView
   |  @nimiq/mini-app-sdk: device id, wallet, payments
   v
AskNim server (Node + Hono)
   |-- Groq (openai/gpt-oss-120b): streamed answers, keys never leave the server
   |-- Credit ledger: 3 free messages per device, then paid credits
   +-- Payment verification: every NIM payment confirmed on-chain
         via Nimiq JSON-RPC (amount, recipient, memo, replay protection)
```

**Payment loop:** the app requests a checkout session, the user approves a `sendBasicTransactionWithData` NIM payment in Nimiq Pay (the memo tags the session), and the server independently verifies the transaction on-chain before crediting. The client's word is never trusted.

## Repo layout (npm-workspaces monorepo)

```
asknim/
|-- apps/
|   |-- web/     # Vite + React mini app (static build)
|   +-- api/     # Hono API: Node dev server + Vercel Functions entry
|       |-- api/[[...route]].ts   # Vercel serverless handler
|       +-- server/               # app, config, store, ai, payments
+-- package.json # workspaces + dev scripts
```

## Run locally

1. `npm install`
2. `apps/api/.env`: set `GROQ_API_KEY` (free at console.groq.com) and your `MERCHANT_NIM_ADDRESS`
3. `npm run dev:all`: web on :5173 (proxies `/api`), API on :8787
4. Open Nimiq Pay, then Mini Apps, then enter `http://<your-lan-ip>:5173`
   (outside Nimiq Pay the app runs in a clearly-labeled demo mode)

**Free testing:** Nimiq Pay has a hidden dev menu: long-press the settings button for 10s, switch to **Testnet**, then tap **Get free NIM** (110,000 test-NIM per request). Set `NIMIQ_RPC_URL` to a testnet RPC while testing so payment verification matches.

## Deploy to Vercel (single serverless project)

One Vercel project serves everything: the static mini app **and** the API as a serverless function (`api/[[...route]].ts` at the repo root, 60s max duration for AI streaming). Same origin, so no CORS and no cross-project rewrites.

The API runs serverless, so the JSON-file store switches to **Upstash Redis** automatically when `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` are set (free tier at upstash.com).

1. **Push this repo to GitHub.**
2. Vercel, Add New, Project, import the repo. **Root Directory: repo root** (framework: Other; `vercel.json` handles build + output).
3. Add env vars:
   - `GROQ_API_KEY`: free at console.groq.com
   - `GROQ_MODEL`: `openai/gpt-oss-120b`
   - `MERCHANT_NIM_ADDRESS`: your Nimiq wallet
   - `NIMIQ_RPC_URL`: `https://rpc.nimiqwatch.com` (or a testnet RPC while testing)
   - `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`: free Upstash Redis
   - `FREE_MESSAGES`: `3`
4. Deploy. Open `https://<your-domain>` inside Nimiq Pay via `https://nimpay.app/miniapps/open/<your-domain>`, or just paste the URL into Mini Apps.

CLI equivalent:

```bash
npm i -g vercel
vercel link
vercel env add GROQ_API_KEY production   # repeat per variable
vercel --prod
```

## Principles

- **Day-one useful**: translate, summarize, explain, write, brainstorm. No crypto knowledge required.
- **Privacy first**: no accounts, no email; a pseudonymous per-device identifier (with an explicit user-approved reason prompt) meters the free tier.
- **Server-authoritative**: quiz the bundle. Prices, credit balances, and payment truth all live on the server.
- **Feeless economics**: 1 NIM buys about 50 answers. Try that on Polygon gas.

## Stack

React 19, Vite, TypeScript, Hono, Groq, `@nimiq/mini-app-sdk`

## License

MIT
