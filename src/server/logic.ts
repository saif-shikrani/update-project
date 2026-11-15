import { createPublicKey, verify, type KeyObject } from 'node:crypto'

const STATUS_RANK: Record<string, number> = {
  initiated: 1,
  ringing: 2,
  answered: 3,
  hangup: 4,
  failed: 4,
}

const RECORD_ID_FIELDS = [
  'telnyx_session_id',
  'telnyx_leg_id',
  'telnyx_call_control_id',
  'call_session_id',
  'call_leg_id',
  'call_control_id',
  'call_id',
]

export const SUMMARY_CAP = 200

export function durationSeconds(answeredAt: string | null, endedAt: string | null): number {
  if (!answeredAt || !endedAt) return 0
  const ms = Date.parse(endedAt) - Date.parse(answeredAt)
  if (!Number.isFinite(ms) || ms <= 0) return 0
  return Math.round(ms / 1000)
}

export function nextStatus(current: string | null, incoming: string): string {
  if (!current) return incoming
  const nextRank = STATUS_RANK[incoming] ?? 0
  const currentRank = STATUS_RANK[current] ?? 0
  return nextRank >= currentRank ? incoming : current
}

export function normalizeNumber(input: string): string | null {
  const digits = input.trim().replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

const TEXT_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
  'associatedChildMessage',
  'deviceSentMessage',
] as const

export function extractText(message: unknown): string | null {
  return unwrapText(message, 0)
}

export type WaMediaKind = 'image' | 'document'

export function extractWaMedia(message: unknown): {
  kind: WaMediaKind
  mimeType: string | null
  fileName: string | null
  caption: string | null
} | null {
  return unwrapWaMedia(message, 0)
}

function unwrapWaMedia(message: unknown, depth: number): {
  kind: WaMediaKind
  mimeType: string | null
  fileName: string | null
  caption: string | null
} | null {
  if (depth > 5) return null
  if (!message || typeof message !== 'object') return null
  const record = message as Record<string, unknown>
  for (const key of ['imageMessage', 'documentMessage']) {
    const value = record[key]
    if (!value || typeof value !== 'object') continue
    const media = value as Record<string, unknown>
    return {
      kind: key === 'imageMessage' ? 'image' : 'document',
      mimeType: typeof media.mimetype === 'string' ? media.mimetype : null,
      fileName: typeof media.fileName === 'string' ? media.fileName : null,
      caption: typeof media.caption === 'string' && media.caption.trim() ? media.caption.trim() : null,
    }
  }
  for (const key of TEXT_WRAPPERS) {
    const wrapped = record[key]
    const inner = wrapped && typeof wrapped === 'object' ? (wrapped as { message?: unknown }).message : null
    const found = unwrapWaMedia(inner, depth + 1)
    if (found) return found
  }
  return null
}

function unwrapText(message: unknown, depth: number): string | null {
  if (!message || typeof message !== 'object' || depth > 5) return null
  const record = message as Record<string, unknown>
  const conversation = typeof record.conversation === 'string' ? record.conversation : ''
  const extended = record.extendedTextMessage
  const extendedText = extended && typeof extended === 'object'
    ? (extended as { text?: unknown }).text
    : ''
  const text = (conversation || (typeof extendedText === 'string' ? extendedText : '')).trim()
  if (text) return text
  for (const key of TEXT_WRAPPERS) {
    const wrapped = record[key]
    const inner = wrapped && typeof wrapped === 'object' ? (wrapped as { message?: unknown }).message : null
    const found = unwrapText(inner, depth + 1)
    if (found) return found
  }
  return null
}

export function messageTimeIso(value: unknown): string {
  let seconds = Number.NaN
  if (typeof value === 'number' || typeof value === 'bigint') seconds = Number(value)
  else if (typeof value === 'string') seconds = Number(value)
  else if (value && typeof value === 'object' && 'toString' in value) seconds = Number(String(value))
  if (!Number.isFinite(seconds) || seconds <= 0) return new Date().toISOString()
  return new Date(seconds * 1000).toISOString()
}

export function costFromPayload(payload: Record<string, unknown>): {
  amount: string
  currency: string | null
  billableSeconds: number | null
} | null {
  const parts = Array.isArray(payload.cost_parts) ? payload.cost_parts as Record<string, unknown>[] : []
  let amount: number | null = null
  if (isCost(payload.total_cost)) amount = Number(payload.total_cost)
  else if (isCost(payload.cost)) amount = Number(payload.cost)
  else if (parts.some((part) => isCost(part.cost))) {
    amount = parts.reduce((sum, part) => sum + (isCost(part.cost) ? Number(part.cost) : 0), 0)
  }
  if (amount == null || !Number.isFinite(amount)) return null
  const currency = stringOrNull(payload.currency) ?? stringOrNull(parts.find((part) => part.currency)?.currency)
  const billed = payload.billed_duration_secs
  return {
    amount: amount.toFixed(4),
    currency,
    billableSeconds: typeof billed === 'number' && Number.isFinite(billed) ? billed : null,
  }
}

function isCost(value: unknown): boolean {
  return value != null && value !== '' && Number.isFinite(Number(value))
}

export function recordMatches(record: Record<string, unknown>, ids: string[]): boolean {
  const known = new Set(ids.filter(Boolean))
  return RECORD_ID_FIELDS.some((field) => {
    const value = record[field]
    return value != null && value !== '' && known.has(String(value))
  })
}

export function combineCosts(records: Record<string, unknown>[]): {
  amount: string
  currency: string | null
  billableSeconds: number | null
} | null {
  const seen = new Set<string>()
  let sum = 0
  let currency: string | null = null
  let mixed = false
  let billed = 0
  let any = false
  for (const record of records) {
    const type = String(record.record_type ?? 'unknown')
    if (seen.has(type)) continue
    seen.add(type)
    const raw = record.cost ?? record.total_cost
    if (!isCost(raw)) continue
    const nextCurrency = stringOrNull(record.currency)
    if (currency && nextCurrency && nextCurrency !== currency) mixed = true
    if (!currency && nextCurrency) currency = nextCurrency
    sum += Number(raw)
    any = true
    const seconds = Number(record.billed_sec ?? record.billed_duration_secs ?? 0)
    if (Number.isFinite(seconds)) billed = Math.max(billed, seconds)
  }
  if (!any) return null
  return { amount: sum.toFixed(4), currency: mixed ? null : currency, billableSeconds: billed || null }
}

export function transcriptLines(messages: { timestamp: string, pushName: string | null, body: string }[]): {
  omitted: number
  text: string
} {
  const slice = messages.length > SUMMARY_CAP ? messages.slice(messages.length - SUMMARY_CAP) : messages
  return {
    omitted: messages.length - slice.length,
    text: slice.map((message) => `${message.timestamp} ${message.pushName ?? 'Unknown'}: ${message.body}`).join('\n'),
  }
}

export type ReplyRow = { chatJid: string, body: string, fromMe: boolean, source: string }

export function pairReplies(rows: ReplyRow[], limit = 20): { them: string, us: string }[] {
  const pairs: { them: string, us: string }[] = []
  let chat = ''
  let pending: string | null = null
  for (const row of rows) {
    if (row.chatJid !== chat) {
      chat = row.chatJid
      pending = null
    }
    if (!row.fromMe) pending = row.body
    else if (pending && row.source !== 'auto') {
      pairs.push({ them: pending, us: row.body })
      pending = null
    }
  }
  return pairs.slice(-limit)
}

export function toUnits(amount: string): number | null {
  const trimmed = amount.trim()
  if (!/^\d+(\.\d{1,4})?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  return Number(whole) * 10000 + Number((frac + '0000').slice(0, 4))
}

export function fromUnits(units: number): string {
  const sign = units < 0 ? '-' : ''
  const abs = Math.abs(Math.trunc(units))
  return `${sign}${Math.floor(abs / 10000)}.${String(abs % 10000).padStart(4, '0')}`
}

export function priceUnits(amount: string): number | null {
  const trimmed = amount.trim().replace(/^\$/, '')
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  const [whole, frac = ''] = trimmed.split('.')
  if (whole.length > 10) return null
  const units = Number(whole) * 10000 + Number((frac + '0000').slice(0, 4))
  return Number.isSafeInteger(units) ? units : null
}

export function purchaseBlock(balanceUnits: number, upfrontCost: string, monthlyCost: string): { status: number, message: string } | null {
  const upfront = priceUnits(upfrontCost)
  const monthly = priceUnits(monthlyCost)
  if (upfront == null || monthly == null) return { status: 400, message: 'Telnyx did not price that number.' }
  const charge = upfront > 0 ? upfront : monthly
  if (balanceUnits <= 0) return { status: 402, message: 'Your balance is $0.00. Request credit and wait for approval before buying a number.' }
  if (balanceUnits < charge) return { status: 402, message: `This number costs ${fromUnits(charge)} and your balance is ${fromUnits(balanceUnits)}.` }
  return null
}

export function verifyTelnyx(rawBody: string, timestamp: string, signature: string, publicKey: string): boolean {
  const unix = Number(timestamp)
  if (!Number.isFinite(unix)) return false
  if (Math.abs(Date.now() / 1000 - unix) > 5 * 60) return false
  try {
    return verify(null, Buffer.from(`${timestamp}|${rawBody}`), ed25519Key(publicKey), Buffer.from(signature, 'base64'))
  } catch {
    return false
  }
}

function ed25519Key(publicKey: string): KeyObject {
  const raw = Buffer.from(publicKey, 'base64')
  if (raw.length === 32) {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw])
    return createPublicKey({ key: spki, format: 'der', type: 'spki' })
  }
  return createPublicKey({ key: raw, format: 'der', type: 'spki' })
}

function stringOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}
