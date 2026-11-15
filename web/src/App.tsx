import { useEffect, useRef, useState, type FormEvent } from 'react'
import { hangUp, onCallUpdate, placeCall, stateLabel } from './phone'
import { AdminPage, AuthScreen, BillingPage, Dashboard, NumbersPage, type SessionUser } from './desk'
import { Brand, BrandMark, Chip, EmptyState, Icon, PageHead, SkeletonLines, initials, type IconName, type Tone } from './ui'

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

type NavItem = { href: string, label: string, icon: IconName }

const deskNav: NavItem[] = [
  { href: '#/', label: 'Dashboard', icon: 'grid' },
  { href: '#/calls', label: 'Calls', icon: 'phone' },
  { href: '#/numbers', label: 'Numbers', icon: 'hash' },
  { href: '#/billing', label: 'Billing', icon: 'card' },
]

const adminNav: NavItem[] = [
  { href: '#/admin', label: 'Approvals', icon: 'shield' },
  { href: '#/whatsapp', label: 'WhatsApp', icon: 'whatsapp' },
]

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
  return date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function shortDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function normalizeNumber(input: string) {
  const digits = input.trim().replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `+${digits}`
}

function chatLabel(chat: Chat) {
  return chat.displayName || chat.jid.replace(/@.*/, '')
}

function callTone(status: string): Tone {
  if (status === 'answered') return 'ok'
  if (status === 'failed') return 'bad'
  if (status === 'initiated' || status === 'ringing') return 'warn'
  return 'neutral'
}

function statusLabel(status: string) {
  if (status === 'hangup') return 'Ended'
  if (status === 'answered') return 'Answered'
  if (status === 'failed') return 'Failed'
  if (status === 'ringing') return 'Ringing'
  if (status === 'initiated') return 'Started'
  return status
}

export function App() {
  const route = useHash()
  const [me, setMe] = useState<SessionUser | null | undefined>(undefined)
  const [menuOpen, setMenuOpen] = useState(false)

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

  useEffect(() => {
    setMenuOpen(false)
  }, [route])

  useEffect(() => {
    if (!menuOpen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [menuOpen])

  if (me === undefined) return <Boot />
  if (!me) return <AuthScreen onSuccess={setMe} />

  async function signOut() {
    await fetch('/api/auth/logout', { method: 'POST' })
    setMe(null)
    setMenuOpen(false)
    window.location.hash = '#/'
  }

  const adminRoute = route === '#/admin' || route === '#/whatsapp'

  if (me.role === 'admin' && adminRoute) {
    return (
      <div className="shell shell--admin">
        <a className="skip-link" href="#main">Skip to content</a>
        <Sidebar me={me} route={route} admin onSignOut={signOut} />
        <div className="workspace">
          <MobileBar admin menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} onCloseMenu={() => setMenuOpen(false)} me={me} route={route} onSignOut={signOut} />
          <main className="page" id="main" key={route}>
            {route === '#/whatsapp' ? <WhatsApp /> : <AdminPage />}
          </main>
        </div>
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
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar me={me} route={route} onSignOut={signOut} />
      <div className="workspace">
        <MobileBar menuOpen={menuOpen} onOpenMenu={() => setMenuOpen(true)} onCloseMenu={() => setMenuOpen(false)} me={me} route={route} onSignOut={signOut} />
        <main className="page" id="main" key={route}>
          {page}
        </main>
      </div>
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

function isActive(item: NavItem, route: string) {
  if (item.href === '#/') return route === '#/' || route === ''
  return route === item.href
}

function NavLinks({ route, admin, onNavigate }: { route: string, admin: boolean, onNavigate?: () => void }) {
  return (
    <>
      <div className="nav-group">
        <p className="nav-label">Workspace</p>
        <div className="nav-list">
          {deskNav.map((item) => (
            <a key={item.href} href={item.href} className="nav-item" aria-current={!admin && isActive(item, route) ? 'page' : undefined} onClick={onNavigate}>
              <Icon name={item.icon} size={18} />
              <span>{item.label}</span>
            </a>
          ))}
        </div>
      </div>
      {admin ? (
        <div className="nav-group">
          <p className="nav-label">Admin</p>
          <div className="nav-list">
            {adminNav.map((item) => (
              <a key={item.href} href={item.href} className="nav-item" aria-current={isActive(item, route) ? 'page' : undefined} onClick={onNavigate}>
                <Icon name={item.icon} size={18} />
                <span>{item.label}</span>
              </a>
            ))}
            <a href="#/" className="nav-item nav-item--quiet" onClick={onNavigate}>
              <Icon name="arrow-left" size={18} />
              <span>Back to desk</span>
            </a>
          </div>
        </div>
      ) : null}
    </>
  )
}

function UserBlock({ me }: { me: SessionUser }) {
  return (
    <div className="user">
      <span className="avatar" aria-hidden="true">{initials(me.name)}</span>
      <span className="user-text">
        <strong>{me.name}</strong>
        <small title={me.email}>{me.email}</small>
      </span>
      {me.role === 'admin' ? <span className="user-role">Admin</span> : null}
    </div>
  )
}

function Sidebar({ me, route, admin = false, onSignOut }: { me: SessionUser, route: string, admin?: boolean, onSignOut: () => void }) {
  return (
    <aside className="sidebar">
      <a className="sidebar-brand" href={admin ? '#/admin' : '#/'} aria-label="Desk home">
        <BrandMark size={32} />
        <span className="brand-name">Desk</span>
        {admin ? <span className="brand-badge">Admin</span> : null}
      </a>
      <nav className="nav" aria-label="Main navigation">
        <NavLinks route={route} admin={admin} />
      </nav>
      <div className="sidebar-foot">
        <UserBlock me={me} />
        <button type="button" className="signout" onClick={onSignOut}>
          <Icon name="logout" size={17} />
          <span>Sign out</span>
        </button>
      </div>
    </aside>
  )
}

function MobileBar(props: {
  me: SessionUser
  route: string
  menuOpen: boolean
  admin?: boolean
  onOpenMenu: () => void
  onCloseMenu: () => void
  onSignOut: () => void
}) {
  return (
    <>
      <header className="mobilebar">
        <a className="mobilebar-brand" href={props.admin ? '#/admin' : '#/'} aria-label="Desk home">
          <BrandMark size={26} />
          <span className="brand-name">Desk</span>
          {props.admin ? <span className="brand-badge">Admin</span> : null}
        </a>
        <button
          type="button"
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={props.menuOpen}
          aria-controls="mobile-menu"
          onClick={props.onOpenMenu}
        >
          <Icon name="menu" size={20} />
        </button>
      </header>
      {props.menuOpen ? <MobileMenu {...props} /> : null}
    </>
  )
}

function MobileMenu({ me, route, admin = false, onCloseMenu, onSignOut }: {
  me: SessionUser
  route: string
  admin?: boolean
  onCloseMenu: () => void
  onSignOut: () => void
}) {
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    sheetRef.current?.focus({ preventScroll: true })
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCloseMenu()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onCloseMenu])

  return (
    <div ref={sheetRef} className="sheet" id="mobile-menu" role="dialog" aria-modal="true" aria-label="Menu" tabIndex={-1}>
      <div className="sheet-head">
        <Brand subtitle={admin ? 'Admin' : undefined} />
        <button type="button" className="icon-btn icon-btn--onDark" aria-label="Close menu" onClick={onCloseMenu}>
          <Icon name="close" size={20} />
        </button>
      </div>
      <nav className="sheet-nav" aria-label="Mobile navigation">
        <NavLinks route={route} admin={admin} onNavigate={onCloseMenu} />
      </nav>
      <div className="sheet-foot">
        <UserBlock me={me} />
        <button type="button" className="signout" onClick={onSignOut}>
          <Icon name="logout" size={17} />
          <span>Sign out</span>
        </button>
      </div>
    </div>
  )
}

function Boot() {
  return (
    <div className="boot" role="status" aria-live="polite">
      <BrandMark size={38} />
      <p>Loading the desk</p>
    </div>
  )
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
    <>
      <PageHead kicker="Voice" title="Calls" lead="Dial from the browser over Telnyx. Every call keeps its minutes and the price Telnyx returns." />

      {error ? <p className="notice notice--bad" role="alert">{error}</p> : null}

      <section className={onCall ? 'panel dial-panel is-live' : 'panel dial-panel'}>
        <header className="panel-head">
          <div>
            <h2>New call</h2>
            <p>Outbound calls use your Telnyx connection and the microphone in this browser.</p>
          </div>
          {onCall ? (
            <span className="live-state is-on">
              <span className="live-dot" aria-hidden="true" />
              {stateLabel(live)}
            </span>
          ) : null}
        </header>
        <div className="panel-body">
          <form className="dialer" onSubmit={dial}>
            <div className="field dialer-field">
              <label htmlFor="number">Number to call</label>
              <div className="input-shell">
                <span className="input-icon" aria-hidden="true"><Icon name="phone" size={17} /></span>
                <input
                  id="number"
                  className="input input--number"
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={number}
                  onChange={(event) => setNumber(event.target.value)}
                  placeholder="+1 415 555 1212"
                />
              </div>
            </div>
            <button type="submit" className="btn btn--primary" disabled={busy || onCall}>
              <Icon name="phone" size={17} />
              {busy ? 'Calling' : 'Call'}
            </button>
            <button type="button" className="btn btn--danger" disabled={!active} onClick={() => hangUp(active)}>
              Hang up
            </button>
          </form>
          <p className="call-status" role="status">
            <span className={live ? 'live-dot is-on' : 'live-dot'} aria-hidden="true" />
            <span>
              <strong>{busy && !live ? 'Connecting to Telnyx' : stateLabel(live)}</strong>
              {cause && (live === 'hangup' || live === 'destroy' || live === 'purge' || live === 'failed') ? `. Telnyx said ${cause}.` : '.'}
              {' '}
              <span className="muted">The browser asks for the microphone on the first call.</span>
            </span>
          </p>
          <details className="fineprint">
            <summary>Pricing and webhook</summary>
            <p>Minutes are saved from this browser. Cost stays pending until Telnyx prices the call, and refresh pulls the detail record. A public URL to <code>/api/telnyx/webhook</code> is only needed if you want Telnyx to push the price itself.</p>
          </details>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Call history</h2>
            <p>Every call from this browser, newest first.</p>
          </div>
          {calls ? <span className="count">{calls.length}</span> : null}
        </header>
        {calls == null ? (
          <div className="panel-body"><SkeletonLines count={4} /></div>
        ) : calls.length === 0 ? (
          <EmptyState icon="phone" title="No calls yet" text="Enter a number above and press Call. The record keeps the minutes and the Telnyx cost." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Direction</th>
                  <th scope="col">Route</th>
                  <th scope="col">Minutes</th>
                  <th scope="col">Cost</th>
                  <th scope="col">Status</th>
                  <th scope="col"><span className="visually-hidden">Price</span></th>
                </tr>
              </thead>
              <tbody>
                {calls.map((call) => (
                  <tr key={call.id}>
                    <td data-label="When"><span className="cell-strong">{when(call.startedAt)}</span></td>
                    <td data-label="Direction">{call.direction || '—'}</td>
                    <td data-label="Route">
                      <span className="route">
                        <span className="mono">{call.from || '—'}</span>
                        <Icon name="arrow-right" size={13} />
                        <span className="mono">{call.to || '—'}</span>
                      </span>
                    </td>
                    <td data-label="Minutes" className="mono">{minutes(call.durationSeconds)}</td>
                    <td data-label="Cost" className={call.costAmount ? 'mono' : 'mono muted'}>{money(call.costAmount, call.currency)}</td>
                    <td data-label="Status"><Chip tone={callTone(call.status)}>{statusLabel(call.status)}</Chip></td>
                    <td data-label="Price" className="cell-action">
                      <button type="button" className="btn btn--sm" disabled={refreshing === call.id} onClick={() => refresh(call.id)}>
                        <Icon name="refresh" size={15} />
                        {refreshing === call.id ? 'Checking' : 'Refresh cost'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
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
    setMessages(null)
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

  const connection = link?.connection ?? 'starting'
  const connectionTone: Tone = connection === 'open' ? 'ok' : connection === 'starting' || connection === 'qr' ? 'warn' : 'bad'
  const connectionNote = connection === 'open'
    ? 'New texts arrive here as they reach the linked phone.'
    : connection === 'qr'
      ? 'Open WhatsApp on your phone, then Linked devices, then scan the code.'
      : connection === 'starting'
        ? 'The bridge is starting and will show a code when it is ready.'
        : connection === 'close'
          ? 'The link closed. The desk reconnects on its own.'
          : 'The WhatsApp bridge is not running.'

  return (
    <>
      <PageHead kicker="Messaging" title="WhatsApp" lead="One linked phone, every thread. Read the texts, keep a summary, and let replies follow your own pattern." />

      {error ? <p className="notice notice--bad" role="alert">{error}</p> : null}

      <div className="status-grid">
        <section className="panel status-panel">
          <header className="panel-head">
            <div>
              <h2>Connection</h2>
              <p>Bridge status and the link code for this desk.</p>
            </div>
            <Chip tone={link ? connectionTone : 'neutral'} dot>{link ? linkLabel(connection) : 'Checking'}</Chip>
          </header>
          <div className="panel-body">
            <p className="panel-note">{connectionNote}</p>
            {link?.error ? <p className="notice notice--bad" role="alert">{link.error}</p> : null}
            {link?.qrDataUrl ? (
              <div className="qr-frame">
                <img src={link.qrDataUrl} alt="WhatsApp link code" width="240" height="240" />
                <p className="qr-note"><Icon name="qr" size={16} /> Scan within a minute; a new code appears when this one expires.</p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>Auto-reply</h2>
              <p>Short replies in the pattern learned from your own texts.</p>
            </div>
            <Chip tone={reply?.enabled ?? true ? 'ok' : 'neutral'}>{reply?.enabled ?? true ? 'On' : 'Off'}</Chip>
          </header>
          <div className="panel-body">
            <label className="switch">
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
              <span className="switch-ui" aria-hidden="true"><span className="switch-thumb" /></span>
              <span className="switch-copy">
                <strong>Reply in your own pattern</strong>
                <small>Replies are held back while this is off.</small>
              </span>
            </label>
            {reply == null ? <SkeletonLines count={2} /> : reply.exampleCount < 3 ? (
              <p className="panel-note">Replying in short lines until your own texts teach the pattern. {reply.exampleCount} of 3 replies seen; answer from your phone and the next replies follow you.</p>
            ) : (
              <blockquote className="pattern">{reply.pattern || 'Reading your replies.'}</blockquote>
            )}
          </div>
        </section>
      </div>

      <div className="messenger">
        <section className="chat-column" aria-label="Chats">
          <header className="messenger-head">
            <div>
              <h2>Chats</h2>
              <p>{chats ? `${chats.length} ${chats.length === 1 ? 'thread' : 'threads'}` : 'Loading threads'}</p>
            </div>
          </header>
          {chats == null ? (
            <div className="messenger-body"><SkeletonLines count={4} /></div>
          ) : chats.length === 0 ? (
            <EmptyState icon="chat" title="No texts yet" text="Messages that arrive after you link show up here." />
          ) : (
            <ul className="chat-list">
              {chats.map((chat) => (
                <li key={chat.jid}>
                  <button type="button" className="chat-item" aria-current={chat.jid === selected ? 'true' : undefined} onClick={() => openChat(chat.jid, chat)}>
                    <span className="avatar avatar--sm" aria-hidden="true">{initials(chatLabel(chat))}</span>
                    <span className="chat-copy">
                      <span className="chat-top">
                        <strong>{chatLabel(chat)}</strong>
                        <time dateTime={chat.lastMessageAt}>{shortDate(chat.lastMessageAt)}</time>
                      </span>
                      <span className="chat-preview">{chat.lastText || 'No text yet'}</span>
                    </span>
                    <span className="chat-count">{chat.messageCount}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="thread-column" aria-label="Transcript">
          {current ? (
            <>
              <header className="thread-head">
                <div className="thread-id">
                  <span className="avatar" aria-hidden="true">{initials(chatLabel(current))}</span>
                  <div>
                    <h2>{chatLabel(current)}</h2>
                    <p>{current.messageCount} {current.messageCount === 1 ? 'text' : 'texts'} received · {current.transcriptCount} in the transcript</p>
                  </div>
                </div>
                <button type="button" className="btn btn--secondary" disabled={summarizing} onClick={summarize}>
                  <Icon name="refresh" size={15} />
                  {summarizing ? 'Writing summary' : 'Generate summary'}
                </button>
              </header>
              <dl className="thread-stats">
                <div><dt>Texts</dt><dd>{current.messageCount}</dd></div>
                <div><dt>First text</dt><dd>{when(current.firstMessageAt)}</dd></div>
                <div><dt>Latest</dt><dd>{when(current.lastMessageAt)}</dd></div>
              </dl>
              <div className="summary-box">
                <div className="summary-head">
                  <h3>Summary</h3>
                  {summary?.summaryStale ? <Chip tone="warn">Covers {summary.summaryMessageCount} of {current.transcriptCount}</Chip> : summary?.summaryText ? <Chip tone="ok">Current</Chip> : null}
                </div>
                {summary?.summaryText
                  ? <p className="summary-text">{summary.summaryText}</p>
                  : <p className="summary-text muted">No summary yet. Generate one to read the thread at a glance; the stats above stay either way.</p>}
              </div>
              {messages == null ? (
                <div className="thread-body"><SkeletonLines count={4} /></div>
              ) : messages.length === 0 ? (
                <EmptyState icon="chat" title="No texts in this thread" text="The transcript fills as messages arrive." />
              ) : (
                <ol className="message-list">
                  {messages.map((message) => (
                    <li key={message.id} className={message.fromMe ? 'message message--mine' : 'message'}>
                      <div className="message-meta">
                        <strong>{message.fromMe ? 'You' : message.pushName || 'Unknown'}</strong>
                        <time dateTime={message.timestamp}>{when(message.timestamp)}</time>
                      </div>
                      <p className="message-body">{message.body}</p>
                    </li>
                  ))}
                </ol>
              )}
            </>
          ) : (
            <div className="thread-empty">
              <EmptyState icon="chat" title="Pick a chat" text="The transcript, its counts and a summary open here.">
                {chats && chats.length > 0 ? (
                  <button type="button" className="btn btn--secondary" onClick={() => openChat(chats[0].jid, chats[0])}>Open the newest chat</button>
                ) : null}
              </EmptyState>
            </div>
          )}
        </section>
      </div>
    </>
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
