// Sessions and call budgets on D1 (node:sqlite stands in). Synthetic data only.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { BudgetError } from '../src/py.ts'
import { D1Store } from '../src/store.ts'
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
  assert.deepEqual(await s.acquire(token, '1.1.1.1'), [null, 'busy'])
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
  assert.equal(await s.used(first), 3)
})

test('a refused call leaves the later counters alone', async () => {
  const s = store({ SESSION_CALL_CAP: '1', MONTHLY_RESERVED_CALLS: '0' })
  const session = (await s.acquire(await s.issue('', '1.1.1.1'), '1.1.1.1'))[0]!
  await s.reserve(session)
  await assert.rejects(s.reserve(session), BudgetError)
  await assert.rejects(s.reserve(session), BudgetError)
  const db = (s.db as SqliteD1).db
  assert.equal((db.prepare('SELECT used FROM months').get() as { used: number }).used, 1)
  assert.equal((db.prepare("SELECT used FROM ip_days WHERE kind='calls'").get() as { used: number }).used, 1)
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
  await store.release(session!)
  assert.equal((await dispatch(env, new Request('http://127.0.0.1/api/plan', { method: 'POST', headers: { Cookie: cookie, 'Content-Length': '2' }, body }))).status, 200)
})

test('the cookie is Secure on https', async () => {
  const response = await dispatch(makeEnv({}), new Request('https://example.pages.dev/'))
  assert.match(response.headers.get('Set-Cookie')!, /HttpOnly; SameSite=Strict; Path=\/; Secure$/)
})
