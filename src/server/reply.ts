import { geminiText } from './gemini.ts'
import { pairReplies } from './logic.ts'
import {
  getSetting,
  listReplyRows,
  recentChat,
  setSetting,
} from './db.ts'

const MIN_EXAMPLES = 3
let learning = false

export function replyState() {
  const examples = pairReplies(listReplyRows())
  return {
    enabled: getSetting('auto_reply') !== '0',
    pattern: getSetting('reply_pattern') || '',
    exampleCount: examples.length,
    ready: examples.length >= MIN_EXAMPLES && Boolean(getSetting('reply_pattern')),
    updatedAt: getSetting('pattern_updated_at'),
  }
}

export function setAutoReply(enabled: boolean) {
  setSetting('auto_reply', enabled ? '1' : '0')
  return replyState()
}

export async function learnReplyPattern() {
  if (learning) return
  const pairs = pairReplies(listReplyRows())
  setSetting('pattern_example_count', String(pairs.length))
  if (!pairs.length) return
  learning = true
  try {
    const pattern = await geminiText(
      'Describe how this person replies on WhatsApp so another writer can imitate them. Cover language, length, tone, greetings, and what they avoid. Use only the examples. Plain sentences. Do not write a sample reply.',
      pairs.map((pair, index) => `${index + 1}. Them: ${pair.them}\nUs: ${pair.us}`).join('\n\n'),
    )
    setSetting('reply_pattern', pattern)
    setSetting('pattern_updated_at', new Date().toISOString())
  } finally {
    learning = false
  }
}

export async function draftReply(jid: string, inbound: string): Promise<string | null> {
  if (getSetting('auto_reply') === '0') return null
  const pairs = pairReplies(listReplyRows()).slice(-8)
  const pattern = getSetting('reply_pattern')
  const style = pattern
    ? `Pattern learned from their real replies:\n${pattern}`
    : pairs.length
      ? `Imitate only these real replies:\n${pairs.map((pair, index) => `${index + 1}. Them: ${pair.them}\nUs: ${pair.us}`).join('\n\n')}`
      : 'No real replies have been seen yet. Answer in the same language as the incoming text, in one or two short lines, the way a person texts.'
  const recent = recentChat(jid, 12)
  const reply = await geminiText(
    'You send WhatsApp replies as this person. Follow the style notes. Return only the reply text, with no quotes.',
    `${style}\n\nRecent chat:\n${recent.map((message) => `${message.fromMe ? 'Us' : 'Them'}: ${message.body}`).join('\n')}\n\nReply to:\n${inbound}`,
  )
  const cleaned = reply.trim().replace(/^["']|["']$/g, '')
  if (!cleaned || cleaned.toUpperCase() === 'SKIP') return null
  return cleaned.slice(0, 1000)
}
