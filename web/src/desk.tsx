import { useEffect, useState, type FormEvent } from 'react'
import { Brand, Chip, EmptyState, Icon, Notice, PageHead, SkeletonLines, initials, type Tone } from './ui'

export type SessionUser = {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  balanceUnits: number
}

type DashboardData = {
  balance: string
  spent: string
  durationSeconds: number
  pendingCostCount: number
  byDestination: { destination: string, calls: number, durationSeconds: number, amount: string }[]
  ledger: { id: number, kind: string, amount: string, note: string | null, createdAt: string }[]
}

type GalleryNumber = {
  phoneNumber: string
  type: string
  region: string
  upfrontCost: string
  monthlyCost: string
  currency: string
  features: string[]
}

type OwnedNumber = {
  phone_number: string
  region: string | null
  upfront_cost: string | null
  monthly_cost: string | null
  currency: string | null
  ordered_at: string
}

type CreditRequest = {
  id: number
  email: string | null
  name: string | null
  amount: string
  note: string | null
  status: string
  createdAt: string
}

const countries = [
  ['US', 'United States'],
  ['CA', 'Canada'],
  ['GB', 'United Kingdom'],
  ['AU', 'Australia'],
  ['PK', 'Pakistan'],
  ['DE', 'Germany'],
  ['FR', 'France'],
  ['AE', 'United Arab Emirates'],
] as const

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error || 'Request failed.')
  return body
}

function dollars(value: string, digits = 2) {
  const amount = Number(value)
  if (!Number.isFinite(amount)) return value
  return amount.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function minutes(seconds: number) {
  return `${(seconds / 60).toFixed(1)} min`
}

function when(value: string | null) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function statusTone(status: string): Tone {
  if (status === 'approved') return 'ok'
  if (status === 'rejected') return 'bad'
  if (status === 'pending') return 'warn'
  return 'neutral'
}

function kindTone(kind: string): Tone {
  if (kind === 'credit') return 'ok'
  if (kind === 'number') return 'info'
  return 'neutral'
}

function cap(value: string) {
  return value ? value[0].toUpperCase() + value.slice(1) : value
}

export function AuthScreen({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [mode, setMode] = useState(window.location.hash === '#/signup' ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  function switchMode(next: 'login' | 'signup') {
    setMode(next)
    setError('')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const user = await readJson<SessionUser>(await fetch(mode === 'signup' ? '/api/auth/signup' : '/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      }))
      window.location.hash = '#/'
      onSuccess(user)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Sign in failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth">
      <aside className="auth-aside">
        <div className="auth-aside-inner">
          <a className="auth-brand" href="#/" aria-label="Desk home">
            <Brand />
          </a>
          <div className="auth-pitch">
            <p className="kicker kicker--onDark">Voice and messaging console</p>
            <h2>Calls, numbers and WhatsApp on one desk.</h2>
            <p>Dial over Telnyx, buy numbers with prepaid credit, and read every WhatsApp thread with a summary written from its own messages.</p>
          </div>
          <div className="auth-preview" aria-hidden="true">
            <div className="preview-top">
              <span>Available balance</span>
              <span className="preview-live">Live</span>
            </div>
            <p className="preview-amount">$128.40</p>
            <div className="preview-rows">
              <div><span className="mono">+1 415 555 0128</span><span>4.2 min</span><span className="preview-cost">$0.032</span></div>
              <div><span className="mono">+44 20 7946 0921</span><span>1.8 min</span><span className="preview-cost">$0.019</span></div>
              <div><span className="mono">+92 300 1234567</span><span>2.0 min</span><span className="preview-cost">$0.014</span></div>
            </div>
            <div className="preview-foot">
              <span className="preview-dot" />
              WhatsApp linked
              <span className="preview-sep" />
              3 threads open
            </div>
          </div>
          <ul className="auth-facts">
            <li><Icon name="phone" size={17} />Browser calls on Telnyx WebRTC</li>
            <li><Icon name="whatsapp" size={17} />WhatsApp threads with summaries</li>
            <li><Icon name="card" size={17} />Prepaid balance, per-call pricing</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-box">
          <div className="auth-mobile-brand">
            <Brand subtitle="Sign in" />
          </div>
          <div className="auth-tabs" role="tablist" aria-label="Account access" data-mode={mode}>
            <span className="auth-tabs-indicator" aria-hidden="true" />
            <button type="button" role="tab" aria-selected={mode === 'login'} tabIndex={mode === 'login' ? 0 : -1} onClick={() => switchMode('login')}>
              Sign in
            </button>
            <button type="button" role="tab" aria-selected={mode === 'signup'} tabIndex={mode === 'signup' ? 0 : -1} onClick={() => switchMode('signup')}>
              Create account
            </button>
          </div>

          <div className="auth-copy">
            <h1>{mode === 'signup' ? 'Create your account.' : 'Sign in to the desk.'}</h1>
            <p>{mode === 'signup'
              ? 'New accounts start with a zero balance. An admin approves credit before calls and numbers spend.'
              : 'Use the email on your account. Balance, calls and numbers follow the account.'}</p>
          </div>

          <form className="stack" onSubmit={submit}>
            {mode === 'signup' ? (
              <div className="field">
                <label htmlFor="auth-name">Name</label>
                <input id="auth-name" className="input" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="auth-email">Email</label>
              <input id="auth-email" className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" placeholder="you@company.com" required />
            </div>
            <div className="field">
              <label htmlFor="auth-password">Password</label>
              <div className="input-shell">
                <input
                  id="auth-password"
                  className="input input--password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((current) => !current)}
                >
                  <Icon name={showPassword ? 'eye-off' : 'eye'} size={17} />
                </button>
              </div>
            </div>
            {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
            <button className="btn btn--primary btn--block" type="submit" disabled={busy}>
              {busy ? 'Checking the account' : mode === 'signup' ? 'Create account' : 'Sign in'}
              {!busy ? <Icon name="arrow-right" size={17} /> : null}
            </button>
          </form>

          <p className="auth-switch">
            {mode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
            <button type="button" className="linkish" onClick={() => switchMode(mode === 'signup' ? 'login' : 'signup')}>
              {mode === 'signup' ? 'Sign in' : 'Create one'}
            </button>
          </p>
          <p className="auth-foot">Telnyx voice · WhatsApp · Gemini summaries</p>
        </div>
      </main>
    </div>
  )
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/dashboard').then((response) => readJson<DashboardData>(response)).then(setData).catch((reason: Error) => setError(reason.message))
  }, [])
  return (
    <>
      <PageHead kicker="Overview" title="Dashboard" lead="Your balance, your spend and every call Telnyx has priced." />
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}
      {!data ? (
        <div className="dashboard-skeleton">
          <div className="panel"><div className="panel-body"><SkeletonLines count={3} /></div></div>
          <div className="panel"><div className="panel-body"><SkeletonLines count={4} /></div></div>
        </div>
      ) : (
        <>
          <section className="balance-card" aria-label="Balance and spend">
            <div className="balance-main">
              <p className="stat-label">Available balance</p>
              <p className="balance-amount">{dollars(data.balance)}</p>
              <p className="balance-note">Calls and number purchases draw from this balance.</p>
              <a className="btn btn--onDark btn--sm" href="#/billing">
                Request credit
                <Icon name="arrow-right" size={15} />
              </a>
            </div>
            <dl className="balance-stats">
              <div>
                <dt>Spent</dt>
                <dd>{dollars(data.spent, 4)}</dd>
              </div>
              <div>
                <dt>Telnyx minutes</dt>
                <dd>{minutes(data.durationSeconds)}</dd>
              </div>
            </dl>
          </section>

          {data.pendingCostCount > 0 ? (
            <Notice tone="warn">
              {data.pendingCostCount} ended {data.pendingCostCount === 1 ? 'call is' : 'calls are'} still waiting on a Telnyx price. <a className="link" href="#/calls">Open calls</a>
            </Notice>
          ) : null}

          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Where it went</h2>
                <p>Priced calls grouped by destination number.</p>
              </div>
              {data.byDestination.length > 0 ? <span className="count">{data.byDestination.length}</span> : null}
            </header>
            {data.byDestination.length === 0 ? (
              <EmptyState icon="phone" title="No priced calls yet" text="Minutes and cost appear here after Telnyx prices a call." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th scope="col">Number</th><th scope="col">Calls</th><th scope="col">Minutes</th><th scope="col">Spent</th></tr>
                  </thead>
                  <tbody>
                    {data.byDestination.map((row) => (
                      <tr key={row.destination}>
                        <td data-label="Number"><span className="mono cell-strong">{row.destination}</span></td>
                        <td data-label="Calls" className="mono">{row.calls}</td>
                        <td data-label="Minutes" className="mono">{minutes(row.durationSeconds)}</td>
                        <td data-label="Spent" className="mono">{dollars(row.amount, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Ledger</h2>
                <p>Credit, calls and number purchases in order.</p>
              </div>
              {data.ledger.length > 0 ? <span className="count">{data.ledger.length}</span> : null}
            </header>
            {data.ledger.length === 0 ? (
              <EmptyState icon="card" title="Nothing on the ledger yet" text="Approved credit and every charge land here." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Note</th><th scope="col">Amount</th></tr>
                  </thead>
                  <tbody>
                    {data.ledger.map((row) => (
                      <tr key={row.id}>
                        <td data-label="When">{when(row.createdAt)}</td>
                        <td data-label="Kind"><Chip tone={kindTone(row.kind)}>{cap(row.kind)}</Chip></td>
                        <td data-label="Note">{row.note || '—'}</td>
                        <td data-label="Amount" className={Number(row.amount) < 0 ? 'mono amount amount--out' : 'mono amount amount--in'}>{dollars(row.amount, 4)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      )}
    </>
  )
}

function chargeUnits(item: GalleryNumber) {
  const upfront = Number(item.upfrontCost)
  const monthly = Number(item.monthlyCost)
  const charge = Number.isFinite(upfront) && upfront > 0 ? upfront : monthly
  if (!Number.isFinite(charge) || charge < 0) return null
  return Math.round(charge * 10000)
}

export function NumbersPage() {
  const [country, setCountry] = useState('US')
  const [area, setArea] = useState('')
  const [contains, setContains] = useState('')
  const [results, setResults] = useState<GalleryNumber[] | null>(null)
  const [owned, setOwned] = useState<OwnedNumber[]>([])
  const [balanceUnits, setBalanceUnits] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState<string | null>(null)

  async function loadOwned() {
    setOwned(await readJson<OwnedNumber[]>(await fetch('/api/numbers')))
  }

  useEffect(() => {
    loadOwned().catch((reason: Error) => setError(reason.message))
    fetch('/api/auth/me').then((response) => readJson<SessionUser>(response)).then((user) => setBalanceUnits(user.balanceUnits)).catch(() => setBalanceUnits(0))
  }, [])

  async function search(event: FormEvent) {
    event.preventDefault()
    setError('')
    setResults(null)
    const params = new URLSearchParams({ country, area, contains })
    try {
      setResults(await readJson<GalleryNumber[]>(await fetch(`/api/numbers/available?${params}`)))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The gallery did not load.')
    }
  }

  async function buy(phoneNumber: string) {
    setBusy(phoneNumber)
    setError('')
    try {
      await readJson(await fetch('/api/numbers/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, country }),
      }))
      await loadOwned()
      setResults((current) => current?.filter((item) => item.phoneNumber !== phoneNumber) ?? null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The number was not purchased.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHead kicker="Inventory" title="Numbers" lead="Find a number Telnyx has available, buy it with your balance, and keep it on your account." />

      {balanceUnits === 0 ? (
        <Notice tone="warn">
          Your balance is $0.00. <a className="link" href="#/billing">Request credit</a> and wait for approval before buying a number.
        </Notice>
      ) : null}
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Search inventory</h2>
            <p>Availability comes from the Telnyx account attached to this desk.</p>
          </div>
          {balanceUnits != null ? <Chip tone={balanceUnits > 0 ? 'ok' : 'warn'}>{dollars(String(balanceUnits / 10000))} available</Chip> : null}
        </header>
        <form className="panel-body form-grid form-grid--search" onSubmit={search}>
          <div className="field">
            <label htmlFor="country">Country</label>
            <select id="country" className="select" value={country} onChange={(event) => setCountry(event.target.value)}>
              {countries.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="area">Area code</label>
            <input id="area" className="input" value={area} onChange={(event) => setArea(event.target.value)} inputMode="numeric" placeholder="415" />
          </div>
          <div className="field">
            <label htmlFor="contains">Contains</label>
            <input id="contains" className="input" value={contains} onChange={(event) => setContains(event.target.value)} placeholder="202" />
          </div>
          <button className="btn btn--primary" type="submit">
            <Icon name="search" size={17} />
            Search
          </button>
        </form>
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Your numbers</h2>
            <p>Numbers ordered on this desk and charged to your balance.</p>
          </div>
          {owned.length > 0 ? <span className="count">{owned.length}</span> : null}
        </header>
        {owned.length === 0 ? (
          <EmptyState icon="hash" title="No numbers on this account" text="Search the inventory below and buy the first one." />
        ) : (
          <ul className="rows">
            {owned.map((item) => (
              <li key={item.phone_number} className="row">
                <span className="row-main">
                  <span className="mono row-title">{item.phone_number}</span>
                  <span className="row-sub">{item.region || 'Purchased number'} · ordered {when(item.ordered_at)}</span>
                </span>
                <span className="row-side">
                  <Chip tone="ok">Active</Chip>
                  {item.monthly_cost ? <span className="row-price">{dollars(item.monthly_cost)}<small> / month</small></span> : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Available numbers</h2>
            <p>Buying assigns the number to you and takes the upfront or monthly cost from your balance.</p>
          </div>
          {results ? <span className="count">{results.length}</span> : null}
        </header>
        {results == null && !error ? (
          <EmptyState icon="search" title="Search to load inventory" text="Pick a country, narrow it with an area code or digits, then search." />
        ) : results == null ? null : results.length === 0 ? (
          <EmptyState icon="search" title="No numbers matched" text="Try a different country, area code or digit pattern." />
        ) : (
          <div className="panel-body">
            <ul className="number-grid">
              {results.map((item) => {
                const cost = chargeUnits(item)
                const short = balanceUnits == null || balanceUnits <= 0 || (cost != null && balanceUnits < cost)
                return (
                  <li key={item.phoneNumber} className="number-card">
                    <span className="mono number-value">{item.phoneNumber}</span>
                    <span className="number-region">{item.region || item.type || country}</span>
                    <span className="number-price">
                      {dollars(item.upfrontCost)} up front
                      <small>{dollars(item.monthlyCost)} / month</small>
                    </span>
                    {item.features?.length ? (
                      <span className="number-features">
                        {item.features.slice(0, 3).map((feature) => <span key={feature} className="tag">{feature}</span>)}
                      </span>
                    ) : null}
                    <button type="button" className="btn btn--secondary btn--block" disabled={short || busy === item.phoneNumber} onClick={() => buy(item.phoneNumber)}>
                      {busy === item.phoneNumber ? 'Buying' : short ? 'Need credit' : 'Buy number'}
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </section>
    </>
  )
}

export function BillingPage() {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<CreditRequest[] | null>(null)
  const [balanceUnits, setBalanceUnits] = useState<number | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setRows(await readJson<CreditRequest[]>(await fetch('/api/billing/requests')))
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message))
    fetch('/api/auth/me').then((response) => readJson<SessionUser>(response)).then((user) => setBalanceUnits(user.balanceUnits)).catch(() => undefined)
  }, [])

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await readJson(await fetch('/api/billing/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount, note }),
      }))
      setAmount('')
      setNote('')
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The request was not sent.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead kicker="Credit" title="Billing" lead="Ask for credit. An admin approves it, and the amount lands in your balance." />
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}

      <div className="split-grid">
        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>Request credit</h2>
              <p>Requests are reviewed by an admin before the balance moves.</p>
            </div>
            {balanceUnits != null ? <Chip tone={balanceUnits > 0 ? 'ok' : 'warn'}>{dollars(String(balanceUnits / 10000))} balance</Chip> : null}
          </header>
          <form className="panel-body stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="amount">Amount in USD</label>
              <div className="input-shell">
                <span className="input-icon" aria-hidden="true">$</span>
                <input id="amount" className="input input--money" value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="25.00" required />
              </div>
            </div>
            <div className="field">
              <label htmlFor="note">Note</label>
              <input id="note" className="input" value={note} onChange={(event) => setNote(event.target.value)} placeholder="What the credit is for (optional)" />
            </div>
            <button className="btn btn--primary btn--fit" type="submit" disabled={busy}>
              {busy ? 'Sending request' : 'Request credit'}
            </button>
          </form>
        </section>

        <aside className="panel panel--quiet">
          <header className="panel-head">
            <div>
              <h2>How it works</h2>
              <p>Three steps from request to balance.</p>
            </div>
          </header>
          <ol className="steps">
            <li><span className="step-index">1</span><span><strong>Request</strong><small>Enter an amount from $1.00 to $10,000.00.</small></span></li>
            <li><span className="step-index">2</span><span><strong>Approval</strong><small>An admin approves or rejects it in Approvals.</small></span></li>
            <li><span className="step-index">3</span><span><strong>Spend</strong><small>Calls and number purchases draw from the balance.</small></span></li>
          </ol>
        </aside>
      </div>

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Your requests</h2>
            <p>Every request and the decision on it.</p>
          </div>
          {rows ? <span className="count">{rows.length}</span> : null}
        </header>
        {rows == null ? (
          <div className="panel-body"><SkeletonLines count={3} /></div>
        ) : rows.length === 0 ? (
          <EmptyState icon="card" title="No requests yet" text="The first request you send appears here with its status." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">When</th><th scope="col">Amount</th><th scope="col">Note</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td data-label="When">{when(row.createdAt)}</td>
                    <td data-label="Amount" className="mono cell-strong">{dollars(row.amount)}</td>
                    <td data-label="Note">{row.note || '—'}</td>
                    <td data-label="Status"><Chip tone={statusTone(row.status)}>{cap(row.status)}</Chip></td>
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

export function AdminPage() {
  const [rows, setRows] = useState<CreditRequest[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setRows(await readJson<CreditRequest[]>(await fetch('/api/billing/requests')))
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message))
  }, [])

  async function decide(id: number, approve: boolean) {
    setError('')
    try {
      await readJson(await fetch(`/api/billing/requests/${id}/${approve ? 'approve' : 'reject'}`, { method: 'POST' }))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The decision was not saved.')
    }
  }

  const pending = rows?.filter((row) => row.status === 'pending') ?? []
  const decided = rows?.filter((row) => row.status !== 'pending') ?? []

  return (
    <>
      <PageHead kicker="Moderation" title="Approvals" lead="Credit requests wait here until an admin approves or rejects them.">
        {rows ? <Chip tone={pending.length > 0 ? 'warn' : 'ok'} dot>{pending.length} waiting</Chip> : null}
      </PageHead>
      {error ? <Notice tone="bad" role="alert">{error}</Notice> : null}

      <section className="panel">
        <header className="panel-head">
          <div>
            <h2>Waiting for a decision</h2>
            <p>Approving adds the amount to the requester's balance and writes it to the ledger.</p>
          </div>
        </header>
        {rows == null ? (
          <div className="panel-body"><SkeletonLines count={3} /></div>
        ) : pending.length === 0 ? (
          <EmptyState icon="shield" title="Nothing is waiting" text="New credit requests appear here as soon as they are sent." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Who</th><th scope="col">Amount</th><th scope="col">Note</th><th scope="col">Decision</th></tr>
              </thead>
              <tbody>
                {pending.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Who">
                      <span className="person">
                        <span className="avatar avatar--sm" aria-hidden="true">{initials(row.name || '?')}</span>
                        <span><strong>{row.name}</strong><small>{row.email}</small></span>
                      </span>
                    </td>
                    <td data-label="Amount" className="mono cell-strong">{dollars(row.amount)}</td>
                    <td data-label="Note">{row.note || '—'}</td>
                    <td data-label="Decision">
                      <span className="actions">
                        <button type="button" className="btn btn--primary btn--sm" onClick={() => decide(row.id, true)}>
                          <Icon name="check" size={15} />
                          Approve
                        </button>
                        <button type="button" className="btn btn--sm" onClick={() => decide(row.id, false)}>
                          <Icon name="x" size={15} />
                          Reject
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {decided.length > 0 ? (
        <section className="panel">
          <header className="panel-head">
            <div>
              <h2>Decided</h2>
              <p>The last requests that already have an answer.</p>
            </div>
            <span className="count">{decided.length}</span>
          </header>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th scope="col">Who</th><th scope="col">Amount</th><th scope="col">Sent</th><th scope="col">Status</th></tr>
              </thead>
              <tbody>
                {decided.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Who">{row.name}<span className="row-sub">{row.email}</span></td>
                    <td data-label="Amount" className="mono cell-strong">{dollars(row.amount)}</td>
                    <td data-label="Sent">{when(row.createdAt)}</td>
                    <td data-label="Status"><Chip tone={statusTone(row.status)}>{cap(row.status)}</Chip></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </>
  )
}
