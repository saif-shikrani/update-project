type TelnyxCall = {
  id?: string
  state?: string
  cause?: string
  hangupCause?: string
  hangup?: () => void
  options?: { destinationNumber?: string, callerNumber?: string }
  telnyxIDs?: { telnyxSessionId?: string, telnyxLegId?: string, telnyxCallControlId?: string }
}

type RtcClient = {
  remoteElement: string
  connect: () => void
  newCall: (options: { destinationNumber: string, callerNumber: string }) => TelnyxCall
  on: (event: string, handler: (value: unknown) => void) => void
}

const listeners = new Set<(call: TelnyxCall) => void>()
const times = new Map<string, { startedAt: string, answeredAt?: string, endedAt?: string }>()

let client: RtcClient | null = null
let callerNumber = ''
let connecting: Promise<void> | null = null

export function onCallUpdate(listener: (call: TelnyxCall) => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export async function placeCall(destination: string) {
  await ensureClient()
  return client!.newCall({ destinationNumber: destination, callerNumber })
}

export function hangUp(call: TelnyxCall | null) {
  call?.hangup?.()
}

async function ensureClient() {
  if (client && connecting) {
    await connecting
    return
  }
  const response = await fetch('/api/telephony/token', { method: 'POST' })
  const body = await response.json() as { token?: string, callerNumber?: string, error?: string }
  if (!response.ok || !body.token || !body.callerNumber) {
    throw new Error(body.error || 'Telnyx login failed.')
  }
  callerNumber = body.callerNumber
  const sdk = await import('@telnyx/webrtc')
  const TelnyxRTC = sdk.TelnyxRTC as new (options: { login_token: string }) => RtcClient
  client = new TelnyxRTC({ login_token: body.token })
  client.remoteElement = 'remote-audio'
  connecting = new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error('Telnyx did not register. Check the connection id and caller number.')), 20000)
    client!.on('telnyx.ready', () => {
      window.clearTimeout(timeout)
      resolve()
    })
    client!.on('telnyx.error', (error: unknown) => {
      window.clearTimeout(timeout)
      reject(error instanceof Error ? error : new Error('Telnyx rejected the login.'))
    })
    client!.on('telnyx.notification', (notification: unknown) => {
      const update = notification as { type?: string, call?: TelnyxCall }
      if (update.type === 'callUpdate' && update.call) track(update.call)
    })
  })
  try {
    client.connect()
    await connecting
  } catch (error) {
    client = null
    connecting = null
    throw error
  }
}

function track(call: TelnyxCall) {
  const id = call.id || 'current'
  const now = new Date().toISOString()
  const row = times.get(id) ?? { startedAt: now }
  const status = mapState(call.state)
  if (status === 'answered' && !row.answeredAt) row.answeredAt = now
  if ((status === 'hangup' || status === 'failed') && !row.endedAt) row.endedAt = now
  times.set(id, row)
  for (const listener of listeners) listener(call)
  const ids = call.telnyxIDs ?? {}
  void fetch('/api/calls/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientCallId: call.id ?? null,
      callSessionId: ids.telnyxSessionId ?? null,
      callLegId: ids.telnyxLegId ?? null,
      callControlId: ids.telnyxCallControlId ?? null,
      direction: 'outbound',
      from: call.options?.callerNumber ?? callerNumber,
      to: call.options?.destinationNumber ?? null,
      status,
      startedAt: row.startedAt,
      answeredAt: row.answeredAt ?? null,
      endedAt: row.endedAt ?? null,
      hangupCause: call.cause || call.hangupCause || null,
    }),
  })
}

export function mapState(state: string | undefined) {
  if (state === 'active' || state === 'answered' || state === 'held') return 'answered'
  if (state === 'hangup' || state === 'destroy' || state === 'purge') return 'hangup'
  if (state === 'ringing' || state === 'early' || state === 'answering') return 'ringing'
  if (state === 'failed' || state === 'busy' || state === 'rejected') return 'failed'
  return 'initiated'
}

export function stateLabel(state: string | undefined) {
  const status = mapState(state)
  if (!state) return 'Idle'
  if (status === 'answered') return 'On the call'
  if (status === 'ringing') return 'Ringing'
  if (status === 'hangup') return 'Call ended'
  if (status === 'failed') return 'Call failed'
  return 'Placing the call'
}
