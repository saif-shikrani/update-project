import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { getCall, setCallCost, upsertCall, type CallPatch } from './db.ts'
import { required } from './env.ts'
import { combineCosts, costFromPayload, recordMatches, verifyTelnyx } from './logic.ts'

const credentialFile = 'data/telnyx-credential-id'

export function checkWebhook(rawBody: string, timestamp: string | undefined, signature: string | undefined): boolean {
  const publicKey = process.env.TELNYX_PUBLIC_KEY?.trim()
  if (!publicKey) {
    const error = new Error('Add TELNYX_PUBLIC_KEY to .env and restart.') as Error & { statusCode?: number }
    error.statusCode = 400
    throw error
  }
  if (!timestamp || !signature) return false
  return verifyTelnyx(rawBody, timestamp, signature, publicKey)
}

export function applyWebhook(eventType: string, payload: Record<string, unknown>) {
  const patch: CallPatch = {
    callSessionId: text(payload.call_session_id),
    callLegId: text(payload.call_leg_id),
    callControlId: text(payload.call_control_id),
    direction: payload.direction === 'incoming' ? 'inbound' : payload.direction === 'outgoing' ? 'outbound' : text(payload.direction),
    from: text(payload.from),
    to: text(payload.to),
  }
  if (!patch.callSessionId && !patch.callLegId && !patch.callControlId) return null
  if (eventType === 'call.initiated') {
    return upsertCall({ ...patch, status: 'initiated', startedAt: text(payload.start_time) })
  }
  if (eventType === 'call.ringing') {
    return upsertCall({ ...patch, status: 'ringing' })
  }
  if (eventType === 'call.answered') {
    return upsertCall({ ...patch, status: 'answered', answeredAt: text(payload.start_time) || new Date().toISOString() })
  }
  if (eventType === 'call.hangup') {
    return upsertCall({
      ...patch,
      status: 'hangup',
      startedAt: text(payload.start_time),
      endedAt: text(payload.end_time) || new Date().toISOString(),
      hangupCause: text(payload.hangup_cause) || text(payload.hangup_cause_code),
    })
  }
  if (eventType === 'call.cost') {
    const cost = costFromPayload(payload)
    if (!cost) return null
    return upsertCall({
      ...patch,
      costAmount: cost.amount,
      currency: cost.currency,
      billableSeconds: cost.billableSeconds,
    })
  }
  if (eventType === 'call.recording.saved') {
    const urls = payload.recording_urls
    const publicUrls = payload.public_recording_urls
    const url = recordingUrl(urls) || recordingUrl(publicUrls)
    if (!url) return null
    return upsertCall({
      ...patch,
      recordingUrl: url,
      recordingFormat: recordingFormat(urls, publicUrls),
      recordingStartedAt: text(payload.recording_started_at),
      recordingEndedAt: text(payload.recording_ended_at),
    })
  }
  return null
}

export async function loginToken() {
  const callerNumber = required('TELNYX_PHONE_NUMBER')
  required('TELNYX_API_KEY')
  required('TELNYX_CONNECTION_ID')
  const fromFile = readCredentialId()
  const fromEnv = process.env.TELNYX_TELEPHONY_CREDENTIAL_ID?.trim() || ''
  const candidates = [fromFile, fromEnv].filter((id, index, all) => id && all.indexOf(id) === index)
  for (const credentialId of candidates) {
    try {
      return { token: await requestToken(credentialId), callerNumber }
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status !== 400 && status !== 404) throw error
    }
  }
  const credentialId = await createCredential()
  await delay(5000)
  return { token: await requestToken(credentialId), callerNumber }
}

export async function refreshCallCost(id: number) {
  const found = getCall(id)
  if (!found) {
    const error = new Error('No call with that id.') as Error & { statusCode?: number }
    error.statusCode = 404
    throw error
  }
  const ids = [found.row.call_session_id, found.row.call_leg_id, found.row.call_control_id, found.row.client_call_id]
    .filter((value): value is string => Boolean(value))
  if (!ids.length) {
    const error = new Error('This call has no Telnyx id yet.') as Error & { statusCode?: number }
    error.statusCode = 409
    throw error
  }
  required('TELNYX_API_KEY')
  const started = Date.parse(found.row.started_at ?? found.row.created_at)
  const range = Number.isFinite(started) && Date.now() - started > 7 * 24 * 60 * 60 * 1000 ? 'last_30_days' : 'last_7_days'
  const records = [
    ...await searchRecords('webrtc', range),
    ...await searchRecords('sip-trunking', range),
  ].filter((record) => recordMatches(record, ids))
  const cost = combineCosts(records)
  if (!cost) {
    const error = new Error('Telnyx has no priced detail record for this call yet.') as Error & { statusCode?: number }
    error.statusCode = 404
    throw error
  }
  return setCallCost(found.row.id, cost.amount, cost.currency, cost.billableSeconds).json
}

async function createCredential() {
  const body = await telnyx('/telephony_credentials', {
    method: 'POST',
    body: { connection_id: required('TELNYX_CONNECTION_ID'), name: 'desk' },
  })
  const id = body.data?.id
  if (typeof id !== 'string' || !id) throw httpError('Telnyx did not return a telephony credential id.', 502)
  writeFileSync(credentialFile, id)
  return id
}

function readCredentialId() {
  if (!existsSync(credentialFile)) return ''
  return readFileSync(credentialFile, 'utf8').trim()
}

async function requestToken(id: string) {
  const response = await fetch(`https://api.telnyx.com/v2/telephony_credentials/${id}/token`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${required('TELNYX_API_KEY')}` },
  })
  const text = await response.text()
  if (!response.ok) {
    const error = httpError(telnyxMessage(text, response.status), response.status)
    ;(error as { status?: number }).status = response.status
    throw error
  }
  const trimmed = text.trim()
  if (trimmed.startsWith('{')) {
    const json = JSON.parse(trimmed) as { data?: { token?: string }, token?: string }
    const token = json.data?.token || json.token
    if (token) return token
  }
  return trimmed.replace(/^"|"$/g, '')
}

async function searchRecords(recordType: string, dateRange: string) {
  const records: Record<string, unknown>[] = []
  for (let page = 1; page <= 5; page += 1) {
    const params = new URLSearchParams({
      'filter[record_type]': recordType,
      'filter[date_range]': dateRange,
      'page[size]': '50',
      'page[number]': String(page),
    })
    let body: { data?: Record<string, unknown>[], meta?: { total_pages?: number } }
    try {
      body = await telnyx(`/detail_records?${params.toString()}`)
    } catch (error) {
      const status = (error as { statusCode?: number }).statusCode
      if (status === 400) return records
      throw error
    }
    records.push(...(body.data ?? []))
    if (page >= (body.meta?.total_pages ?? 1)) break
  }
  return records
}

export async function searchAvailableNumbers(query: { country: string, area?: string, contains?: string, limit?: number }) {
  const params = new URLSearchParams({
    'filter[country_code]': query.country,
    'filter[limit]': String(query.limit ?? 24),
    'filter[best_effort]': 'true',
  })
  if (query.area) params.set('filter[national_destination_code]', query.area)
  if (query.contains) params.set('filter[phone_number][contains]', query.contains.replace(/\D/g, ''))
  try {
    const body = await telnyx(`/available_phone_numbers?${params}`) as {
    data?: {
      phone_number?: string
      phone_number_type?: string
      cost_information?: { upfront_cost?: string, monthly_cost?: string, currency?: string }
      region_information?: { region_name?: string }[]
      features?: { name?: string }[]
    }[]
  }
  return (body.data ?? []).map((item) => ({
    phoneNumber: item.phone_number ?? '',
    type: item.phone_number_type ?? '',
    region: [...new Set((item.region_information ?? []).map((region) => region.region_name).filter((name): name is string => Boolean(name)))].join(', '),
    upfrontCost: item.cost_information?.upfront_cost ?? '0.0000',
    monthlyCost: item.cost_information?.monthly_cost ?? '0.0000',
    currency: item.cost_information?.currency ?? 'USD',
    features: (item.features ?? []).map((feature) => feature.name).filter(Boolean),
  })).filter((item) => item.phoneNumber)
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.toLowerCase().includes('no numbers found')) return []
    throw error
  }
}

export async function orderPhoneNumber(phoneNumber: string) {
  await telnyx('/number_orders', {
    method: 'POST',
    body: {
      phone_numbers: [{ phone_number: phoneNumber }],
      connection_id: required('TELNYX_CONNECTION_ID'),
    },
  })
}

async function telnyx(path: string, options: { method?: string, body?: unknown } = {}): Promise<any> {
  const response = await fetch(`https://api.telnyx.com/v2${path}`, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${required('TELNYX_API_KEY')}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  })
  const text = await response.text()
  if (!response.ok) throw httpError(telnyxMessage(text, response.status), response.status)
  return text ? JSON.parse(text) as { data?: { id?: string }, meta?: { total_pages?: number } } : {}
}

function telnyxMessage(text: string, status: number) {
  try {
    const json = JSON.parse(text) as { errors?: { detail?: string }[] }
    const detail = json.errors?.map((error) => error.detail).filter(Boolean).join(' ')
    if (detail) return detail
  } catch {
    // Telnyx sometimes returns plain text.
  }
  return text.trim() || `Telnyx returned ${status}.`
}

function httpError(message: string, statusCode: number) {
  const error = new Error(message) as Error & { statusCode?: number }
  error.statusCode = statusCode
  return error
}

function text(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function recordingUrl(value: unknown): string | null {
  if (!value || typeof value !== 'object') return null
  for (const format of ['mp3', 'wav']) {
    const url = (value as Record<string, unknown>)[format]
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) return url
  }
  return null
}

function recordingFormat(...values: unknown[]): string | null {
  for (const value of values) {
    if (!value || typeof value !== 'object') continue
    for (const format of ['mp3', 'wav']) {
      const url = (value as Record<string, unknown>)[format]
      if (typeof url === 'string' && /^https?:\/\//i.test(url)) return format
    }
  }
  return null
}
