import type { ChatCompletionMessageParam } from 'groq-sdk/resources/chat/completions'
import { config } from './config.ts'

export const SYSTEM_PROMPT = `You are AskNim, a friendly AI assistant that lives inside Nimiq Pay, the Nimiq mobile wallet.
You help people with everyday questions: writing, translating, summarizing, explaining concepts (including crypto/Nimiq topics), and brainstorming.
Style: concise, warm, and practical. Use short paragraphs and bullet lists when helpful. Match the user's language.
You may reference that you are powered by feeless Nimiq micro-payments if asked about yourself, but never push financial advice.
Never give financial, legal, or medical advice beyond general educational information.`

export const PRESET_INSTRUCTIONS: Record<string, string> = {
  translate: 'The user sends text to translate. Detect the source language, translate to the language they specify (or to English if unspecified), and reply with just the translation.',
  summarize: "Summarize the user's text into 3-5 crisp bullet points.",
  explain: 'Explain the concept or term the user sends in simple terms, with a relatable example. Max ~120 words.',
  write: 'Help the user write the message, email, or post they describe. Produce a polished draft they can copy.',
  brainstorm: 'Give 5 creative, practical ideas for what the user asks. One line each.',
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Streams an AI answer token-by-token to the given callback.
 *
 * Without a GROQ_API_KEY the server runs in echo-bot mode: it still
 * streams, still meters credits, and still verifies payments — so the
 * whole product loop can be tested before a key is configured.
 */
export async function streamChat(
  turns: ChatTurn[],
  preset: string | undefined,
  onDelta: (text: string) => void,
): Promise<void> {
  const history = turns.slice(-config.maxHistoryMessages)

  if (!config.groqApiKey) {
    // ── Echo-bot fallback (dev/testing only) ──
    const last = history[history.length - 1]?.content ?? ''
    const reply = `[AskNim echo mode — set GROQ_API_KEY for real answers]\n\nYou said: "${last.slice(0, 200)}"`
    for (const word of reply.split(' ')) {
      onDelta(`${word} `)
      await new Promise(r => setTimeout(r, 25))
    }
    return
  }

  const { default: Groq } = await import('groq-sdk')
  const groq = new Groq({ apiKey: config.groqApiKey })

  const messages: ChatCompletionMessageParam[] = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...(preset && PRESET_INSTRUCTIONS[preset]
      ? [{ role: 'system' as const, content: PRESET_INSTRUCTIONS[preset] }]
      : []),
    ...history.map(t => ({ role: t.role, content: t.content }) as ChatCompletionMessageParam),
  ]

  const stream = await groq.chat.completions.create({
    model: config.groqModel,
    messages,
    max_tokens: config.maxTokens,
    temperature: 0.7,
    stream: true,
  })

  for await (const chunk of stream) {
    const delta = chunk.choices[0]?.delta?.content
    if (delta) onDelta(delta)
  }
}
