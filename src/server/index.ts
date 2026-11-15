import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve } from 'node:path'
import Fastify from 'fastify'
import { getCall, listAdminCalls, listCalls, listChats, listMessages, saveCallSummary, saveSummary, upsertCall } from './db.ts'
import { loadEnv } from './env.ts'
import { transcriptLines } from './logic.ts'
import { geminiAudio, geminiText } from './gemini.ts'
import { applyWebhook, checkWebhook, loginToken, refreshCallCost } from './telnyx.ts'
import { replyState, setAutoReply } from './reply.ts'
import { startWhatsApp, subscribeWhatsApp, whatsAppStatus } from './whatsapp.ts'
import { login, logout, publicUser, readSession, sessionCookie, signup, userFromToken, type AuthUser } from './auth.ts'
import { balanceOf, buyNumber, dashboardFor, decideCredit, gallery, listCredits, myNumbers, requestCredit } from './accounts.ts'

loadEnv()

const app = Fastify({ logger: true })

app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (request, body, done) => {
  const raw = body.toString('utf8')
  try {
    done(null, { raw, json: raw ? JSON.parse(raw) : {} })
  } catch (error) {
    ;(error as { statusCode?: number }).statusCode = 400
    done(error as Error, undefined)
  }
})

app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
  const statusCode = error.statusCode ?? 500
  reply.code(statusCode).send({ error: error.message || 'Request failed' })
})

const actors = new WeakMap<object, AuthUser>()

app.addHook('onRequest', async (request, reply) => {
  const url = request.url.split('?')[0]
  if (!url.startsWith('/api/') || url === '/api/health' || url === '/api/telnyx/webhook' || url.startsWith('/api/auth/')) return
  const user = userFromToken(readSession(request.headers.cookie))
  if (!user) return reply.code(401).send({ error: 'Sign in required.' })
  if (url.startsWith('/api/whatsapp') && user.role !== 'admin') {
    return reply.code(403).send({ error: 'WhatsApp is limited to the admin account.' })
  }
  actors.set(request, user)
})

function actor(request: object) {
  const user = actors.get(request)
  if (!user) {
    const error = new Error('Sign in required.') as Error & { statusCode?: number }
    error.statusCode = 401
    throw error
  }
  return user
}

app.get('/api/health', async () => ({ ok: true }))

app.post('/api/auth/signup', async (request, reply) => {
  const body = jsonBody(request)
  const session = signup({
    email: text(body.email) || '',
    name: text(body.name) || '',
    password: typeof body.password === 'string' ? body.password : '',
  })
  reply.header('set-cookie', sessionCookie(session.token))
  return publicUser(session.user)
})

app.post('/api/auth/login', async (request, reply) => {
  const body = jsonBody(request)
  const session = login(text(body.email) || '', typeof body.password === 'string' ? body.password : '')
  reply.header('set-cookie', sessionCookie(session.token))
  return publicUser(session.user)
})

app.post('/api/auth/logout', async (request, reply) => {
  logout(readSession(request.headers.cookie))
  reply.header('set-cookie', sessionCookie('', 0))
  return { ok: true }
})

app.get('/api/auth/me', async (request) => {
  const user = userFromToken(readSession(request.headers.cookie))
  if (!user) {
    const error = new Error('Sign in required.') as Error & { statusCode?: number }
    error.statusCode = 401
    throw error
  }
  return publicUser(user)
})

app.get('/api/dashboard', async (request) => dashboardFor(actor(request).id))

app.get('/api/numbers/available', async (request) => {
  const query = request.query as { country?: string, area?: string, contains?: string }
  return gallery(query)
})

app.get('/api/numbers', async (request) => myNumbers(actor(request).id))

app.post('/api/numbers/order', async (request) => {
  const body = jsonBody(request)
  return buyNumber(actor(request), text(body.phoneNumber) || '', text(body.country) || '')
})

app.get('/api/billing/requests', async (request) => listCredits(actor(request)))

app.post('/api/billing/requests', async (request) => {
  const body = jsonBody(request)
  return requestCredit(actor(request).id, text(body.amount) || '', text(body.note) || '')
})

app.post<{ Params: { id: string } }>('/api/billing/requests/:id/approve', async (request) => {
  const user = actor(request)
  if (user.role !== 'admin') {
    const error = new Error('Only an admin can approve credit.') as Error & { statusCode?: number }
    error.statusCode = 403
    throw error
  }
  return decideCredit(user.id, Number(request.params.id), true)
})

app.post<{ Params: { id: string } }>('/api/billing/requests/:id/reject', async (request) => {
  const user = actor(request)
  if (user.role !== 'admin') {
    const error = new Error('Only an admin can reject credit.') as Error & { statusCode?: number }
    error.statusCode = 403
    throw error
  }
  return decideCredit(user.id, Number(request.params.id), false)
})

app.post('/api/telephony/token', async (request) => {
  const user = actor(request)
  if (balanceOf(user.id) <= 0) {
    const error = new Error('Request credit and wait for approval before placing a call.') as Error & { statusCode?: number }
    error.statusCode = 402
    throw error
  }
  return loginToken()
})
app.get('/api/telephony/token', async (request) => {
  const user = actor(request)
  if (balanceOf(user.id) <= 0) {
    const error = new Error('Request credit and wait for approval before placing a call.') as Error & { statusCode?: number }
    error.statusCode = 402
    throw error
  }
  return loginToken()
})

app.get('/api/calls', async (request) => listCalls(actor(request).id))

app.get<{ Params: { id: string } }>('/api/calls/:id', async (request, reply) => {
  const found = getCall(Number(request.params.id))
  const user = actor(request)
  if (!found || found.row.user_id !== user.id) return reply.code(404).send({ error: 'No call with that id.' })
  return found.json
})

app.post<{ Params: { id: string } }>('/api/calls/:id/refresh-cost', async (request, reply) => {
  const found = getCall(Number(request.params.id))
  const user = actor(request)
  if (!found || found.row.user_id !== user.id) return reply.code(404).send({ error: 'No call with that id.' })
  return refreshCallCost(Number(request.params.id))
})

app.post('/api/calls/sync', async (request) => {
  const body = (request.body as { json?: Record<string, unknown> }).json ?? {}
  const status = text(body.status)
  if (!status) {
    const error = new Error('Call status is required.') as Error & { statusCode?: number }
    error.statusCode = 400
    throw error
  }
  return upsertCall({
    clientCallId: text(body.clientCallId),
    callSessionId: text(body.callSessionId),
    callLegId: text(body.callLegId),
    callControlId: text(body.callControlId),
    direction: text(body.direction) || 'outbound',
    from: text(body.from),
    to: text(body.to),
    status,
    startedAt: text(body.startedAt),
    answeredAt: text(body.answeredAt),
    endedAt: text(body.endedAt),
    hangupCause: text(body.hangupCause),
  }, actor(request).id).json
})

app.get('/api/admin/calls', async (request) => {
  requireAdmin(request)
  return listAdminCalls()
})

app.get<{ Params: { id: string } }>('/api/admin/calls/:id/recording', async (request, reply) => {
  requireAdmin(request)
  const found = getCall(Number(request.params.id))
  const url = found?.row.recording_url
  if (!url) return reply.code(404).send({ error: 'No recording is available for this call.' })
  const recording = await fetch(url)
  if (!recording.ok) return reply.code(502).send({ error: 'The recording could not be fetched from Telnyx.' })
  reply.type(recording.headers.get('content-type') || 'audio/mpeg')
  return reply.send(Buffer.from(await recording.arrayBuffer()))
})

app.post<{ Params: { id: string } }>('/api/admin/calls/:id/summary', async (request, reply) => {
  requireAdmin(request)
  const found = getCall(Number(request.params.id))
  const url = found?.row.recording_url
  if (!found || !url) return reply.code(404).send({ error: 'No recording is available for this call.' })
  const recording = await fetch(url)
  if (!recording.ok) return reply.code(502).send({ error: 'The recording could not be fetched from Telnyx.' })
  const contentType = recording.headers.get('content-type') || (found.row.recording_format === 'wav' ? 'audio/wav' : 'audio/mpeg')
  const audio = Buffer.from(await recording.arrayBuffer())
  if (audio.length > 25 * 1024 * 1024) return reply.code(413).send({ error: 'The recording is too large to summarize.' })
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
  const text = await geminiAudio(
    'Summarize this phone call in one short paragraph. Use only what is audible. Do not invent names, dates, amounts, or promises.',
    'Write a concise, factual summary of this call.',
    contentType,
    audio,
  )
  return saveCallSummary(found.row.id, text, model)
})

app.post('/api/telnyx/webhook', async (request, reply) => {
  const body = request.body as { raw: string, json: { data?: { event_type?: string, payload?: Record<string, unknown> }, event_type?: string, payload?: Record<string, unknown> } }
  const ok = checkWebhook(
    body.raw,
    request.headers['telnyx-timestamp'] as string | undefined,
    request.headers['telnyx-signature-ed25519'] as string | undefined,
  )
  if (!ok) return reply.code(401).send({ error: 'Telnyx signature was rejected.' })
  const eventType = body.json.data?.event_type || body.json.event_type
  const payload = body.json.data?.payload || body.json.payload
  if (eventType && payload) applyWebhook(eventType, payload)
  return { ok: true }
})

app.get('/api/whatsapp/status', async () => whatsAppStatus())

app.get('/api/whatsapp/events', async (request, reply) => {
  reply.hijack()
  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  })
  const send = (event: unknown) => {
    reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  }
  const unsubscribe = subscribeWhatsApp(send)
  const timer = setInterval(() => reply.raw.write(': ping\n\n'), 15000)
  request.raw.on('close', () => {
    clearInterval(timer)
    unsubscribe()
  })
})

app.get('/api/whatsapp/chats', async () => listChats())

app.get('/api/whatsapp/reply', async () => replyState())

app.post('/api/whatsapp/reply', async (request) => {
  const enabled = (request.body as { json?: { enabled?: unknown } }).json?.enabled
  if (typeof enabled !== 'boolean') {
    const error = new Error('enabled must be true or false.') as Error & { statusCode?: number }
    error.statusCode = 400
    throw error
  }
  return setAutoReply(enabled)
})

app.get<{ Params: { jid: string } }>('/api/whatsapp/chats/:jid/messages', async (request) => {
  return listMessages(decodeURIComponent(request.params.jid))
})

app.post<{ Params: { jid: string } }>('/api/whatsapp/chats/:jid/summary', async (request) => {
  const jid = decodeURIComponent(request.params.jid)
  const messages = listMessages(jid)
  if (!messages.length) {
    const error = new Error('This chat has no texts to summarize.') as Error & { statusCode?: number }
    error.statusCode = 400
    throw error
  }
  const transcript = transcriptLines(messages.map((message) => ({
    timestamp: message.timestamp,
    pushName: message.fromMe ? 'You' : message.pushName,
    body: message.body,
  })))
  const model = process.env.GEMINI_MODEL?.trim() || 'gemini-3.6-flash'
  const text = await geminiText(
    'Summarize this WhatsApp chat in one short paragraph. Use only the transcript. Do not invent names, dates, amounts, or promises.',
    transcript.omitted ? `The oldest ${transcript.omitted} texts were omitted.\n${transcript.text}` : transcript.text,
  )
  saveSummary(jid, text, model, messages.length)
  return {
    summaryText: text,
    summaryModel: model,
    summaryAt: new Date().toISOString(),
    summaryMessageCount: messages.length,
    summaryStale: false,
  }
})

const webRoot = resolve('web/dist')
if (existsSync(webRoot)) {
  app.get('/*', async (request, reply) => {
    const url = request.url.split('?')[0] || '/'
    if (url.startsWith('/api')) return reply.callNotFound()
    const requested = url === '/' ? 'index.html' : url.slice(1)
    const candidate = normalize(join(webRoot, requested))
    const file = candidate.startsWith(webRoot) && existsSync(candidate) && statSync(candidate).isFile()
      ? candidate
      : join(webRoot, 'index.html')
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.svg': 'image/svg+xml',
    }
    return reply.type(types[extname(file)] || 'application/octet-stream').send(createReadStream(file))
  })
}

const port = Number(process.env.PORT || 8787)
await app.listen({ port, host: '127.0.0.1' })
startWhatsApp()

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed ? trimmed.slice(0, 200) : null
}

function jsonBody(request: { body: unknown }) {
  return ((request.body as { json?: Record<string, unknown> } | undefined)?.json) ?? {}
}

function requireAdmin(request: object) {
  const user = actor(request)
  if (user.role === 'admin') return user
  const error = new Error('Only an admin can access call recordings and summaries.') as Error & { statusCode?: number }
  error.statusCode = 403
  throw error
}
