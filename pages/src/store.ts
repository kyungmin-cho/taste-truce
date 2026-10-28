// Port of sessions.py and the budget half of qloo.py for Pages.
//
// Sessions are signed cookies bound to a hash of the visitor's IP, so opening a page writes nothing.
// Counters live in D1. Limits that move together are checked and counted in one batch (see grant),
// which D1 runs as one transaction, so they stay correct across isolates.
import { BudgetError, sha256 } from './py.ts'

// lease: the token of the plan holding the session's lock, so only that plan can extend or release it.
export type Session = { id: string; ip: string; lease?: string }

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

// counters: 'month:YYYY-MM' (Qloo calls this installation made that month), 'calls:YYYY-MM-DD' and
// 'plans:YYYY-MM-DD' (UTC days). grants: a row lives only inside the batch that checks every limit at once.
export const SCHEMA = [
  'CREATE TABLE IF NOT EXISTS counters (key TEXT PRIMARY KEY, used INTEGER NOT NULL)',
  'CREATE TABLE IF NOT EXISTS ip_days (day TEXT, ip TEXT, kind TEXT, used INTEGER, PRIMARY KEY(day,ip,kind))',
  "CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, at REAL NOT NULL, counted INTEGER NOT NULL DEFAULT 0, calls INTEGER NOT NULL DEFAULT 0, busy_until REAL NOT NULL DEFAULT 0, lease TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS sessions_at ON sessions (at)',
  'CREATE TABLE IF NOT EXISTS pace (id INTEGER PRIMARY KEY, next_at REAL NOT NULL)',
  'CREATE TABLE IF NOT EXISTS grants (id TEXT PRIMARY KEY)',
]

// A plan holds its session's lock for LEASE seconds and renews it every HEARTBEAT seconds while it runs,
// so a plan the runtime stops (for example over the CPU limit) leaves the session locked for LEASE at most.
export const LEASE = 30
export const HEARTBEAT = 10

const num = (value: unknown, fallback: number) => (value === undefined || value === null || value === '' ? fallback : Number(value))
const now = () => Date.now() / 1000
const day = () => new Date().toISOString().slice(0, 10)
const month = () => new Date().toISOString().slice(0, 7)
const randomId = () => b64(crypto.getRandomValues(new Uint8Array(18)))
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
    const id = randomId()
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

  // Several counters that move together or not at all. One INSERT tests every limit against the same
  // state and writes a grant row; each UPDATE (written with a trailing "AND <granted>") runs only if
  // that row exists, and the last statement deletes it, returning a row only when the grant was made.
  // No statement depends on changes() or on what the statement before it did.
  private grant(limits: string, values: unknown[], updates: [string, unknown[]][]): D1Statement[] {
    const id = randomId()
    const granted = 'EXISTS (SELECT 1 FROM grants WHERE id=?)'
    return [
      this.db.prepare(`INSERT INTO grants (id) SELECT ? WHERE ${limits}`).bind(id, ...values),
      ...updates.map(([sql, args]) => this.db.prepare(sql.replace('<granted>', granted)).bind(...args, id)),
      this.db.prepare('DELETE FROM grants WHERE id=? RETURNING id').bind(id),
    ]
  }

  // One running plan per session; the first plan of a session counts toward the per-IP daily limit.
  // 'busy' comes with the seconds until the running plan's lease ends.
  async acquire(cookie: string, ip: string): Promise<[Session | null, 'unknown' | 'limit' | 'busy' | 'plans' | null, number?]> {
    const checked = await this.check(cookie, ip)
    if (!checked) return [null, 'unknown']
    const t = now()
    const session: Session = { ...checked, lease: randomId() }
    const [, , locked, row] = await this.batch([
      this.db.prepare('DELETE FROM sessions WHERE at<? AND busy_until<?').bind(t - this.ttl, t),
      this.db.prepare('INSERT OR IGNORE INTO sessions (id, at) VALUES (?, ?)').bind(session.id, t),
      this.db.prepare('UPDATE sessions SET busy_until=?, lease=? WHERE id=? AND busy_until<? RETURNING counted').bind(t + LEASE, session.lease, session.id, t),
      this.db.prepare('SELECT busy_until FROM sessions WHERE id=?').bind(session.id),
    ])
    if (!locked.length) return [null, 'busy', Math.max(1, Math.ceil((row[0] as { busy_until: number }).busy_until - t))]
    try {
      const digest = await sha256(ip)
      if (!(locked[0] as { counted: number }).counted) {
        const [, , counted] = await this.batch(this.daily('sessions', digest, num(this.env.IP_DAILY_SESSION_CAP, 20)))
        if (!counted.length) {
          await this.release(session)
          return [null, 'limit']
        }
        await this.db.prepare('UPDATE sessions SET counted=1 WHERE id=?').bind(session.id).run()
      }
      // Added for Pages: plans served from the cache still read KV, which has a daily quota.
      const key = 'plans:' + day()
      const ipPlans = 'SELECT used FROM ip_days WHERE day=? AND ip=? AND kind=?'
      const results = await this.batch([
        this.db.prepare('INSERT OR IGNORE INTO counters VALUES (?, 0)').bind(key),
        this.db.prepare('DELETE FROM ip_days WHERE day<?').bind(day()),
        this.db.prepare('INSERT OR IGNORE INTO ip_days VALUES (?,?,?,0)').bind(day(), digest, 'plans'),
        ...this.grant(`(${ipPlans}) < ? AND (SELECT used FROM counters WHERE key=?) < ?`, [day(), digest, 'plans', num(this.env.IP_DAILY_PLAN_CAP, 200), key, num(this.env.DAILY_PLAN_CAP, 600)], [
          ['UPDATE ip_days SET used=used+1 WHERE day=? AND ip=? AND kind=? AND <granted>', [day(), digest, 'plans']],
          ['UPDATE counters SET used=used+1 WHERE key=? AND <granted>', [key]],
        ]),
      ])
      if (!results.at(-1)!.length) {
        await this.release(session)
        return [null, 'plans']
      }
      return [session, null]
    } catch (err) {
      await this.release(session).catch(() => {})
      throw err
    }
  }

  // Keeps the lock while the plan runs; false once another plan holds it (this lease ran out).
  async renew(session: Session): Promise<boolean> {
    const row = await this.db.prepare('UPDATE sessions SET busy_until=? WHERE id=? AND lease=? RETURNING id').bind(now() + LEASE, session.id, session.lease).first()
    return row !== null
  }

  // Unlocks only the plan's own lease: a plan that outlived its lease never unlocks a later one.
  async release(session: Session) {
    await this.db.prepare("UPDATE sessions SET busy_until=0, lease='' WHERE id=? AND lease=?").bind(session.id, session.lease).run()
  }

  // Reserve before sending; failures count. Same limits and messages as qloo.Qloo.reserve, in one batch.
  // The monthly limit is MONTHLY_CALL_CAP less MONTHLY_RESERVED_CALLS, read on every call, so a change to
  // either applies at once, also within a month that has already started. The counter holds this
  // installation's own calls only.
  async reserve(session: Session) {
    const monthKey = 'month:' + month()
    const dayKey = 'calls:' + day()
    const digest = await sha256(session.ip)
    const monthlyCap = Math.min(8000, Math.max(0, num(this.env.MONTHLY_CALL_CAP, 8000)))
    // Left for calls made with the same key elsewhere (another server, scripts).
    const reserved = Math.max(0, num(this.env.MONTHLY_RESERVED_CALLS, 1000))
    const caps = { session: num(this.env.SESSION_CALL_CAP, 30), month: monthlyCap - reserved, day: num(this.env.DAILY_CALL_CAP, 500), ip: num(this.env.IP_DAILY_CALL_CAP, 100) }
    const used = {
      session: '(SELECT calls FROM sessions WHERE id=?)',
      month: '(SELECT used FROM counters WHERE key=?)',
      day: '(SELECT used FROM counters WHERE key=?)',
      ip: "(SELECT used FROM ip_days WHERE day=? AND ip=? AND kind='calls')",
    }
    const args = { session: [session.id], month: [monthKey], day: [dayKey], ip: [day(), digest] }
    const results = await this.batch([
      this.db.prepare('INSERT OR IGNORE INTO counters VALUES (?, 0)').bind(monthKey),
      this.db.prepare('INSERT OR IGNORE INTO counters VALUES (?, 0)').bind(dayKey),
      this.db.prepare('DELETE FROM ip_days WHERE day<?').bind(day()),
      this.db.prepare('INSERT OR IGNORE INTO ip_days VALUES (?,?,?,0)').bind(day(), digest, 'calls'),
      this.db.prepare('INSERT OR IGNORE INTO pace VALUES (1, 0)').bind(),
      // The counters before this call, to name the limit that refused it.
      this.db.prepare(`SELECT ${used.session} AS session, ${used.month} AS month, ${used.day} AS day, ${used.ip} AS ip`).bind(...args.session, ...args.month, ...args.day, ...args.ip),
      ...this.grant(`${used.session} < ? AND ${used.month} < ? AND ${used.day} < ? AND ${used.ip} < ?`,
        [...args.session, caps.session, ...args.month, caps.month, ...args.day, caps.day, ...args.ip, caps.ip], [
          ['UPDATE sessions SET calls=calls+1 WHERE id=? AND <granted>', [session.id]],
          ['UPDATE counters SET used=used+1 WHERE key IN (?, ?) AND <granted>', [monthKey, dayKey]],
          ["UPDATE ip_days SET used=used+1 WHERE day=? AND ip=? AND kind='calls' AND <granted>", [day(), digest]],
          // Qloo allows five requests a second; slots 0.32 s apart keep any 1.25 s window at four.
          ['UPDATE pace SET next_at=MAX(next_at, ?)+0.32 WHERE id=1 AND <granted> RETURNING next_at', [now()]],
        ]),
    ])
    const before = results[5][0] as { session: number | null; month: number; day: number; ip: number }
    if (!results.at(-1)!.length) {
      if (!(before.session !== null && before.session < caps.session)) throw new BudgetError('Session call budget reached. Try the cached Williamsburg scene.')
      if (!(before.month < caps.month)) throw new BudgetError('Monthly call budget reached. Cached scenes remain available.')
      throw new BudgetError('Daily network call limit reached. Cached scenes remain available.')
    }
    const wait = (results.at(-2)![0] as { next_at: number }).next_at - 0.32 - now()
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait * 1000))
  }

  async used(session: Session): Promise<number> {
    const row = await this.db.prepare('SELECT calls FROM sessions WHERE id=?').bind(session.id).first<{ calls: number }>()
    return row ? row.calls : 0
  }
}
