// Port of sessions.py and the budget half of qloo.py for Pages.
//
// Sessions are signed cookies bound to a hash of the visitor's IP, so opening a page writes nothing.
// Counters live in D1: each limit is one conditional UPDATE, which stays correct across isolates.
import { BudgetError, sha256 } from './py.ts'

export type Session = { id: string; ip: string }

export interface Store {
  reserve(session: Session): Promise<void>
  used(session: Session): Promise<number>
}

// The subset of the D1 binding this file uses. A batch runs its statements in order, in one transaction.
export interface D1 {
  prepare(sql: string): D1Statement
  batch(statements: D1Statement[]): Promise<{ results?: unknown[] }[]>
}
export interface D1Statement {
  bind(...values: unknown[]): D1Statement
  first<T = Record<string, unknown>>(): Promise<T | null>
  run(): Promise<unknown>
}

export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS months (month TEXT PRIMARY KEY, used INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS days (day TEXT PRIMARY KEY, used INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS ip_days (day TEXT, ip TEXT, kind TEXT, used INTEGER, PRIMARY KEY(day,ip,kind))',
  'CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, at REAL NOT NULL, counted INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, busy_until REAL NOT NULL DEFAULT 0)',
  'CREATE TABLE IF NOT EXISTS pace (id INTEGER PRIMARY KEY, next_at REAL NOT NULL)',
]

const num = (value: unknown, fallback: number) => (value === undefined || value === null || value === '' ? fallback : Number(value))
const now = () => Date.now() / 1000
const day = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

async function hmac(secret: string, text: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return b64(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))))
}

export function cookieToken(header: string | null): string {
  for (const part of (header || '').split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === 'taste_session') return rest.join('=')
  }
  return ''
}

// The tables exist after the first batch an isolate sends; later batches skip the schema.
const ready = new WeakSet<object>()

export class D1Store implements Store {
  db: D1
  env: Record<string, any>
  secret: string
  ttl: number

  constructor(env: Record<string, any>, db: D1) {
    this.env = env
    this.db = db
    this.secret = env.SESSION_SECRET || ''
    this.ttl = num(env.SESSION_TTL_SECONDS, 86400)
  }

  private async batch(statements: D1Statement[]): Promise<unknown[][]> {
    const schema = ready.has(this.db) ? [] : SCHEMA.map((sql) => this.db.prepare(sql))
    const out = await this.db.batch([...schema, ...statements])
    ready.add(this.db)
    return out.slice(schema.length).map((r) => r.results ?? [])
  }

  // A token is <id>.<issued>.<mac>; the MAC covers the IP hash, so a copied cookie fails elsewhere.
  async issue(token: string, ip: string): Promise<string> {
    if (!this.secret) throw new Error('SESSION_SECRET is not set')
    if (await this.check(token, ip)) return token
    const id = b64(crypto.getRandomValues(new Uint8Array(18)))
    const issued = Math.floor(now()).toString(36)
    return `${id}.${issued}.${await hmac(this.secret, `${id}.${issued}.${await sha256(ip)}`)}`
  }

  async check(token: string, ip: string): Promise<Session | null> {
    const [id, issued, mac, extra] = (token || '').split('.')
    if (!this.secret || !id || !issued || !mac || extra !== undefined) return null
    if (!(now() - parseInt(issued, 36) < this.ttl)) return null
    return mac === (await hmac(this.secret, `${id}.${issued}.${await sha256(ip)}`)) ? { id, ip } : null
  }

  private daily(kind: string, digest: string, cap: number) {
    return [
      this.db.prepare('DELETE FROM ip_days WHERE day<?').bind(day()),
      this.db.prepare('INSERT OR IGNORE INTO ip_days VALUES (?,?,?,0)').bind(day(), digest, kind),
      this.db.prepare('UPDATE ip_days SET used=used+1 WHERE day=? AND ip=? AND kind=? AND used<? RETURNING used').bind(day(), digest, kind, cap),
    ]
  }

  // One running plan per session; the first plan of a session counts toward the per-IP daily limit.
  async acquire(token: string, ip: string): Promise<[Session | null, 'unknown' | 'limit' | 'busy' | 'plans' | null]> {
    const session = await this.check(token, ip)
    if (!session) return [null, 'unknown']
    const t = now()
    const [, , busy] = await this.batch([
      this.db.prepare('DELETE FROM sessions WHERE at<? AND busy_until<?').bind(t - this.ttl, t),
      this.db.prepare('INSERT OR IGNORE INTO sessions (id, at) VALUES (?, ?)').bind(session.id, t),
      this.db.prepare('UPDATE sessions SET busy_until=? WHERE id=? AND busy_until<? RETURNING counted').bind(t + 120, session.id, t),
    ])
    if (!busy.length) return [null, 'busy']
    const digest = await sha256(ip)
    if (!(busy[0] as { counted: number }).counted) {
      const [, , counted] = await this.batch(this.daily('sessions', digest, num(this.env.IP_DAILY_SESSION_CAP, 20)))
      if (!counted.length) {
        await this.release(session)
        return [null, 'limit']
      }
      await this.db.prepare('UPDATE sessions SET counted=1 WHERE id=?').bind(session.id).run()
    }
    // Added for Pages: plans served from the cache still read KV, which has a daily quota.
    const key = 'plans:' + day()
    const [, , , mine, all] = await this.batch([
      this.db.prepare('INSERT OR IGNORE INTO days VALUES (?, 0)').bind(key),
      ...this.daily('plans', digest, num(this.env.IP_DAILY_PLAN_CAP, 200)),
      this.db.prepare('UPDATE days SET used=used+1 WHERE day=? AND used<? AND changes()=1 RETURNING used').bind(key, num(this.env.DAILY_PLAN_CAP, 600)),
    ])
    if (!mine.length || !all.length) {
      await this.release(session)
      return [null, 'plans']
    }
    return [session, null]
  }

  async release(session: Session) {
    await this.db.prepare('UPDATE sessions SET busy_until=0 WHERE id=?').bind(session.id).run()
  }

  // Reserve before sending; failures count. Same limits and messages as qloo.Qloo.reserve, in one batch:
  // each counter moves only when the one before it did, so the first empty result names the limit.
  async reserve(session: Session) {
    const month0 = month()
    const today = 'calls:' + day()
    const digest = await sha256(session.ip)
    const monthlyCap = Math.min(8000, Math.max(0, num(this.env.MONTHLY_CALL_CAP, 8000)))
    // Leave headroom for calls made outside this installation before accounting began.
    const reserved = Math.max(0, num(this.env.MONTHLY_RESERVED_CALLS, 1000))
    const results = await this.batch([
      this.db.prepare('INSERT OR IGNORE INTO months VALUES (?, ?)').bind(month0, reserved),
      this.db.prepare('INSERT OR IGNORE INTO days VALUES (?, 0)').bind(today),
      this.db.prepare('DELETE FROM ip_days WHERE day<?').bind(day()),
      this.db.prepare('INSERT OR IGNORE INTO ip_days VALUES (?,?,?,0)').bind(day(), digest, 'calls'),
      this.db.prepare('INSERT OR IGNORE INTO pace VALUES (1, 0)').bind(),
      this.db.prepare('UPDATE sessions SET calls=calls+1 WHERE id=? AND calls<? RETURNING calls').bind(session.id, num(this.env.SESSION_CALL_CAP, 30)),
      this.db.prepare('UPDATE months SET used=used+1 WHERE month=? AND used<? AND changes()=1 RETURNING used').bind(month0, monthlyCap),
      // Added for Pages: every new response is one KV write, and KV allows 1,000 writes a day.
      this.db.prepare('UPDATE days SET used=used+1 WHERE day=? AND used<? AND changes()=1 RETURNING used').bind(today, num(this.env.DAILY_CALL_CAP, 500)),
      this.db.prepare('UPDATE ip_days SET used=used+1 WHERE day=? AND ip=? AND kind=? AND used<? AND changes()=1 RETURNING used').bind(day(), digest, 'calls', num(this.env.IP_DAILY_CALL_CAP, 100)),
      // Qloo allows five requests a second; slots 0.32 s apart keep any 1.25 s window at four.
      this.db.prepare('UPDATE pace SET next_at=MAX(next_at, ?)+0.32 WHERE id=1 AND changes()=1 RETURNING next_at').bind(now()),
    ])
    const [sessionOk, monthOk, dayOk, ipOk, slot] = results.slice(5)
    if (!sessionOk.length) throw new BudgetError('Session call budget reached. Try the cached Williamsburg scene.')
    if (!monthOk.length) throw new BudgetError('Monthly call budget reached. Cached scenes remain available.')
    if (!dayOk.length || !ipOk.length) throw new BudgetError('Daily network call limit reached. Cached scenes remain available.')
    const wait = (slot[0] as { next_at: number }).next_at - 0.32 - now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait * 1000))
  }

  async used(session: Session): Promise<number> {
    const row = await this.db.prepare('SELECT calls FROM sessions WHERE id=?').bind(session.id).first<{ calls: number }>()
    return row ? row.calls : 0
  }
}
