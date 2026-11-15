import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { durationSeconds, nextStatus, toUnits } from './logic.ts'

mkdirSync('data', { recursive: true })

export const db = new DatabaseSync('data/app.db')
db.exec(`
PRAGMA journal_mode = DELETE;
CREATE TABLE IF NOT EXISTS calls (
  id INTEGER PRIMARY KEY,
  client_call_id TEXT UNIQUE,
  call_session_id TEXT UNIQUE,
  call_leg_id TEXT,
  call_control_id TEXT,
  direction TEXT,
  from_number TEXT,
  to_number TEXT,
  status TEXT NOT NULL DEFAULT 'initiated',
  started_at TEXT,
  answered_at TEXT,
  ended_at TEXT,
  duration_seconds INTEGER,
  billable_seconds INTEGER,
  cost_amount TEXT,
  currency TEXT,
  hangup_cause TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_chats (
  jid TEXT PRIMARY KEY,
  display_name TEXT,
  summary_text TEXT,
  summary_model TEXT,
  summary_at TEXT,
  summary_message_count INTEGER
);
CREATE TABLE IF NOT EXISTS wa_messages (
  id INTEGER PRIMARY KEY,
  wa_message_id TEXT UNIQUE,
  chat_jid TEXT NOT NULL,
  sender TEXT,
  push_name TEXT,
  body TEXT NOT NULL,
  timestamp TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'text',
  mime_type TEXT,
  file_name TEXT,
  media_path TEXT,
  media_size INTEGER,
  caption TEXT
);
CREATE INDEX IF NOT EXISTS wa_messages_chat ON wa_messages (chat_jid, timestamp);
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS wa_replies (
  inbound_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  balance_units INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_requests (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount_units INTEGER NOT NULL,
  note TEXT,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by INTEGER
);
CREATE TABLE IF NOT EXISTS ledger (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  amount_units INTEGER NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT,
  note TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS owned_numbers (
  phone_number TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  region TEXT,
  upfront_cost TEXT,
  monthly_cost TEXT,
  currency TEXT,
  ordered_at TEXT NOT NULL
);
`)

const messageColumns = db.prepare('PRAGMA table_info(wa_messages)').all() as { name: string }[]
if (!messageColumns.some((column) => column.name === 'from_me')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN from_me INTEGER NOT NULL DEFAULT 0')
}
if (!messageColumns.some((column) => column.name === 'source')) {
  db.exec("ALTER TABLE wa_messages ADD COLUMN source TEXT NOT NULL DEFAULT 'user'")
}
if (!messageColumns.some((column) => column.name === 'kind')) {
  db.exec("ALTER TABLE wa_messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'text'")
}
if (!messageColumns.some((column) => column.name === 'mime_type')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN mime_type TEXT')
}
if (!messageColumns.some((column) => column.name === 'file_name')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN file_name TEXT')
}
if (!messageColumns.some((column) => column.name === 'media_path')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN media_path TEXT')
}
if (!messageColumns.some((column) => column.name === 'media_size')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN media_size INTEGER')
}
if (!messageColumns.some((column) => column.name === 'caption')) {
  db.exec('ALTER TABLE wa_messages ADD COLUMN caption TEXT')
}

const callColumns = db.prepare('PRAGMA table_info(calls)').all() as { name: string }[]
if (!callColumns.some((column) => column.name === 'user_id')) {
  db.exec('ALTER TABLE calls ADD COLUMN user_id INTEGER')
}
if (!callColumns.some((column) => column.name === 'charged')) {
  db.exec('ALTER TABLE calls ADD COLUMN charged INTEGER NOT NULL DEFAULT 0')
}

type CallRow = {
  id: number
  client_call_id: string | null
  call_session_id: string | null
  call_leg_id: string | null
  call_control_id: string | null
  direction: string | null
  from_number: string | null
  to_number: string | null
  status: string
  started_at: string | null
  answered_at: string | null
  ended_at: string | null
  duration_seconds: number | null
  billable_seconds: number | null
  cost_amount: string | null
  currency: string | null
  hangup_cause: string | null
  created_at: string
  user_id?: number | null
  charged?: number | null
}

export type CallPatch = {
  clientCallId?: string | null
  callSessionId?: string | null
  callLegId?: string | null
  callControlId?: string | null
  direction?: string | null
  from?: string | null
  to?: string | null
  status?: string | null
  startedAt?: string | null
  answeredAt?: string | null
  endedAt?: string | null
  hangupCause?: string | null
  costAmount?: string | null
  currency?: string | null
  billableSeconds?: number | null
}

export function callJson(row: CallRow) {
  return {
    id: row.id,
    direction: row.direction,
    from: row.from_number,
    to: row.to_number,
    status: row.status,
    startedAt: row.started_at,
    answeredAt: row.answered_at,
    endedAt: row.ended_at,
    durationSeconds: row.duration_seconds,
    billableSeconds: row.billable_seconds,
    costAmount: row.cost_amount,
    currency: row.currency,
    hangupCause: row.hangup_cause,
  }
}

export function listCalls(userId: number) {
  return db.prepare(`
    SELECT * FROM calls
    WHERE user_id = ?
    ORDER BY COALESCE(started_at, created_at) DESC
    LIMIT 200
  `).all(userId).map((row) => callJson(row as CallRow))
}

export function getCall(id: number) {
  const row = db.prepare('SELECT * FROM calls WHERE id = ?').get(id) as CallRow | undefined
  return row ? { row, json: callJson(row) } : null
}

export function upsertCall(patch: CallPatch, userId?: number) {
  const existing = findCall(patch)
  const status = patch.status ? nextStatus(existing?.status ?? null, patch.status) : existing?.status ?? 'initiated'
  const answeredAt = patch.answeredAt || existing?.answered_at || null
  const endedAt = patch.endedAt || existing?.ended_at || null
  const finished = status === 'hangup' || status === 'failed'
  const duration = finished ? durationSeconds(answeredAt, endedAt) : existing?.duration_seconds ?? null
  const values = {
    client_call_id: patch.clientCallId || existing?.client_call_id || null,
    call_session_id: patch.callSessionId || existing?.call_session_id || null,
    call_leg_id: patch.callLegId || existing?.call_leg_id || null,
    call_control_id: patch.callControlId || existing?.call_control_id || null,
    direction: patch.direction || existing?.direction || null,
    from_number: patch.from || existing?.from_number || null,
    to_number: patch.to || existing?.to_number || null,
    status,
    started_at: patch.startedAt || existing?.started_at || new Date().toISOString(),
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: duration,
    billable_seconds: patch.billableSeconds ?? existing?.billable_seconds ?? null,
    cost_amount: patch.costAmount || existing?.cost_amount || null,
    currency: patch.currency || existing?.currency || null,
    hangup_cause: patch.hangupCause || existing?.hangup_cause || null,
  }
  if (!existing) {
    const result = db.prepare(`
      INSERT INTO calls (
        client_call_id, call_session_id, call_leg_id, call_control_id, direction,
        from_number, to_number, status, started_at, answered_at, ended_at,
        duration_seconds, billable_seconds, cost_amount, currency, hangup_cause, created_at, user_id
      ) VALUES (
        :client_call_id, :call_session_id, :call_leg_id, :call_control_id, :direction,
        :from_number, :to_number, :status, :started_at, :answered_at, :ended_at,
        :duration_seconds, :billable_seconds, :cost_amount, :currency, :hangup_cause, :created_at, :user_id
      )
    `).run({ ...values, created_at: new Date().toISOString(), user_id: userId ?? null })
    return getCall(Number(result.lastInsertRowid))!
  }
  db.prepare(`
    UPDATE calls SET
      client_call_id = :client_call_id,
      call_session_id = :call_session_id,
      call_leg_id = :call_leg_id,
      call_control_id = :call_control_id,
      direction = :direction,
      from_number = :from_number,
      to_number = :to_number,
      status = :status,
      started_at = :started_at,
      answered_at = :answered_at,
      ended_at = :ended_at,
      duration_seconds = :duration_seconds,
      billable_seconds = :billable_seconds,
      cost_amount = :cost_amount,
      currency = :currency,
      hangup_cause = :hangup_cause
    WHERE id = :id
  `).run({ ...values, id: existing.id })
  return getCall(existing.id)!
}

function findCall(patch: CallPatch): CallRow | null {
  const lookups: [string, string | null | undefined][] = [
    ['call_session_id', patch.callSessionId],
    ['client_call_id', patch.clientCallId],
    ['call_control_id', patch.callControlId],
    ['call_leg_id', patch.callLegId],
  ]
  for (const [column, value] of lookups) {
    if (!value) continue
    const row = db.prepare(`SELECT * FROM calls WHERE ${column} = ?`).get(value) as CallRow | undefined
    if (row) return row
  }
  if (patch.to && patch.callSessionId) {
    const row = db.prepare(`
      SELECT * FROM calls
      WHERE to_number = ? AND call_session_id IS NULL
      ORDER BY id DESC
      LIMIT 1
    `).get(patch.to) as CallRow | undefined
    const age = row ? Date.now() - Date.parse(row.created_at) : Number.POSITIVE_INFINITY
    if (row && age >= 0 && age < 2 * 60 * 1000) return row
  }
  return null
}

export function setCallCost(id: number, amount: string, currency: string | null, billableSeconds: number | null) {
  db.exec('BEGIN')
  try {
    const row = db.prepare('SELECT user_id, charged FROM calls WHERE id = ?').get(id) as { user_id: number | null, charged: number } | undefined
    db.prepare(`
      UPDATE calls
      SET cost_amount = ?, currency = ?, billable_seconds = COALESCE(?, billable_seconds)
      WHERE id = ?
    `).run(amount, currency, billableSeconds, id)
    const units = toUnits(amount) ?? 0
    if (row?.user_id && !row.charged && units > 0) {
      db.prepare('UPDATE users SET balance_units = balance_units - ? WHERE id = ?').run(units, row.user_id)
      db.prepare(`
        INSERT INTO ledger (user_id, amount_units, kind, ref, note, created_at)
        VALUES (?, ?, 'call', ?, 'Call', ?)
      `).run(row.user_id, -units, String(id), new Date().toISOString())
      db.prepare('UPDATE calls SET charged = 1 WHERE id = ?').run(id)
    } else if (row && !row.charged) {
      db.prepare('UPDATE calls SET charged = 1 WHERE id = ?').run(id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return getCall(id)!
}

export function homeTotals() {
  const time = db.prepare(`
    SELECT
      COALESCE(SUM(duration_seconds), 0) AS seconds,
      SUM(CASE WHEN status = 'hangup' AND cost_amount IS NULL THEN 1 ELSE 0 END) AS pending
    FROM calls
  `).get() as { seconds: number, pending: number | null }
  const costs = db.prepare(`
    SELECT COALESCE(currency, '') AS currency, SUM(CAST(cost_amount AS REAL)) AS amount
    FROM calls
    WHERE cost_amount IS NOT NULL
    GROUP BY currency
  `).all() as { currency: string, amount: number }[]
  const texts = db.prepare('SELECT COUNT(*) AS count FROM wa_messages WHERE from_me = 0').get() as { count: number }
  return {
    durationSeconds: time.seconds ?? 0,
    pendingCostCount: time.pending ?? 0,
    costs: costs.map((row) => ({ currency: row.currency || null, amount: Number(row.amount).toFixed(4) })),
    inboundTextCount: Number(texts.count ?? 0),
  }
}

export function saveText(input: {
  waMessageId: string
  chatJid: string
  sender: string | null
  pushName: string | null
  body: string
  timestamp: string
  displayName: string | null
  fromMe: boolean
  source: 'user' | 'auto'
}) {
  return saveMessage({ ...input, kind: 'text', mimeType: null, fileName: null, mediaPath: null, mediaSize: null, caption: input.body })
}

export function saveMessage(input: {
  waMessageId: string
  chatJid: string
  sender: string | null
  pushName: string | null
  body: string
  timestamp: string
  displayName: string | null
  fromMe: boolean
  source: 'user' | 'auto'
  kind: 'text' | 'image' | 'document'
  mimeType: string | null
  fileName: string | null
  mediaPath: string | null
  mediaSize: number | null
  caption: string | null
}) {
  db.exec('BEGIN')
  try {
    const inserted = db.prepare(`
      INSERT OR IGNORE INTO wa_messages (
        wa_message_id, chat_jid, sender, push_name, body, timestamp, from_me, source,
        kind, mime_type, file_name, media_path, media_size, caption
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.waMessageId,
      input.chatJid,
      input.sender,
      input.pushName,
      input.body,
      input.timestamp,
      input.fromMe ? 1 : 0,
      input.source,
      input.kind,
      input.mimeType,
      input.fileName,
      input.mediaPath,
      input.mediaSize,
      input.caption,
    )
    if (Number(inserted.changes) > 0 && input.displayName) {
      db.prepare(`
        INSERT INTO wa_chats (jid, display_name) VALUES (?, ?)
        ON CONFLICT(jid) DO UPDATE SET
          display_name = COALESCE(wa_chats.display_name, excluded.display_name)
      `).run(input.chatJid, input.displayName)
    } else if (Number(inserted.changes) > 0) {
      db.prepare('INSERT OR IGNORE INTO wa_chats (jid) VALUES (?)').run(input.chatJid)
    }
    db.exec('COMMIT')
    return Number(inserted.changes) > 0
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

export function setChatName(jid: string, name: string) {
  db.prepare(`
    INSERT INTO wa_chats (jid, display_name) VALUES (?, ?)
    ON CONFLICT(jid) DO UPDATE SET display_name = excluded.display_name
  `).run(jid, name)
}

export function listChats() {
  return db.prepare(`
    SELECT
      m.chat_jid AS jid,
      c.display_name AS display_name,
      SUM(CASE WHEN m.from_me = 0 THEN 1 ELSE 0 END) AS message_count,
      COUNT(*) AS transcript_count,
      MIN(m.timestamp) AS first_message_at,
      MAX(m.timestamp) AS last_message_at,
      c.summary_text AS summary_text,
      c.summary_model AS summary_model,
      c.summary_at AS summary_at,
      c.summary_message_count AS summary_message_count
    FROM wa_messages m
    LEFT JOIN wa_chats c ON c.jid = m.chat_jid
    GROUP BY m.chat_jid
    ORDER BY last_message_at DESC
  `).all().map((row) => {
    const chat = row as {
      jid: string
      display_name: string | null
      message_count: number
      transcript_count: number
      first_message_at: string
      last_message_at: string
      summary_text: string | null
      summary_model: string | null
      summary_at: string | null
      summary_message_count: number | null
    }
    const last = db.prepare(`
      SELECT body FROM wa_messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 1
    `).get(chat.jid) as { body: string } | undefined
    return {
      jid: chat.jid,
      displayName: chat.display_name,
      messageCount: Number(chat.message_count),
      transcriptCount: Number(chat.transcript_count),
      firstMessageAt: chat.first_message_at,
      lastMessageAt: chat.last_message_at,
      lastText: last?.body ?? '',
      summaryText: chat.summary_text,
      summaryModel: chat.summary_model,
      summaryAt: chat.summary_at,
      summaryMessageCount: chat.summary_message_count,
      summaryStale: Boolean(chat.summary_text) && Number(chat.summary_message_count) !== Number(chat.transcript_count),
    }
  })
}

export function listMessages(jid: string) {
  return db.prepare(`
    SELECT id, sender, push_name, body, timestamp, from_me, kind, mime_type, file_name, media_size, caption
    FROM wa_messages
    WHERE chat_jid = ?
    ORDER BY timestamp ASC
  `).all(jid).map((row) => {
    const message = row as {
      id: number
      sender: string | null
      push_name: string | null
      body: string
      timestamp: string
      from_me: number
      kind: string
      mime_type: string | null
      file_name: string | null
      media_size: number | null
      caption: string | null
    }
    return {
      id: message.id,
      sender: message.sender,
      pushName: message.push_name,
      body: message.body,
      timestamp: message.timestamp,
      fromMe: message.from_me === 1,
      kind: message.kind || 'text',
      mimeType: message.mime_type,
      fileName: message.file_name,
      mediaSize: message.media_size,
      caption: message.caption,
    }
  })
}

export function mediaMessage(id: number) {
  return db.prepare(`
    SELECT id, media_path, mime_type, file_name, media_size
    FROM wa_messages
    WHERE id = ? AND media_path IS NOT NULL
  `).get(id) as {
    id: number
    media_path: string
    mime_type: string | null
    file_name: string | null
    media_size: number | null
  } | undefined
}

export function saveSummary(jid: string, text: string, model: string, messageCount: number) {
  db.prepare(`
    INSERT INTO wa_chats (jid, summary_text, summary_model, summary_at, summary_message_count)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(jid) DO UPDATE SET
      summary_text = excluded.summary_text,
      summary_model = excluded.summary_model,
      summary_at = excluded.summary_at,
      summary_message_count = excluded.summary_message_count
  `).run(jid, text, model, new Date().toISOString(), messageCount)
}

export function getSetting(key: string): string | null {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as { value: string } | undefined
  return row?.value ?? null
}

export function setSetting(key: string, value: string) {
  db.prepare(`
    INSERT INTO app_settings (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, value)
}

export function listReplyRows() {
  return db.prepare(`
    SELECT chat_jid, body, from_me, source
    FROM (
      SELECT chat_jid, body, from_me, source, timestamp
      FROM wa_messages
      ORDER BY timestamp DESC
      LIMIT 500
    )
    ORDER BY timestamp ASC
  `).all().map((row) => {
    const message = row as { chat_jid: string, body: string, from_me: number, source: string }
    return {
      chatJid: message.chat_jid,
      body: message.body,
      fromMe: message.from_me === 1,
      source: message.source || 'user',
    }
  })
}

export function recentChat(jid: string, limit: number) {
  const rows = db.prepare(`
    SELECT body, from_me FROM wa_messages
    WHERE chat_jid = ?
    ORDER BY timestamp DESC
    LIMIT ?
  `).all(jid, limit) as { body: string, from_me: number }[]
  return rows.reverse().map((row) => ({ body: row.body, fromMe: row.from_me === 1 }))
}

export function listHistoryAnchors() {
  return db.prepare(`
    SELECT chat_jid, wa_message_id, from_me, timestamp
    FROM wa_messages
    WHERE id IN (SELECT MIN(id) FROM wa_messages GROUP BY chat_jid)
  `).all() as { chat_jid: string, wa_message_id: string, from_me: number, timestamp: string }[]
}

export function listUnanswered(sinceIso: string) {
  return db.prepare(`
    SELECT chat_jid, wa_message_id, body, timestamp
    FROM wa_messages m
    WHERE from_me = 0
      AND chat_jid NOT LIKE '%@g.us'
      AND chat_jid NOT LIKE '%@broadcast'
      AND timestamp >= ?
      AND timestamp = (
        SELECT MAX(timestamp) FROM wa_messages
        WHERE chat_jid = m.chat_jid AND from_me = 0
      )
      AND NOT EXISTS (
        SELECT 1 FROM wa_messages u
        WHERE u.chat_jid = m.chat_jid AND u.timestamp > m.timestamp AND u.from_me = 1 AND u.source = 'user'
      )
      AND NOT EXISTS (
        SELECT 1 FROM wa_replies r WHERE r.inbound_id = m.wa_message_id
      )
  `).all(sinceIso) as { chat_jid: string, wa_message_id: string, body: string, timestamp: string }[]
}

export function userRepliedAfter(jid: string, timestamp: string) {
  const row = db.prepare(`
    SELECT 1 AS hit FROM wa_messages
    WHERE chat_jid = ? AND timestamp > ? AND from_me = 1 AND source = 'user'
    LIMIT 1
  `).get(jid, timestamp) as { hit: number } | undefined
  return Boolean(row)
}

export function hasReplied(inboundId: string) {
  return Boolean(db.prepare('SELECT 1 AS hit FROM wa_replies WHERE inbound_id = ?').get(inboundId))
}

export function markReplied(inboundId: string) {
  db.prepare('INSERT OR IGNORE INTO wa_replies (inbound_id, created_at) VALUES (?, ?)').run(inboundId, new Date().toISOString())
}
