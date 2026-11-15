import type { AuthUser } from './auth.ts'
import { db } from './db.ts'
import { fromUnits, priceUnits, purchaseBlock, toUnits } from './logic.ts'
import { orderPhoneNumber, searchAvailableNumbers } from './telnyx.ts'

export function balanceOf(userId: number) {
  const row = db.prepare('SELECT balance_units AS units FROM users WHERE id = ?').get(userId) as { units: number }
  return row?.units ?? 0
}

export function dashboardFor(userId: number) {
  const balance = balanceOf(userId)
  const spentRow = db.prepare(`
    SELECT COALESCE(SUM(-amount_units), 0) AS units
    FROM ledger
    WHERE user_id = ? AND amount_units < 0
  `).get(userId) as { units: number }
  const time = db.prepare(`
    SELECT
      COALESCE(SUM(duration_seconds), 0) AS seconds,
      SUM(CASE WHEN status = 'hangup' AND cost_amount IS NULL THEN 1 ELSE 0 END) AS pending
    FROM calls
    WHERE user_id = ?
  `).get(userId) as { seconds: number, pending: number | null }
  const byDestination = db.prepare(`
    SELECT
      COALESCE(to_number, 'Unknown') AS destination,
      COUNT(*) AS calls,
      COALESCE(SUM(duration_seconds), 0) AS seconds,
      COALESCE(SUM(CAST(cost_amount AS REAL)), 0) AS amount
    FROM calls
    WHERE user_id = ? AND cost_amount IS NOT NULL
    GROUP BY to_number
    ORDER BY amount DESC
    LIMIT 12
  `).all(userId) as { destination: string, calls: number, seconds: number, amount: number }[]
  const ledger = db.prepare(`
    SELECT id, amount_units, kind, note, created_at
    FROM ledger
    WHERE user_id = ?
    ORDER BY id DESC
    LIMIT 40
  `).all(userId) as { id: number, amount_units: number, kind: string, note: string | null, created_at: string }[]
  return {
    balance: fromUnits(balance),
    spent: fromUnits(spentRow.units),
    durationSeconds: time.seconds ?? 0,
    pendingCostCount: time.pending ?? 0,
    byDestination: byDestination.map((row) => ({
      destination: row.destination,
      calls: Number(row.calls),
      durationSeconds: Number(row.seconds),
      amount: Number(row.amount).toFixed(4),
    })),
    ledger: ledger.map((row) => ({
      id: row.id,
      kind: row.kind,
      amount: fromUnits(row.amount_units),
      note: row.note,
      createdAt: row.created_at,
    })),
  }
}

export function requestCredit(userId: number, amount: string, note: string) {
  const units = toUnits(amount)
  if (units == null || units < 10000 || units > 10000 * 10000) fail(400, 'Enter an amount from 1.00 to 10000.00.')
  const result = db.prepare(`
    INSERT INTO credit_requests (user_id, amount_units, note, status, created_at)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(userId, units, note.slice(0, 280) || null, new Date().toISOString())
  return creditJson(Number(result.lastInsertRowid))
}

export function listCredits(user: AuthUser) {
  const rows = user.role === 'admin'
    ? db.prepare(`
        SELECT r.*, u.email, u.name
        FROM credit_requests r
        JOIN users u ON u.id = r.user_id
        ORDER BY r.id DESC
        LIMIT 100
      `).all()
    : db.prepare(`
        SELECT r.*, u.email, u.name
        FROM credit_requests r
        JOIN users u ON u.id = r.user_id
        WHERE r.user_id = ?
        ORDER BY r.id DESC
        LIMIT 100
      `).all(user.id)
  return (rows as CreditRow[]).map(creditView)
}

export function decideCredit(adminId: number, requestId: number, approve: boolean) {
  db.exec('BEGIN')
  try {
    const row = db.prepare('SELECT * FROM credit_requests WHERE id = ?').get(requestId) as CreditRow | undefined
    if (!row) fail(404, 'No credit request with that id.')
    if (row.status !== 'pending') fail(400, 'That request is already decided.')
    const status = approve ? 'approved' : 'rejected'
    db.prepare(`
      UPDATE credit_requests
      SET status = ?, decided_at = ?, decided_by = ?
      WHERE id = ?
    `).run(status, new Date().toISOString(), adminId, requestId)
    if (approve) {
      db.prepare('UPDATE users SET balance_units = balance_units + ? WHERE id = ?').run(row.amount_units, row.user_id)
      db.prepare(`
        INSERT INTO ledger (user_id, amount_units, kind, ref, note, created_at)
        VALUES (?, ?, 'credit', ?, 'Approved credit', ?)
      `).run(row.user_id, row.amount_units, String(requestId), new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return creditJson(requestId)
}

export async function gallery(query: { country?: string, area?: string, contains?: string }) {
  const country = (query.country || 'US').trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) fail(400, 'Use a two-letter country code.')
  return searchAvailableNumbers({ country, area: query.area?.trim() || '', contains: query.contains?.trim() || '' })
}

export function myNumbers(userId: number) {
  return db.prepare(`
    SELECT phone_number, region, upfront_cost, monthly_cost, currency, ordered_at
    FROM owned_numbers
    WHERE user_id = ?
    ORDER BY ordered_at DESC
  `).all(userId)
}

export async function buyNumber(user: AuthUser, phoneNumber: string, country: string) {
  const number = phoneNumber.trim()
  const code = country.trim().toUpperCase()
  if (!/^\+\d{8,15}$/.test(number)) fail(400, 'Choose a number from the gallery.')
  if (!/^[A-Z]{2}$/.test(code)) fail(400, 'Use a two-letter country code.')
  const owned = db.prepare('SELECT phone_number FROM owned_numbers WHERE phone_number = ?').get(number)
  if (owned) fail(400, 'That number is already on an account.')
  if (balanceOf(user.id) <= 0) fail(402, 'Your balance is $0.00. Request credit and wait for approval before buying a number.')
  const quote = await searchAvailableNumbers({ country: code, contains: number.replace(/\D/g, ''), limit: 10 })
  const match = quote.find((item) => item.phoneNumber === number)
  if (!match) fail(400, 'That number is no longer available.')
  const blocked = purchaseBlock(balanceOf(user.id), match.upfrontCost, match.monthlyCost)
  if (blocked) fail(blocked.status, blocked.message)
  const upfront = priceUnits(match.upfrontCost) ?? 0
  const monthly = priceUnits(match.monthlyCost) ?? 0
  const charge = upfront > 0 ? upfront : monthly
  await orderPhoneNumber(number)
  db.exec('BEGIN')
  try {
    const blockedAgain = purchaseBlock(balanceOf(user.id), match.upfrontCost, match.monthlyCost)
    if (blockedAgain) fail(blockedAgain.status, blockedAgain.message)
    db.prepare(`
      INSERT INTO owned_numbers (phone_number, user_id, region, upfront_cost, monthly_cost, currency, ordered_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(number, user.id, match.region || null, match.upfrontCost, match.monthlyCost, match.currency, new Date().toISOString())
    if (charge > 0) {
      db.prepare('UPDATE users SET balance_units = balance_units - ? WHERE id = ?').run(charge, user.id)
      db.prepare(`
        INSERT INTO ledger (user_id, amount_units, kind, ref, note, created_at)
        VALUES (?, ?, 'number', ?, 'Number purchase', ?)
      `).run(user.id, -charge, number, new Date().toISOString())
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
  return { phoneNumber: number, charged: fromUnits(charge) }
}

type CreditRow = {
  id: number
  user_id: number
  amount_units: number
  note: string | null
  status: string
  created_at: string
  decided_at: string | null
  email?: string
  name?: string
}

function creditJson(id: number) {
  const row = db.prepare(`
    SELECT r.*, u.email, u.name
    FROM credit_requests r
    JOIN users u ON u.id = r.user_id
    WHERE r.id = ?
  `).get(id) as CreditRow
  return creditView(row)
}

function creditView(row: CreditRow) {
  return {
    id: row.id,
    userId: row.user_id,
    email: row.email ?? null,
    name: row.name ?? null,
    amount: fromUnits(row.amount_units),
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    decidedAt: row.decided_at,
  }
}

function fail(statusCode: number, message: string): never {
  const error = new Error(message) as Error & { statusCode?: number }
  error.statusCode = statusCode
  throw error
}
