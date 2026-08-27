import { serve } from '@hono/node-server'
import { config } from './config'
import { app } from './app'

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`AskNim API listening on http://localhost:${info.port}`)
  console.log(`  AI: ${config.groqApiKey ? `Groq (${config.groqModel})` : 'echo mode — set GROQ_API_KEY'}`)
  console.log(`  Merchant: ${config.merchantAddress || 'NOT CONFIGURED — payments disabled'}`)
  console.log(`  Store: ${config.upstashUrl && config.upstashToken ? 'Upstash Redis (remote)' : 'local JSON file'}`)
})
