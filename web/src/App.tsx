import { useEffect, useRef, useState, type FormEvent } from 'react'
import { hangUp, onCallUpdate, placeCall, stateLabel } from './phone'
import { AdminPage, AuthScreen, BillingPage, Dashboard, NumbersPage, type SessionUser } from './desk'

type CallRecord = {
  id: number
  direction: string | null
  from: string | null
  to: string | null
  status: string
  startedAt: string | null
  durationSeconds: number | null
  costAmount: string | null
  currency: string | null
}

type Chat = {
  jid: string
  displayName: string | null
  messageCount: number
  transcriptCount: number
  firstMessageAt: string
  lastMessageAt: string
  lastText: string
  summaryText: string | null
  summaryAt: string | null
  summaryMessageCount: number | null
  summaryStale: boolean
}

type Message = {
  id: number
  pushName: string | null
  body: string
  timestamp: string
  fromMe: boolean
}

type ReplyState = {
  enabled: boolean
  pattern: string
  exampleCount: number
  ready: boolean
  updatedAt: string | null
}

type WaLink = {
  connection: string
  qrDataUrl: string | null
  error: string | null
  type?: string
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed.')
  return body
}

function minutes(seconds: number | null) {
  if (seconds == null) return '—'
  return `${(seconds / 60).toFixed(1)} min`
}

function money(amount: string | null, currency: string | null) {
  if (!amount) return 'Pending'
  return currency ? `${currency} ${Number(amount).toFixed(4)}` : Number(amount).toFixed(4)
}

function when(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString()
}

function normalizeNumber(input: string) {
  const digits = input.trim().replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

function chatLabel(chat: Chat) {
  return chat.displayName || chat.jid.replace(/@.*/, '')
}

export function App() {
  const route = useHash()
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined)

  useEffect(() => {
    fetch('/api/auth/me').then(async (response) => {
      if (response.status === 401) {
        setMe(null)
        return
      }
      setMe(await readJson<SessionUser>(response))
    }).catch(() => setMe(null))
  }, [])

  useEffect(() => {
    if (me && me.role !== 'admin' && (route === '#/admin' || route === '#/whatsapp')) {
      window.location.hash = '#/'
    }
  }, [me, route])

  if (me === undefined) return <p className="waiting page-wait">Loading.</p>
  if (!me) return <AuthScreen onSuccess={setMe} />

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setMe(null)
    window.location.hash = '#/'
  }

  const adminRoute = route === '#/admin' || route === '#/whatsapp'
  if (me.role === 'admin' && adminRoute) {
    return (
      <div className="shell shell-admin">
        <aside className="side">
          <a className="mark" href="#/admin">Admin</a>
          <p className="who"><strong>{me.name}</strong><br />{me.email}</p>
          <nav>
            <a href="#/admin" aria-current={route === '#/admin' ? 'page' : undefined}>Approvals</a>
            <a href="#/whatsapp" aria-current={route === '#/whatsapp' ? 'page' : undefined}>WhatsApp</a>
          </nav>
          <div className="side-foot">
            <a className="ghost" href="#/">Back to desk</a>
            <button type="button" className="ghost" onClick={signOut}>Sign out</button>
          </div>
        </aside>
        <div className="wrap">{route === '#/whatsapp' ? <WhatsApp /> : <AdminPage />}</div>
      </div>
    )
  }

  const page = route === '#/calls'
    ? <Calls />
    : route === '#/numbers'
      ? <NumbersPage />
      : route === '#/billing'
        ? <BillingPage />
        : <Dashboard />

  return (
    <div className="shell">
      <aside className="side">
        <a className="mark" href="#/">Desk</a>
        <p className="who"><strong>{me.name}</strong><br />{me.email}</p>
        <nav>
          <a href="#/" aria-current={route === '#/' || route === '' ? 'page' : undefined}>Dashboard</a>
          <a href="#/numbers" aria-current={route === '#/numbers' ? 'page' : undefined}>Numbers</a>
          <a href="#/billing" aria-current={route === '#/billing' ? 'page' : undefined}>Billing</a>
          <a href="#/calls" aria-current={route === '#/calls' ? 'page' : undefined}>Calls</a>
        </nav>
        <div className="side-foot">
          {me.role === 'admin' ? <a className="ghost" href="#/admin">Admin</a> : null}
          <button type="button" className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </aside>
      <div className="wrap">{page}</div>
    </div>
  )
}

function useHash() {
  const [hash, setHash] = useState(window.location.hash || '#/')
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/')
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return hash
}

function Calls() {
  const [number, setNumber] = useState('')
  const [live, setLive] = useState<string | undefined>()
  const [cause, setCause] = useState('')
  const [active, setActive] = useState<{ hangup?: () => void, state?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [calls, setCalls] = useState<CallRecord[] | null>(null)
  const [refreshing, setRefreshing] = useState<number | null>(null)

  async function load() {
    const rows = await readJson<CallRecord[]>(await fetch('/api/calls'))
    setCalls(rows)
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message))
    const stop = onCallUpdate((call) => {
      setLive(call.state)
      setCause(call.cause || call.hangupCause || '')
      setActive(call.state === 'destroy' || call.state === 'purge' ? null : call)
      load().catch(() => undefined)
    })
    return () => {
      stop()
    }
  }, [])

  async function dial(event: FormEvent) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const destination = normalizeNumber(number)
      if (!destination) throw new Error('Enter a phone number with at least 8 digits.')
      setLive('requesting')
      const call = await placeCall(destination)
      setActive(call)
    } catch (reason) {
      setLive(undefined)
      setError(reason instanceof Error ? reason.message : 'The call did not start.')
    } finally {
      setBusy(false)
    }
  }

  async function refresh(id: number) {
    setRefreshing(id)
    setError('')
    try {
      await readJson(await fetch(`/api/calls/${id}/refresh-cost`, { method: 'POST' }))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Cost refresh failed.')
    } finally {
      setRefreshing(null)
    }
  }

  const onCall = live === 'active' || live === 'ringing' || live === 'early' || live === 'trying' || live === 'requesting' || live === 'answering' || live === 'held'

  return (
    <main>
      <h1>Calls</h1>
      <form className="dial" onSubmit={dial}>
        <label htmlFor="number">Number</label>
        <input id="number" type="tel" inputMode="tel" autoComplete="tel" value={number} onChange={(event) => setNumber(event.target.value)} placeholder="+14155551212" />
        <button type="submit" className="primary" disabled={busy || onCall}>Call</button>
        <button type="button" className="stop" disabled={!active} onClick={() => hangUp(active)}>Hang up</button>
      </form>
      <p role="status">Status: {busy && !live ? 'Connecting to Telnyx' : stateLabel(live)}{cause && (live === 'hangup' || live === 'destroy' || live === 'purge' || live === 'failed') ? `. Telnyx said ${cause}.` : ''}. The browser will ask for the microphone.</p>
      {error ? <p role="alert">{error}</p> : null}
      <p className="note">Minutes are saved from this browser. Cost stays pending until Telnyx prices the call. Refresh pulls the detail record. A public URL to <span className="path">/api/telnyx/webhook</span> is only needed if you want Telnyx to push the price itself.</p>
      {calls == null ? <p className="waiting">Loading calls.</p> : calls.length === 0 ? (
        <p>No calls yet. Enter a number and press Call. The record keeps the minutes and the Telnyx cost.</p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Direction</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Minutes</th>
                <th scope="col">Cost</th>
                <th scope="col">Status</th>
                <th scope="col">Price</th>
              </tr>
            </thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td>{when(call.startedAt)}</td>
                  <td>{call.direction || '—'}</td>
                  <td>{call.from || '—'}</td>
                  <td>{call.to || '—'}</td>
                  <td>{minutes(call.durationSeconds)}</td>
                  <td>{money(call.costAmount, call.currency)}</td>
                  <td>{call.status}</td>
                  <td>
                    <button type="button" disabled={refreshing === call.id} onClick={() => refresh(call.id)}>
                      {refreshing === call.id ? 'Refreshing' : 'Refresh cost'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

function WhatsApp() {
  const [link, setLink] = useState<WaLink | null>(null)
  const [chats, setChats] = useState<Chat[] | null>(null)
  const [selected, setSelected] = useState('')
  const [messages, setMessages] = useState<Message[] | null>(null)
  const [summary, setSummary] = useState<Pick<Chat, 'summaryText' | 'summaryAt' | 'summaryMessageCount' | 'summaryStale'> | null>(null)
  const [error, setError] = useState('')
  const [summarizing, setSummarizing] = useState(false)
  const [reply, setReply] = useState<ReplyState | null>(null)
  const selectedRef = useRef('')

  async function loadChats() {
    const rows = await readJson<Chat[]>(await fetch('/api/whatsapp/chats'))
    setChats(rows)
    return rows
  }

  async function openChat(jid: string, known?: Chat) {
    setSelected(jid)
    setError('')
    const chat = known ?? chats?.find((item) => item.jid === jid)
    setSummary(chat ? {
      summaryText: chat.summaryText,
      summaryAt: chat.summaryAt,
      summaryMessageCount: chat.summaryMessageCount,
      summaryStale: chat.summaryStale,
    } : null)
    try {
      setMessages(await readJson<Message[]>(await fetch(`/api/whatsapp/chats/${encodeURIComponent(jid)}/messages`)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load texts.')
    }
  }

  useEffect(() => {
    selectedRef.current = selected
  }, [selected])

  useEffect(() => {
    loadChats().catch((reason: Error) => setError(reason.message))
    fetch('/api/whatsapp/status').then((response) => readJson<WaLink>(response)).then(setLink).catch(() => undefined)
    fetch('/api/whatsapp/reply').then((response) => readJson<ReplyState>(response)).then(setReply).catch(() => undefined)
    const source = new EventSource('/api/whatsapp/events')
    source.onmessage = (event) => {
      const next = JSON.parse(event.data) as WaLink
      if (!next.type) setLink(next)
      if (next.type !== 'message') return
      const jid = selectedRef.current
      loadChats().then(async (rows) => {
        if (!jid) return
        const chat = rows.find((item) => item.jid === jid)
        if (chat) {
          setSummary({
            summaryText: chat.summaryText,
            summaryAt: chat.summaryAt,
            summaryMessageCount: chat.summaryMessageCount,
            summaryStale: chat.summaryStale,
          })
        }
        setMessages(await readJson<Message[]>(await fetch(`/api/whatsapp/chats/${encodeURIComponent(jid)}/messages`)))
        setReply(await readJson<ReplyState>(await fetch('/api/whatsapp/reply')))
      }).catch(() => undefined)
    }
    source.onerror = () => setLink((current) => current ?? { connection: 'error', qrDataUrl: null, error: 'Live updates paused. Refresh the page.' })
    return () => source.close()
  }, [])

  const current = chats?.find((chat) => chat.jid === selected) ?? null

  async function summarize() {
    if (!selected) return
    setSummarizing(true)
    setError('')
    try {
      const result = await readJson<Chat>(await fetch(`/api/whatsapp/chats/${encodeURIComponent(selected)}/summary`, { method: 'POST' }))
      setSummary(result)
      await loadChats()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Summary failed.')
    } finally {
      setSummarizing(false)
    }
  }

  return (
    <main>
      <h1>WhatsApp</h1>
      <section className="link" aria-label="WhatsApp link">
        <p>Status: {link ? linkLabel(link.connection) : 'Checking'}.</p>
        {link?.error ? <p role="alert">{link.error}</p> : null}
        {link?.qrDataUrl ? (
          <>
            <p>Open WhatsApp on your phone, then Linked devices, then scan this code.</p>
            <img src={link.qrDataUrl} alt="WhatsApp link code" width="280" height="280" />
          </>
        ) : null}
      </section>
      <section className="reply" aria-label="Auto-reply">
        <h2>Auto-reply</h2>
        <label className="check">
          <input
            type="checkbox"
            checked={reply?.enabled ?? true}
            onChange={(event) => {
              const enabled = event.target.checked
              setReply((current) => current ? { ...current, enabled } : current)
              fetch('/api/whatsapp/reply', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled }),
              }).then((response) => readJson<ReplyState>(response)).then(setReply).catch((reason: Error) => setError(reason.message))
            }}
          />
          Reply in the pattern learned from your own texts
        </label>
        {reply == null ? <p className="waiting">Loading the reply pattern.</p> : reply.exampleCount < 3 ? (
          <p>Replying in short lines until your own texts teach the pattern. {reply.exampleCount} of 3 replies seen. Answer from your phone and the next replies follow you.</p>
        ) : (
          <p>{reply.pattern || 'Reading your replies.'}</p>
        )}
      </section>
      {error ? <p role="alert">{error}</p> : null}
      <div className="split">
        <section>
          <h2>Chats</h2>
          {chats == null ? <p className="waiting">Loading chats.</p> : chats.length === 0 ? (
            <p>No texts yet. Messages that arrive after you link show up here.</p>
          ) : (
            <ul className="chats">
              {chats.map((chat) => (
                <li key={chat.jid}>
                  <button type="button" aria-current={chat.jid === selected ? 'true' : undefined} onClick={() => openChat(chat.jid, chat)}>
                    <span>{chatLabel(chat)}</span>
                    <span>{chat.messageCount} {chat.messageCount === 1 ? 'text' : 'texts'}</span>
                    <small>{chat.lastText}</small>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section>
          <h2>{current ? chatLabel(current) : 'Transcript'}</h2>
          {!current ? <p>Select a chat to read the texts, the count, and a summary.</p> : (
            <>
              <dl className="stats">
                <div><dt>Texts</dt><dd>{current.messageCount}</dd></div>
                <div><dt>First</dt><dd>{when(current.firstMessageAt)}</dd></div>
                <div><dt>Last</dt><dd>{when(current.lastMessageAt)}</dd></div>
              </dl>
              <div className="summary">
                <h3>Summary</h3>
                {summary?.summaryText ? <p>{summary.summaryText}</p> : <p>No summary yet. Stats above stay either way.</p>}
                {summary?.summaryStale ? <p>This summary covers {summary.summaryMessageCount} of {current.transcriptCount} messages.</p> : null}
                <button type="button" className="primary" disabled={summarizing} onClick={summarize}>
                  {summarizing ? 'Writing summary' : 'Generate summary'}
                </button>
              </div>
              {messages == null ? <p className="waiting">Loading texts.</p> : (
                <ol className="log">
                  {messages.map((message) => (
                    <li key={message.id} className={message.fromMe ? 'mine' : undefined}>
                      <time dateTime={message.timestamp}>{when(message.timestamp)}</time>
                      <strong>{message.fromMe ? 'You' : message.pushName || 'Unknown'}</strong>
                      <p>{message.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function linkLabel(connection: string) {
  if (connection === 'open') return 'Linked'
  if (connection === 'qr') return 'Waiting for the scan'
  if (connection === 'starting') return 'Starting'
  if (connection === 'close') return 'Disconnected'
  if (connection === 'error') return 'Not running'
  return connection
}
