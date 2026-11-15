import { required } from './env.ts'

export async function geminiText(system: string, user: string): Promise<string> {
  const key = required('GEMINI_API_KEY')
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { thinkingConfig: { thinkingLevel: 'low' } },
      }),
    },
  )
  const json = await response.json() as {
    candidates?: { content?: { parts?: { text?: string, thought?: boolean }[] } }[]
    error?: { message?: string }
  }
  if (!response.ok) {
    const error = new Error(json.error?.message || 'Gemini rejected the request.') as Error & { statusCode?: number }
    error.statusCode = 502
    throw error
  }
  const text = json.candidates?.[0]?.content?.parts
    ?.filter((part) => !part.thought)
    .map((part) => part.text || '')
    .join('')
    .trim()
  if (!text) {
    const error = new Error('Gemini returned an empty reply.') as Error & { statusCode?: number }
    error.statusCode = 502
    throw error
  }
  return text
}
