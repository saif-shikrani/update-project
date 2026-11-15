import { randomUUID } from 'node:crypto'
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { extname, join } from 'node:path'
import pino from 'pino'
import QRCode from 'qrcode'
import { hasReplied, listHistoryAnchors, listUnanswered, markReplied, saveMessage, setChatName, userRepliedAfter } from './db.ts'
import { extractText, extractWaMedia, messageTimeIso, type WaMediaKind } from './logic.ts'
import { draftReply, learnReplyPattern } from './reply.ts'

const MEDIA_ROOT = 'data/whatsapp-media'
const MAX_MEDIA_BYTES = 25 * 1024 * 1024
mkdirSync(MEDIA_ROOT, { recursive: true })

export type WaStatus = {
  connection: 'starting' | 'qr' | 'open' | 'close' | 'error'
  qrDataUrl: string | null
  error: string | null
}

type Listener = (status: WaStatus) => void

const listeners = new Set<Listener>()
let status: WaStatus = { connection: 'starting', qrDataUrl: null, error: null }
let socket: any = null
let restartTimer: NodeJS.Timeout | null = null
let connecting = false
let learnTimer: NodeJS.Timeout | null = null
let catchUpTimer: NodeJS.Timeout | null = null
const replying = new Set<string>()
const autoIds = new Set<string>()
const autoBodies = new Map<string, { body: string, until: number }>()

export function whatsAppStatus() {
  return status
}

export function subscribeWhatsApp(listener: Listener) {
  listeners.add(listener)
  listener(status)
  return () => listeners.delete(listener)
}

export function startWhatsApp() {
  void connect()
}

function publish(next: WaStatus, extra?: { type: string }) {
  status = next
  const event = extra ? { ...next, ...extra } : next
  for (const listener of listeners) listener(event as WaStatus)
}

async function connect() {
  if (connecting) return
  connecting = true
  publish({ connection: 'starting', qrDataUrl: null, error: null })
  try {
    const baileys = await import('baileys')
    const { state, saveCreds } = await baileys.useMultiFileAuthState('data/baileys-auth')
    let version: number[] | undefined
    try {
      version = await Promise.race([
        baileys.fetchLatestBaileysVersion().then((result) => result.version),
        new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 8000)),
      ])
    } catch {
      version = undefined
    }
    const sock: any = baileys.default({
      ...(version ? { version: version as [number, number, number] } : {}),
      auth: state,
      logger: pino({ level: 'silent' }),
    })
    socket = sock
    sock.ev.on('creds.update', saveCreds)
    sock.ev.on('connection.update', (update: { connection?: string, qr?: string, lastDisconnect?: { error?: { output?: { statusCode?: number } } } }) => {
      void onConnection(update)
    })
    sock.ev.on('messages.upsert', (upsert: { type?: string, messages?: IncomingMessage[] }) => { void onMessages(upsert) })
    sock.ev.on('messaging-history.set', (history: { messages?: IncomingMessage[] }) => {
      void onMessages({ type: 'append', messages: history.messages })
      scheduleLearn()
      scheduleCatchUp()
    })
    sock.ev.on('chats.upsert', (chats: { id?: string | null, name?: string | null }[]) => onChats(chats))
    sock.ev.on('chats.update', (chats: { id?: string | null, name?: string | null }[]) => onChats(chats))
  } catch (error) {
    publish({
      connection: 'error',
      qrDataUrl: null,
      error: error instanceof Error ? error.message : 'WhatsApp failed to start.',
    })
  } finally {
    connecting = false
  }
}

async function onConnection(update: { connection?: string, qr?: string, lastDisconnect?: { error?: { output?: { statusCode?: number } } } }) {
  if (update.qr) {
    const qrDataUrl = await QRCode.toDataURL(update.qr, { margin: 1, width: 280 })
    publish({ connection: 'qr', qrDataUrl, error: null })
  }
  if (update.connection === 'open') {
    publish({ connection: 'open', qrDataUrl: null, error: null })
    void pullHistory()
    scheduleCatchUp()
  }
  if (update.connection !== 'close') return
  const code = update.lastDisconnect?.error?.output?.statusCode
  socket = null
  if (code === 401) {
    publish({
      connection: 'close',
      qrDataUrl: null,
      error: 'WhatsApp logged this device out. Delete data/baileys-auth and restart to link again.',
    })
    return
  }
  publish({ connection: 'close', qrDataUrl: null, error: 'WhatsApp disconnected. Reconnecting.' })
  if (restartTimer) clearTimeout(restartTimer)
  restartTimer = setTimeout(() => {
    void connect()
  }, 2000)
}

async function onMessages(upsert: { type?: string, messages?: IncomingMessage[] }) {
  if (upsert.type !== 'notify' && upsert.type !== 'append') return
  let saved = false
  for (const message of upsert.messages ?? []) {
    const jid = message.key?.remoteJid
    const id = message.key?.id
    if (!jid || !id || jid === 'status@broadcast' || jid.endsWith('@broadcast')) continue
    const text = extractText(message.message)
    const media = extractWaMedia(message.message)
    if (!text && !media) continue
    const fromMe = Boolean(message.key?.fromMe)
    const body = text || (media?.kind === 'image' ? '[Image]' : '[Document]')
    const source = fromMe && isAutomatic(jid, id, body) ? 'auto' : 'user'
    const timestamp = messageTimeIso(message.messageTimestamp)
    let mediaPath: string | null = null
    let mediaSize: number | null = null
    if (media) {
      try {
        const downloaded = await downloadIncomingMedia(message, media)
        mediaPath = downloaded.path
        mediaSize = downloaded.size
      } catch (error) {
        console.error(error instanceof Error ? error.message : error)
        continue
      }
    }
    const inserted = saveMessage({
      waMessageId: id,
      chatJid: jid,
      sender: fromMe ? 'me' : message.key?.participant || jid,
      pushName: fromMe ? null : message.pushName ?? null,
      body,
      timestamp,
      displayName: fromMe || jid.endsWith('@g.us') ? null : message.pushName ?? null,
      fromMe,
      source,
      kind: media?.kind ?? 'text',
      mimeType: media?.mimeType ?? null,
      fileName: media?.fileName ?? null,
      mediaPath,
      mediaSize,
      caption: media?.caption ?? null,
    })
    if (!inserted) continue
    saved = true
    if (fromMe && source === 'user') scheduleLearn()
    const age = Date.now() - Date.parse(timestamp)
    if (!fromMe && !media && upsert.type === 'notify' && !jid.endsWith('@g.us') && age >= 0 && age < 2 * 60 * 1000) {
      scheduleAutoReply(jid, id, body, timestamp)
    }

  }
  if (saved) publish(status, { type: 'message' })
}

function scheduleLearn() {
  if (learnTimer) clearTimeout(learnTimer)
  learnTimer = setTimeout(() => {
    learnReplyPattern().catch((error) => {
      console.error(error instanceof Error ? error.message : error)
    })
  }, 4000)
}

function scheduleCatchUp() {
  if (catchUpTimer) clearTimeout(catchUpTimer)
  catchUpTimer = setTimeout(() => {
    const since = new Date(Date.now() - 30 * 60 * 1000).toISOString()
    for (const message of listUnanswered(since)) {
      void sendAutoReply(message.chat_jid, message.wa_message_id, message.body, message.timestamp)
    }
  }, 3000)
}

async function pullHistory() {
  if (!socket?.fetchMessageHistory) return
  for (const anchor of listHistoryAnchors()) {
    try {
      await socket.fetchMessageHistory(40, {
        remoteJid: anchor.chat_jid,
        id: anchor.wa_message_id,
        fromMe: anchor.from_me === 1,
      }, Date.parse(anchor.timestamp))
    } catch (error) {
      console.error(error instanceof Error ? error.message : error)
    }
  }
}

function scheduleAutoReply(jid: string, inboundId: string, text: string, timestamp: string) {
  setTimeout(() => {
    void sendAutoReply(jid, inboundId, text, timestamp)
  }, 8000)
}

async function sendAutoReply(jid: string, inboundId: string, text: string, timestamp: string) {
  if (!socket || replying.has(inboundId) || hasReplied(inboundId) || userRepliedAfter(jid, timestamp)) return
  replying.add(inboundId)
  try {
    const reply = await draftReply(jid, text)
    if (!reply || hasReplied(inboundId) || userRepliedAfter(jid, timestamp)) return
    const sent = await socket.sendMessage(jid, { text: reply })
    const sentId = sent?.key?.id
    if (sentId) autoIds.add(String(sentId))
    autoBodies.set(jid, { body: reply, until: Date.now() + 30_000 })
    markReplied(inboundId)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
  } finally {
    replying.delete(inboundId)
  }
}

function isAutomatic(jid: string, id: string, body: string) {
  if (autoIds.delete(id)) return true
  const recent = autoBodies.get(jid)
  if (recent && recent.body === body && recent.until > Date.now()) {
    autoBodies.delete(jid)
    return true
  }
  return false
}

async function downloadIncomingMedia(message: IncomingMessage, media: { kind: WaMediaKind, mimeType: string | null, fileName: string | null }) {
  const declaredSize = findMediaSize(message.message)
  if (declaredSize && declaredSize > MAX_MEDIA_BYTES) throw new Error('WhatsApp media is larger than the 25 MB limit.')
  if (!socket?.updateMediaMessage) throw new Error('WhatsApp media download is not ready.')
  const baileys = await import('baileys')
  const buffer = await baileys.downloadMediaMessage(
    message as never,
    'buffer',
    {},
    { reuploadRequest: socket.updateMediaMessage, logger: pino({ level: 'silent' }) },
  )
  if (buffer.length > MAX_MEDIA_BYTES) throw new Error('WhatsApp media is larger than the 25 MB limit.')
  const path = storeMedia(buffer, media.mimeType, media.fileName)
  return { path, size: buffer.length }
}

export async function sendText(jid: string, body: string) {
    if (!socket?.sendMessage) throw new Error('WhatsApp is not connected.')
    const clean = body.trim()
    if (!clean) throw new Error('Message text is required.')
    const sent = await socket.sendMessage(jid, { text: clean })
    const id = sent?.key?.id
    if (!id) throw new Error('WhatsApp did not return a message id.')
    saveMessage({
      waMessageId: String(id),
      chatJid: jid,
      sender: 'me',
      pushName: null,
      body: clean,
      timestamp: new Date().toISOString(),
      displayName: null,
      fromMe: true,
      source: 'user',
      kind: 'text',
      mimeType: null,
      fileName: null,
      mediaPath: null,
      mediaSize: null,
      caption: clean,
    })
    publish(status, { type: 'message' })
    return { id: String(id) }
  }

export async function sendMedia(jid: string, input: {
    buffer: Buffer
    mimeType: string
    fileName: string | null
    caption: string | null
  }) {
    if (!socket?.sendMessage) throw new Error('WhatsApp is not connected.')
    if (input.buffer.length > MAX_MEDIA_BYTES) throw new Error('Media is larger than the 25 MB limit.')
    const kind: WaMediaKind = input.mimeType.startsWith('image/') ? 'image' : 'document'
    const fileName = input.fileName || (kind === 'image' ? 'image' : 'document')
    const mediaPath = storeMedia(input.buffer, input.mimeType, fileName)
    const content = kind === 'image'
      ? { image: input.buffer, caption: input.caption || undefined, mimetype: input.mimeType }
      : { document: input.buffer, mimetype: input.mimeType, fileName, caption: input.caption || undefined }
    try {
      const sent = await socket.sendMessage(jid, content)
      const id = sent?.key?.id
      if (!id) throw new Error('WhatsApp did not return a message id.')
      saveMessage({
        waMessageId: String(id),
        chatJid: jid,
        sender: 'me',
        pushName: null,
        body: input.caption || (kind === 'image' ? '[Image]' : '[Document]'),
        timestamp: new Date().toISOString(),
        displayName: null,
        fromMe: true,
        source: 'user',
        kind,
        mimeType: input.mimeType,
        fileName,
        mediaPath,
        mediaSize: input.buffer.length,
        caption: input.caption,
      })
      publish(status, { type: 'message' })
      return { id: String(id) }
    } catch (error) {
      unlinkSync(mediaPath)
      throw error
    }
  }

export function maxMediaBytes() {
  return MAX_MEDIA_BYTES
}

function storeMedia(buffer: Buffer, mimeType: string | null, fileName: string | null) {
    const extension = mediaExtension(mimeType, fileName)
    const relative = join(MEDIA_ROOT, `${randomUUID()}${extension}`)
    writeFileSync(relative, buffer, { flag: 'wx' })
    return relative
  }

function mediaExtension(mimeType: string | null, fileName: string | null) {
    const known = mimeType?.split('/')[1]?.replace(/[^a-z0-9]/gi, '').toLowerCase()
    const original = fileName ? extname(fileName).toLowerCase().replace(/[^a-z0-9.]/g, '') : ''
    if (original && original.length <= 8) return original
    if (known === 'jpeg') return '.jpg'
    if (known && known.length <= 8) return `.${known}`
    return ''
  }

function findMediaSize(message: unknown): number | null {
    if (!message || typeof message !== 'object') return null
    const record = message as Record<string, unknown>
    for (const key of ['imageMessage', 'documentMessage']) {
      const value = record[key]
      if (value && typeof value === 'object') {
        const size = Number((value as { fileLength?: unknown }).fileLength)
        if (Number.isFinite(size) && size > 0) return size
      }
    }
    for (const key of ['ephemeralMessage', 'viewOnceMessage', 'viewOnceMessageV2', 'documentWithCaptionMessage']) {
      const wrapped = record[key]
      const inner = wrapped && typeof wrapped === 'object' ? (wrapped as { message?: unknown }).message : null
      const size = findMediaSize(inner)
      if (size) return size
    }
    return null
  }

function onChats(chats: { id?: string | null, name?: string | null }[]) {
  for (const chat of chats ?? []) {
    if (chat.id && chat.name) setChatName(chat.id, chat.name)
  }
}

type IncomingMessage = {
  key?: { fromMe?: boolean, remoteJid?: string | null, id?: string | null, participant?: string | null }
  pushName?: string | null
  message?: unknown
  messageTimestamp?: unknown
}
