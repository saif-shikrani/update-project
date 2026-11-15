import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'
import { db } from './db.ts'

export type AuthUser = {
  id: number
  email: string
  name: string
  role: 'admin' | 'user'
  balanceUnits: number
}

type UserRow = {
  id: number
  email: string
  name: string
  password_hash: string
  role: string
  balance_units: number
}

const COOKIE = 'desk_session'

export function publicUser(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    balanceUnits: user.balanceUnits,
  }
}

export function signup(input: { email: string, name: string, password: string }) {
  const email = input.email.trim().toLowerCase()
  const name = input.name.trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Enter a valid email.')
  if (name.length < 2) fail(400, 'Enter your name.')
  if (input.password.length < 8) fail(400, 'Use a password of at least 8 characters.')
  const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email)
  if (existing) fail(400, 'An account with that email already exists.')
  const count = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number }
  const role = count.count === 0 ? 'admin' : 'user'
  const result = db.prepare(`
    INSERT INTO users (email, name, password_hash, role, balance_units, created_at)
    VALUES (?, ?, ?, ?, 0, ?)
  `).run(email, name, hashPassword(input.password), role, new Date().toISOString())
  return sessionFor(Number(result.lastInsertRowid))
}

export function login(email: string, password: string) {
  const row = db.prepare('SELECT * FROM users WHERE email = ?').get(email.trim().toLowerCase()) as UserRow | undefined
  if (!row || !verifyPassword(password, row.password_hash)) fail(401, 'Email or password is wrong.')
  return sessionFor(row.id)
}

export function logout(token: string) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token)
}

export function userFromToken(token: string): AuthUser | null {
  if (!token) return null
  const row = db.prepare(`
    SELECT u.* FROM sessions s
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `).get(token) as UserRow | undefined
  return row ? toUser(row) : null
}

export function readSession(cookieHeader: string | undefined) {
  if (!cookieHeader) return ''
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === COOKIE) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export function sessionCookie(token: string, maxAge = 60 * 60 * 24 * 30) {
  return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`
}

function sessionFor(userId: number) {
  const token = randomBytes(32).toString('hex')
  db.prepare('INSERT INTO sessions (token, user_id, created_at) VALUES (?, ?, ?)').run(token, userId, new Date().toISOString())
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(userId) as UserRow
  return { token, user: toUser(row) }
}

function toUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role === 'admin' ? 'admin' : 'user',
    balanceUnits: row.balance_units,
  }
}

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `${salt}:${hash}`
}

function verifyPassword(password: string, stored: string) {
  const [salt, hash] = stored.split(':')
  if (!salt || !hash) return false
  const next = scryptSync(password, salt, 32)
  const current = Buffer.from(hash, 'hex')
  return current.length === next.length && timingSafeEqual(current, next)
}

function fail(statusCode: number, message: string): never {
  const error = new Error(message) as Error & { statusCode?: number }
  error.statusCode = statusCode
  throw error
}
