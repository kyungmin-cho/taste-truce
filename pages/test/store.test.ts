// Sessions and call budgets on D1 (node:sqlite stands in). Synthetic data only.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { BudgetError } from '../src/py.ts'
import { D1Store, LEASE, SCHEMA, type D1Statement } from '../src/store.ts'
import { warmed } from '../src/warm.ts'
import { dispatch, makeEnv, SqliteD1 } from './support.ts'

const store = (vars: Record<string, string> = {}) => new D1Store({ SESSION_SECRET: 's', ...vars }, new SqliteD1())

test('a session cookie is bound to the IP and to the secret', async () => {
  const s = store()
  const token = await s.issue('', '1.1.1.1')
  assert.ok(await s.check(token, '1.1.1.1'))
  assert.equal(await s.check(token, '2.2.2.2'), null)
  assert.equal(await new D1Store({ SESSION_SECRET: 'other' }, new SqliteD1()).check(token, '1.1.1.1'), null)
  assert.equal(await s.check(token + 'x', '1.1.1.1'), null)
  assert.equal(await s.issue(token, '1.1.1.1'), token)
  assert.notEqual(await s.issue(token, '2.2.2.2'), token)
})

test('an expired session is unknown', async () => {
  const s = store({ SESSION_TTL_SECONDS: '0' })
  assert.equal(await s.check(await s.issue('', '1.1.1.1'), '1.1.1.1'), null)
})

test('without a secret no session is issued or accepted', async () => {
  const s = new D1Store({}, new SqliteD1())
  await assert.rejects(s.issue('', '1.1.1.1'))
  assert.deepEqual(await s.acquire('a.b.c', '1.1.1.1'), [null, 'unknown'])
})

test('one plan at a time per session', async () => {
  const s = store()
  const token = await s.issue('', '1.1.1.1')
  const [session, error] = await s.acquire(token, '1.1.1.1')
  assert.equal(error, null)
  assert.equal((await s.acquire(token, '1.1.1.1'))[1], 'busy')
  await s.release(session!)
  assert.equal((await s.acquire(token, '1.1.1.1'))[1], null)
})

test('the per-IP daily session limit counts sessions, not plans', async () => {
  const s = store({ IP_DAILY_SESSION_CAP: '2' })
  const tokens = [await s.issue('', '1.1.1.1'), await s.issue('', '1.1.1.1'), await s.issue('', '1.1.1.1')]
  for (const token of tokens.slice(0, 2)) {
    for (let i = 0; i < 3; i++) {
      const [session, error] = await s.acquire(token, '1.1.1.1')
      assert.equal(error, null)
      await s.release(session!)
    }
  }
  assert.deepEqual(await s.acquire(tokens[2], '1.1.1.1'), [null, 'limit'])
  assert.equal((await s.acquire(await s.issue('', '3.3.3.3'), '3.3.3.3'))[1], null)
})

test('daily plan limits per IP and in total', async () => {
  const s = store({ IP_DAILY_PLAN_CAP: '2', DAILY_PLAN_CAP: '3' })
  const token = await s.issue('', '1.1.1.1')
  for (let i = 0; i < 2; i++) await s.release((await s.acquire(token, '1.1.1.1'))[0]!)
  assert.deepEqual(await s.acquire(token, '1.1.1.1'), [null, 'plans'])
  const other = await s.issue('', '2.2.2.2')
  await s.release((await s.acquire(other, '2.2.2.2'))[0]!)
  assert.deepEqual(await s.acquire(other, '2.2.2.2'), [null, 'plans'])
})

async function reserveUntil(s: D1Store, session: { id: string; ip: string }) {
  let n = 0
  try {
    for (;;) {
      await s.reserve(session)
      n++
    }
  } catch (err) {
    assert.ok(err instanceof BudgetError)
    return [n, (err as Error).message] as const
  }
}

test('call budgets: session, month, day and IP, with the Python messages', async () => {
  const open = async (s: D1Store, ip: string) => (await s.acquire(await s.issue('', ip), ip))[0]!
  let s = store({ SESSION_CALL_CAP: '3' })
  assert.deepEqual(await reserveUntil(s, await open(s, '1.1.1.1')), [3, 'Session call budget reached. Try the cached Williamsburg scene.'])
  assert.equal(await s.used(await open(s, '1.1.1.1')), 0)

  s = store({ MONTHLY_CALL_CAP: '1003' })
  assert.deepEqual(await reserveUntil(s, await open(s, '1.1.1.1')), [3, 'Monthly call budget reached. Cached scenes remain available.'])

  s = store({ DAILY_CALL_CAP: '2' })
  assert.deepEqual(await reserveUntil(s, await open(s, '1.1.1.1')), [2, 'Daily network call limit reached. Cached scenes remain available.'])

  s = store({ IP_DAILY_CALL_CAP: '2' })
  const first = await open(s, '1.1.1.1')
  assert.deepEqual(await reserveUntil(s, first), [2, 'Daily network call limit reached. Cached scenes remain available.'])
  // As in qloo.Qloo.reserve, a refused call does not count toward the session.
  assert.equal(await s.used(first), 2)
})

test('a refused call leaves the later counters alone', async () => {
  const s = store({ SESSION_CALL_CAP: '1', MONTHLY_RESERVED_CALLS: '0' })
  const session = (await s.acquire(await s.issue('', '1.1.1.1'), '1.1.1.1'))[0]!
  await s.reserve(session)
  await assert.rejects(s.reserve(session), BudgetError)
  await assert.rejects(s.reserve(session), BudgetError)
  const db = (s.db as SqliteD1).db
  assert.equal((db.prepare("SELECT used FROM counters WHERE key LIKE 'month:%'").get() as { used: number }).used, 1)
  assert.equal((db.prepare("SELECT used FROM ip_days WHERE kind='calls'").get() as { used: number }).used, 1)
})

// Runs a statement between every two statements of a batch that leaves changes() at 0 or at 1, as
// another connection or a different D1 implementation might. The limits must not notice.
class NoisyD1 extends SqliteD1 {
  noise: 0 | 1
  constructor(noise: 0 | 1) {
    super()
    this.noise = noise
    this.db.exec('CREATE TABLE noise (n INTEGER); INSERT INTO noise VALUES (0)')
  }
  async batch(statements: D1Statement[]) {
    const extra = this.prepare(this.noise ? 'UPDATE noise SET n=n+1' : 'UPDATE noise SET n=n WHERE 0')
    const out = await super.batch(statements.flatMap((s) => [extra, s]))
    return out.filter((_, i) => i % 2)
  }
}

function snapshot(s: D1Store) {
  const db = (s.db as SqliteD1).db
  return {
    sessions: db.prepare('SELECT id, calls FROM sessions ORDER BY id').all(),
    counters: db.prepare('SELECT key, used FROM counters ORDER BY key').all(),
    ip: db.prepare('SELECT kind, used FROM ip_days ORDER BY kind').all(),
    pace: db.prepare('SELECT next_at FROM pace').all(),
    grants: db.prepare('SELECT id FROM grants').all(),
  }
}

for (const noise of [null, 0, 1] as const) {
  const make = (vars: Record<string, string>) => new D1Store({ SESSION_SECRET: 's', ...vars }, noise === null ? new SqliteD1() : new NoisyD1(noise))
  test(`limits hold whatever changes() says (${noise === null ? 'plain' : 'changes() = ' + noise})`, async () => {
    const open = async (s: D1Store, ip: string) => (await s.acquire(await s.issue('', ip), ip))[0]!
    for (const [vars, n, message] of [
      [{ SESSION_CALL_CAP: '2' }, 2, 'Session call budget reached. Try the cached Williamsburg scene.'],
      [{ MONTHLY_CALL_CAP: '1002' }, 2, 'Monthly call budget reached. Cached scenes remain available.'],
      [{ DAILY_CALL_CAP: '2' }, 2, 'Daily network call limit reached. Cached scenes remain available.'],
      [{ IP_DAILY_CALL_CAP: '2' }, 2, 'Daily network call limit reached. Cached scenes remain available.'],
    ] as const) {
      const s = make(vars)
      const session = await open(s, '1.1.1.1')
      for (let i = 0; i < n; i++) await s.reserve(session)
      const before = snapshot(s)
      await assert.rejects(s.reserve(session), { message })
      // A refused call moves no counter, the pacing slot included, and leaves no grant behind.
      assert.deepEqual(snapshot(s), before)
      assert.deepEqual(before.grants, [])
      assert.equal(await s.used(session), n)
    }
    const s = make({ IP_DAILY_PLAN_CAP: '2', DAILY_PLAN_CAP: '3' })
    const token = await s.issue('', '1.1.1.1')
    for (let i = 0; i < 2; i++) await s.release((await s.acquire(token, '1.1.1.1'))[0]!)
    const before = snapshot(s)
    assert.deepEqual(await s.acquire(token, '1.1.1.1'), [null, 'plans'])
    assert.deepEqual(snapshot(s).counters, before.counters)
    const other = await s.issue('', '2.2.2.2')
    await s.release((await s.acquire(other, '2.2.2.2'))[0]!)
    assert.deepEqual(await s.acquire(other, '2.2.2.2'), [null, 'plans'])
  })
}

test('no budget statement relies on changes()', () => {
  const code = readFileSync(new URL('../src/store.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '')
  assert.doesNotMatch(code, /changes\(\)/)
})

test('a new monthly share applies within a month that has already started', async () => {
  const db = new SqliteD1()
  const open = async (s: D1Store, ip: string) => (await s.acquire(await s.issue('', ip), ip))[0]!
  // 8000 - 7995 = 5 calls for this installation this month.
  let s = new D1Store({ SESSION_SECRET: 's', MONTHLY_RESERVED_CALLS: '7995' }, db)
  const session = await open(s, '1.1.1.1')
  for (let i = 0; i < 3; i++) await s.reserve(session)
  // Lowered to 2 after the month row exists: refused at once, the counter stays at 3.
  s = new D1Store({ SESSION_SECRET: 's', MONTHLY_RESERVED_CALLS: '7998' }, db)
  await assert.rejects(s.reserve(session), { message: 'Monthly call budget reached. Cached scenes remain available.' })
  assert.equal((db.db.prepare("SELECT used FROM counters WHERE key LIKE 'month:%'").get() as { used: number }).used, 3)
  // Raised to 4: one more call.
  s = new D1Store({ SESSION_SECRET: 's', MONTHLY_RESERVED_CALLS: '7996' }, db)
  await s.reserve(session)
  await assert.rejects(s.reserve(session), BudgetError)
})

test('a lease is released and renewed only by the plan that holds it', async () => {
  const s = store()
  const token = await s.issue('', '1.1.1.1')
  const [first] = await s.acquire(token, '1.1.1.1')
  const [, error, retry] = await s.acquire(token, '1.1.1.1')
  assert.equal(error, 'busy')
  assert.ok(retry! >= 1 && retry! <= LEASE)
  // The first plan's lease runs out and a second plan takes the session.
  ;(s.db as SqliteD1).db.prepare('UPDATE sessions SET busy_until=0').run()
  const [second] = await s.acquire(token, '1.1.1.1')
  assert.ok(second)
  await s.release(first!)
  assert.equal(await s.renew(first!), false)
  assert.equal((await s.acquire(token, '1.1.1.1'))[1], 'busy')
  assert.equal(await s.renew(second!), true)
  await s.release(second!)
  assert.equal((await s.acquire(token, '1.1.1.1'))[1], null)
})

test('a failure after the lock is taken releases it', async () => {
  const db = new SqliteD1()
  const s = new D1Store({ SESSION_SECRET: 's' }, db)
  const token = await s.issue('', '1.1.1.1')
  await s.release((await s.acquire(token, '1.1.1.1'))[0]!)
  const batch = db.batch.bind(db)
  let calls = 0
  db.batch = async (statements) => (++calls === 2 ? Promise.reject(new Error('D1 unavailable')) : batch(statements))
  await assert.rejects(s.acquire(token, '1.1.1.1'), /D1 unavailable/)
  db.batch = batch
  assert.equal((await s.acquire(token, '1.1.1.1'))[1], null)
})

test('expired sessions are found through the index on at', async () => {
  const s = store()
  await s.acquire(await s.issue('', '1.1.1.1'), '1.1.1.1')
  const plan = (s.db as SqliteD1).db.prepare('EXPLAIN QUERY PLAN DELETE FROM sessions WHERE at<? AND busy_until<?').all(1, 1) as { detail: string }[]
  assert.match(plan.map((r) => r.detail).join(' '), /USING INDEX sessions_at/)
})

test('the startup warm-up runs every agent path it is meant to', async () => {
  assert.deepEqual(await warmed, ['done', 'done', 'done', 'clarification'])
})

test('calls are paced at least 0.32 s apart', async () => {
  const s = store()
  const session = (await s.acquire(await s.issue('', '1.1.1.1'), '1.1.1.1'))[0]!
  const start = performance.now()
  for (let i = 0; i < 4; i++) await s.reserve(session)
  assert.ok(performance.now() - start >= 900)
})

test('a running plan answers a second request in the same session with 409', async () => {
  const env = makeEnv({})
  const home = await dispatch(env, new Request('http://127.0.0.1/'))
  const cookie = home.headers.get('Set-Cookie')!.split(';')[0]
  const store = new D1Store(env, env.DB)
  const [session] = await store.acquire(cookie.split('=')[1], '127.0.0.1')
  const body = '{}'
  const response = await dispatch(env, new Request('http://127.0.0.1/api/plan', { method: 'POST', headers: { Cookie: cookie, 'Content-Length': '2' }, body }))
  assert.equal(response.status, 409)
  assert.deepEqual(await response.json(), { error: 'A plan is already running in this session' })
  const retry = Number(response.headers.get('Retry-After'))
  assert.ok(retry >= 1 && retry <= LEASE)
  await store.release(session!)
  assert.equal((await dispatch(env, new Request('http://127.0.0.1/api/plan', { method: 'POST', headers: { Cookie: cookie, 'Content-Length': '2' }, body }))).status, 200)
})

test('the cookie is Secure on https', async () => {
  const response = await dispatch(makeEnv({}), new Request('https://example.pages.dev/'))
  assert.match(response.headers.get('Set-Cookie')!, /HttpOnly; SameSite=Strict; Path=\/; Secure$/)
})

test('schema.sql, which the runbook runs before the first request, matches SCHEMA', () => {
  const sql = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8')
  const statements = sql.split('\n').filter((line) => !line.startsWith('--')).join('\n').split(';').map((s) => s.trim()).filter(Boolean)
  assert.deepEqual(statements, SCHEMA)
})
