/** Minimal UI strings. Nimiq Pay tells us the user's language. */
const STRINGS = {
  en: {
    tagline: 'Your pocket AI. Pennies per question.',
    presetTranslate: 'Translate',
    presetSummarize: 'Summarize',
    presetExplain: 'Explain',
    presetWrite: 'Write',
    presetBrainstorm: 'Brainstorm',
    freeLeft: '{n} free left',
    credits: '{n} credits',
    topUp: 'Top up',
    placeholder: 'Ask anything…',
    welcomeTitle: 'Meet AskNim',
    welcomeBody: 'Ask anything — {n} answers are on the house. After that, add credits with a feeless NIM payment.',
    needCredits: 'You are out of credits',
    needCreditsBody: 'Grab more answers with a feeless NIM payment. Credits never expire.',
    payWithNimiq: 'Pay with Nimiq Pay',
    waitingPayment: 'Waiting for your payment…',
    verifying: 'Verifying on-chain…',
    paymentSuccess: 'Credits added!',
    paymentFailed: 'Payment verification failed',
    openInPay: 'Open inside Nimiq Pay',
    demoMode: 'Demo mode (outside Nimiq Pay) — payments disabled',
    connect: 'Connect wallet',
    errorGeneric: 'Something went wrong. Try again.',
  },
  de: {
    tagline: 'Deine KI für die Hosentasche. Pfennige pro Frage.',
    presetTranslate: 'Übersetzen',
    presetSummarize: 'Zusammenfassen',
    presetExplain: 'Erklären',
    presetWrite: 'Schreiben',
    presetBrainstorm: 'Ideen',
    freeLeft: '{n} gratis übrig',
    credits: '{n} Credits',
    topUp: 'Aufladen',
    placeholder: 'Frag mich etwas…',
    welcomeTitle: 'AskNim kennenlernen',
    welcomeBody: 'Frag alles — {n} Antworten gehen auf uns. Danach Credits mit gebührenfreier NIM-Zahlung.',
    needCredits: 'Keine Credits mehr',
    needCreditsBody: 'Hol dir mehr Antworten mit einer gebührenfreien NIM-Zahlung. Credits verfallen nie.',
    payWithNimiq: 'Mit Nimiq Pay zahlen',
    waitingPayment: 'Warten auf deine Zahlung…',
    verifying: 'On-Chain-Prüfung…',
    paymentSuccess: 'Credits aufgeladen!',
    paymentFailed: 'Zahlungsprüfung fehlgeschlagen',
    openInPay: 'In Nimiq Pay öffnen',
    demoMode: 'Demo-Modus (außerhalb von Nimiq Pay)',
    connect: 'Wallet verbinden',
    errorGeneric: 'Etwas ist schiefgelaufen. Nochmal versuchen.',
  },
  es: {
    tagline: 'Tu IA de bolsillo. Centavos por pregunta.',
    presetTranslate: 'Traducir',
    presetSummarize: 'Resumir',
    presetExplain: 'Explicar',
    presetWrite: 'Escribir',
    presetBrainstorm: 'Ideas',
    freeLeft: '{n} gratis restantes',
    credits: '{n} créditos',
    topUp: 'Recargar',
    placeholder: 'Pregunta lo que quieras…',
    welcomeTitle: 'Conoce a AskNim',
    welcomeBody: 'Pregunta todo — {n} respuestas van por nuestra cuenta. Después, añade créditos con un pago NIM sin comisiones.',
    needCredits: 'Te quedaste sin créditos',
    needCreditsBody: 'Consigue más respuestas con un pago NIM sin comisiones. Los créditos nunca caducan.',
    payWithNimiq: 'Pagar con Nimiq Pay',
    waitingPayment: 'Esperando tu pago…',
    verifying: 'Verificando on-chain…',
    paymentSuccess: '¡Créditos añadidos!',
    paymentFailed: 'Falló la verificación del pago',
    openInPay: 'Abrir en Nimiq Pay',
    demoMode: 'Modo demo (fuera de Nimiq Pay)',
    connect: 'Conectar wallet',
    errorGeneric: 'Algo salió mal. Inténtalo de nuevo.',
  },
} as const

export type StringKey = keyof typeof STRINGS.en

export function t(lang: string, key: StringKey, vars?: Record<string, string | number>): string {
  const dict = (STRINGS as Record<string, Record<StringKey, string>>)[lang] ?? STRINGS.en
  let out = dict[key] ?? STRINGS.en[key]
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      out = out.replaceAll(`{${k}}`, String(v))
    }
  }
  return out
}

export const PRESET_KEYS: { id: string, key: StringKey, sample: string }[] = [
  { id: 'translate', key: 'presetTranslate', sample: '"Where is the train station?" → Spanish' },
  { id: 'summarize', key: 'presetSummarize', sample: 'Paste any text to condense' },
  { id: 'explain', key: 'presetExplain', sample: 'What is staking?' },
  { id: 'write', key: 'presetWrite', sample: 'A friendly reply to a landlord' },
  { id: 'brainstorm', key: 'presetBrainstorm', sample: 'Names for my coffee shop' },
]
