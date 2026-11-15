import { useEffect, useState, type FormEvent } from 'react'

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

type AdminCall = {
  id: number
  userName: string | null
  userEmail: string | null
  direction: string | null
  from: string | null
  to: string | null
  status: string
  startedAt: string | null
  durationSeconds: number | null
  costAmount: string | null
  currency: string | null
  recordingAvailable: boolean
  recordingFormat: string | null
  summaryText: string | null
  summaryAt: string | null
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
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

export function AuthScreen({ onSuccess }: { onSuccess: (user: SessionUser) => void }) {
  const [mode, setMode] = useState(window.location.hash === '#/signup' ? 'signup' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

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
    <main className="auth-card">
      <p className="eyebrow">Desk</p>
      <h1>{mode === 'signup' ? 'Create an account' : 'Sign in'}</h1>
      <form className="stack" onSubmit={submit}>
        {mode === 'signup' ? (
          <label className="field">Name
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </label>
        ) : null}
        <label className="field">Email
          <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </label>
        <label className="field">Password
          <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Working' : mode === 'signup' ? 'Create account' : 'Sign in'}</button>
      </form>
      <p className="switch">
        {mode === 'signup' ? 'Already have an account?' : 'Need an account?'}{' '}
        <button type="button" className="linkish" onClick={() => { setMode(mode === 'signup' ? 'login' : 'signup'); setError('') }}>
          {mode === 'signup' ? 'Sign in' : 'Sign up'}
        </button>
      </p>
    </main>
  )
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    fetch('/api/dashboard').then((response) => readJson<DashboardData>(response)).then(setData).catch((reason: Error) => setError(reason.message))
  }, [])
  return (
    <main>
      <h1>Dashboard</h1>
      {error ? <p role="alert">{error}</p> : null}
      {!data ? <p className="waiting">Loading your account.</p> : (
        <>
          <dl className="ledger">
            <div><dt>Balance</dt><dd>{dollars(data.balance)}</dd></div>
            <div><dt>Spent</dt><dd>{dollars(data.spent, 4)}</dd></div>
            <div><dt>Telnyx minutes</dt><dd>{minutes(data.durationSeconds)}</dd></div>
          </dl>
          {data.pendingCostCount > 0 ? <p>{data.pendingCostCount} ended {data.pendingCostCount === 1 ? 'call is' : 'calls are'} still waiting on a Telnyx price.</p> : null}
          <h2>Where it went</h2>
          {data.byDestination.length === 0 ? <p>No priced calls yet. Minutes and cost show up here after Telnyx prices a call.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Number</th><th>Calls</th><th>Minutes</th><th>Spent</th></tr></thead>
                <tbody>
                  {data.byDestination.map((row) => (
                    <tr key={row.destination}>
                      <td>{row.destination}</td>
                      <td>{row.calls}</td>
                      <td>{minutes(row.durationSeconds)}</td>
                      <td>{dollars(row.amount, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2>Ledger</h2>
          {data.ledger.length === 0 ? <p>Credit and charges will be listed here.</p> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Kind</th><th>Note</th><th>Amount</th></tr></thead>
                <tbody>
                  {data.ledger.map((row) => (
                    <tr key={row.id}>
                      <td>{when(row.createdAt)}</td>
                      <td>{row.kind}</td>
                      <td>{row.note || '—'}</td>
                      <td>{dollars(row.amount, 4)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
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
    <main>
      <h1>Number gallery</h1>
      <p>These are numbers Telnyx has available for the filters below. Buying one orders it on the Telnyx account and assigns it to you. The upfront cost, or the monthly cost when there is no upfront cost, is taken from your balance.</p>
      {balanceUnits === 0 ? <p role="alert">Your balance is $0.00. Request credit and wait for approval before buying a number.</p> : null}
      <form className="dial" onSubmit={search}>
        <label className="field">Country
          <select value={country} onChange={(event) => setCountry(event.target.value)}>
            {countries.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </label>
        <label className="field">Area code
          <input value={area} onChange={(event) => setArea(event.target.value)} inputMode="numeric" placeholder="415" />
        </label>
        <label className="field">Contains
          <input value={contains} onChange={(event) => setContains(event.target.value)} placeholder="202" />
        </label>
        <button className="primary" type="submit">Search</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {owned.length > 0 ? (
        <>
          <h2>Your numbers</h2>
          <ul className="gallery">
            {owned.map((item) => (
              <li key={item.phone_number}>
                <strong>{item.phone_number}</strong>
                <span>{item.region || 'Purchased'}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {results == null && !error ? <p className="waiting">Search to load Telnyx inventory.</p> : results == null ? null : results.length === 0 ? <p>No numbers matched those filters.</p> : (
        <ul className="gallery">
          {results.map((item) => {
            const cost = chargeUnits(item)
            const short = balanceUnits == null || balanceUnits <= 0 || (cost != null && balanceUnits < cost)
            return (
              <li key={item.phoneNumber}>
                <strong>{item.phoneNumber}</strong>
                <span>{item.region || item.type || country}</span>
                <span>{dollars(item.upfrontCost)} up front · {dollars(item.monthlyCost)} / month</span>
                <button type="button" className="primary" disabled={short || busy === item.phoneNumber} onClick={() => buy(item.phoneNumber)}>
                  {busy === item.phoneNumber ? 'Buying' : short ? 'Need credit' : 'Buy'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </main>
  )
}

export function BillingPage() {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [rows, setRows] = useState<CreditRequest[] | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    setRows(await readJson<CreditRequest[]>(await fetch('/api/billing/requests')))
  }

  useEffect(() => {
    load().catch((reason: Error) => setError(reason.message))
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
    <main>
      <h1>Billing</h1>
      <p>Ask for credit. An admin approves it, and the amount is added to your balance. Calls and number purchases spend that balance.</p>
      <form className="dial" onSubmit={submit}>
        <label className="field">Amount in USD
          <input value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" placeholder="25.00" required />
        </label>
        <label className="field">Note
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional" />
        </label>
        <button className="primary" type="submit" disabled={busy}>{busy ? 'Sending' : 'Request credit'}</button>
      </form>
      {error ? <p role="alert">{error}</p> : null}
      {rows == null ? <p className="waiting">Loading requests.</p> : rows.length === 0 ? <p>No requests yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>When</th><th>Amount</th><th>Note</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{when(row.createdAt)}</td>
                  <td>{dollars(row.amount)}</td>
                  <td>{row.note || '—'}</td>
                  <td>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  )
}

export function AdminPage() {
  const [rows, setRows] = useState<CreditRequest[] | null>(null)
  const [calls, setCalls] = useState<AdminCall[] | null>(null)
  const [error, setError] = useState('')

  async function load() {
    const [requests, callRows] = await Promise.all([
      readJson<CreditRequest[]>(await fetch('/api/billing/requests')),
      readJson<AdminCall[]>(await fetch('/api/admin/calls')),
    ])
    setRows(requests)
    setCalls(callRows)
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

  async function summarizeCall(id: number) {
    setError('')
    try {
      await readJson(await fetch(`/api/admin/calls/${id}/summary`, { method: 'POST' }))
      await load()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The call summary was not saved.')
    }
  }

  const pending = rows?.filter((row) => row.status === 'pending') ?? []
  return (
    <main>
      <h1>Approvals</h1>
      {error ? <p role="alert">{error}</p> : null}
      {rows == null ? <p className="waiting">Loading requests.</p> : pending.length === 0 ? <p>No credit requests are waiting.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Who</th><th>Amount</th><th>Note</th><th>Decision</th></tr></thead>
            <tbody>
              {pending.map((row) => (
                <tr key={row.id}>
                  <td>{row.name}<br />{row.email}</td>
                  <td>{dollars(row.amount)}</td>
                  <td>{row.note || '—'}</td>
                  <td className="actions">
                    <button type="button" className="primary" onClick={() => decide(row.id, true)}>Approve</button>
                    <button type="button" onClick={() => decide(row.id, false)}>Reject</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h2>Calls</h2>
      {calls == null ? <p className="waiting">Loading calls.</p> : calls.length === 0 ? <p>No calls have been saved yet.</p> : (
        <div className="table-wrap">
          <table>
            <thead><tr><th>Who</th><th>When</th><th>Route</th><th>Minutes</th><th>Recording</th><th>Summary</th></tr></thead>
            <tbody>
              {calls.map((call) => (
                <tr key={call.id}>
                  <td>{call.userName || 'Unlinked'}<br /><small>{call.userEmail || '—'}</small></td>
                  <td>{when(call.startedAt)}</td>
                  <td>{call.from || '—'} → {call.to || '—'}</td>
                  <td>{minutes(call.durationSeconds ?? 0)}</td>
                  <td>{call.recordingAvailable ? <audio controls preload="none" src={`/api/admin/calls/${call.id}/recording`} /> : 'Pending'}</td>
                  <td>
                    {call.summaryText ? <p>{call.summaryText}</p> : null}
                    <button type="button" disabled={!call.recordingAvailable} onClick={() => summarizeCall(call.id)}>
                      {call.summaryText ? 'Regenerate summary' : 'Generate summary'}
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
