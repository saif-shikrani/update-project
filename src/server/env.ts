import { readFileSync, existsSync } from 'node:fs'

export function loadEnv() {
  if (!existsSync('.env')) return
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const index = trimmed.indexOf('=')
    if (index === -1) continue
    const key = trimmed.slice(0, index).trim()
    let value = trimmed.slice(index + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = value
  }
}

export function required(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) {
    const error = new Error(`Add ${name} to .env and restart.`) as Error & { statusCode?: number }
    error.statusCode = 400
    throw error
  }
  return value
}
