// Node stand-ins for the Pages runtime: KV in memory, D1 on node:sqlite, and the file-based routes.
import { DatabaseSync } from 'node:sqlite'
import { config, health, page, plan, scene, type Env } from '../src/http.ts'
import type { KV } from '../src/qloo.ts'
import type { D1, D1Statement } from '../src/store.ts'

export class MemoryKV implements KV {
  data = new Map<string, string>()
  reads = 0
  writes = 0
  operations = 0
  constructor(entries: { key: string; value: string }[] = []) {
    for (const e of entries) this.data.set(e.key, e.value)
  }
  get(key: string, type: 'text'): Promise<string | null>
  get(keys: string[], type: 'text'): Promise<Map<string, string | null>>
  async get(key: string | string[]): Promise<any> {
    this.operations++
    if (!Array.isArray(key)) {
      this.reads++
      return this.data.get(key) ?? null
    }
    if (key.length > 100) throw new Error('KV bulk get takes at most 100 keys')
    this.reads += key.length
    return new Map(key.map((k) => [k, this.data.get(k) ?? null]))
  }
  async put(key: string, value: string) {
    this.operations++
    this.writes++
    this.data.set(key, value)
  }
}

class Statement implements D1Statement {
  db: DatabaseSync
  sql: string
  values: unknown[] = []
  constructor(db: DatabaseSync, sql: string) {
    this.db = db
    this.sql = sql
  }
  bind(...values: unknown[]) {
    const s = new Statement(this.db, this.sql)
    s.values = values
    return s
  }
  async first<T>() {
    return (this.db.prepare(this.sql).get(...(this.values as any[])) ?? null) as T | null
  }
  async run() {
    return this.db.prepare(this.sql).run(...(this.values as any[]))
  }
}

export class SqliteD1 implements D1 {
  db = new DatabaseSync(':memory:')
  prepare(sql: string) {
    return new Statement(this.db, sql)
  }
  async batch(statements: D1Statement[]) {
    this.db.exec('BEGIN')
    try {
      const out = (statements as Statement[]).map((s) => ({ results: this.db.prepare(s.sql).all(...(s.values as any[])) }))
      this.db.exec('COMMIT')
      return out
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}

export function makeEnv(vars: Record<string, string>, entries: { key: string; value: string }[] = []): Env {
  return { SESSION_SECRET: 'test-secret', DEFAULT_SCENE: 'majority', ...vars, CACHE: new MemoryKV(entries), DB: new SqliteD1() }
}

// Routes as Pages maps functions/; / and /classic get a stand-in page from the asset server.
export async function dispatch(env: Env, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname
  const pending: Promise<unknown>[] = []
  const asset = async () => new Response('<!doctype html><title>page</title>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  let response: Response
  if (request.method === 'POST' && path === '/api/plan') response = await plan(request, env, (p) => pending.push(p))
  else if (request.method !== 'GET') response = new Response('{"error": "Not found"}', { status: 404 })
  else if (path === '/' || path === '/classic') response = await page(request, env, asset)
  else if (path === '/api/config') response = config(env)
  else if (path === '/health') response = await health(env)
  else if (path.startsWith('/scene/') && path.split('/').length === 3) response = await scene(env, path.split('/')[2])
  else response = new Response('{"error": "Not found"}', { status: 404, headers: { 'Content-Type': 'application/json' } })
  const text = await response.text()
  await Promise.all(pending)
  return new Response(text, { status: response.status, headers: response.headers })
}
