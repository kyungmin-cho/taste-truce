// CPU time of each dynamic route on a seeded cache, the number the Workers Free plan limits (10 ms).
// Usage: node test/bench.ts <seed bulk file> [runs]
//   cold: each flow is the first request of a fresh node process (a new isolate), run <runs> times
//   app-cold: the same, after node's own JavaScript for Request, streams and WebCrypto has run once
//   warm: the same process, after one request of every flow, <runs> times each
// The number is the main thread's CPU time minus the time inside node:sqlite, which stands in for D1.
// It is a node measurement, not a Cloudflare one: read the Pages metrics after a deploy (RUNBOOK).
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { SqliteD1, dispatch, makeEnv, sqliteCpu } from './support.ts'

const PEOPLE = [
  { name: 'Indie + jazz', seeds: [{ query: 'Moonrise Kingdom', type: 'movie' }, { query: 'Miles Davis', type: 'artist' }] },
  { name: 'K-pop + streetwear', seeds: [{ query: 'BTS', type: 'artist' }, { query: 'Supreme', type: 'brand' }] },
  { name: 'Pop + athleisure', seeds: [{ query: 'Taylor Swift', type: 'artist' }, { query: 'Lululemon', type: 'brand' }] },
]
const HIPHOP = { name: 'Hip-hop + sneakers', seeds: [{ query: 'Kendrick Lamar', type: 'artist' }, { query: 'Nike', type: 'brand' }] }
const body = (extra: object) => JSON.stringify({ people: PEOPLE, choices: {}, start_radius: 2000, area: 'Williamsburg NYC', occasion: 'Dinner', veto: { excluded: [] }, veto_text: '', ...extra })
const FLOWS: [string, string, string | null][] = [
  ['GET /scene/default', '/scene/default', null],
  ['GET /api/config', '/api/config', null],
  ['plan: default scene', '/api/plan', body({})],
  ['plan: no bars please', '/api/plan', body({ veto_text: 'no bars please' })],
  ['plan: replace friend 2', '/api/plan', body({ people: [PEOPLE[0], HIPHOP, PEOPLE[2]] })],
  ["plan: add Joe's Pizza (question)", '/api/plan', body({ people: [...PEOPLE, { name: 'Friend 4', seeds: [{ query: "Joe's Pizza", type: 'place' }] }] })],
  ['plan: cheaper', '/api/plan', body({ veto_text: 'a cheaper option' })],
  ['plan: not that place', '/api/plan', body({ veto_text: 'not that place please', current_pick: '' })],
]
const cpu = () => { const u = process.threadCpuUsage?.() ?? process.cpuUsage(); return (u.user + u.system) / 1000 - sqliteCpu.ms }

async function measure(env: ReturnType<typeof makeEnv>, cookie: string, [, path, data]: [string, string, string | null]) {
  const headers: Record<string, string> = { Cookie: cookie }
  if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) })
  const start = cpu()
  const response = await dispatch(env, new Request('http://127.0.0.1' + path, { method: data ? 'POST' : 'GET', headers, body: data }))
  const text = await response.text()
  const used = cpu() - start
  const last = data ? JSON.parse(text.trim().split('\n').pop()!) : null
  const what = last ? (last.event === 'result' ? `${last.result.status} ${last.result.pool_size ?? ''}`.trim() : last.event) : String(response.status)
  return { used, bytes: text.length, what }
}

async function setup(bulk: string) {
  const env = makeEnv({ QLOO_BASE_URL: 'http://127.0.0.1:9' }, JSON.parse(readFileSync(bulk, 'utf8')))
  const home = await dispatch(env, new Request('http://127.0.0.1/'))
  return { env, cookie: home.headers.get('Set-Cookie')!.split(';')[0] }
}

const [bulk, arg] = process.argv.slice(2)
// Node implements Request, streams, WebCrypto and the D1 stand-in in JavaScript that compiles on first use;
// workerd implements them natively. --platform-warm runs them once on unrelated data first, so the
// cold number left is this app's own code running for the first time.
async function warmPlatform() {
  const db = new SqliteD1()
  await db.batch([db.prepare('CREATE TABLE w (k TEXT PRIMARY KEY, n INTEGER)'), db.prepare('INSERT OR IGNORE INTO w VALUES (?, 0)').bind('a'), db.prepare('UPDATE w SET n=n+1 WHERE k=? AND n<? RETURNING n').bind('a', 9)])
  await db.prepare('SELECT n FROM w WHERE k=?').bind('a').first()
  await db.prepare('UPDATE w SET n=0 WHERE k=?').bind('a').run()
  for (let i = 0; i < 3; i++) {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode('k' + i), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
    await Promise.all([crypto.subtle.sign('HMAC', key, new TextEncoder().encode('x')), ...Array.from({ length: 20 }, (_, j) => crypto.subtle.digest('SHA-256', new TextEncoder().encode('x' + j)))])
  }
  const request = new Request('http://w/x', { method: 'POST', headers: { Cookie: 'a=b', 'Content-Length': '2' }, body: '{}' })
  new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await request.arrayBuffer())
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const response = new Response(stream.readable, { headers: new Headers({ 'Content-Type': 'text/plain' }) })
  writer.write(new TextEncoder().encode('x\n'))
  writer.close()
  await response.text()
  new URL('http://w/x').host
}

if (arg?.startsWith('--one=')) {
  // Child: the first request this process makes.
  if (process.argv[4] === '--platform-warm') await warmPlatform()
  const { env, cookie } = await setup(bulk)
  process.stdout.write(JSON.stringify(await measure(env, cookie, FLOWS[Number(arg.slice(6))])))
} else {
  const runs = Number(arg || 10)
  const stats = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return `${s[Math.floor((s.length - 1) / 2)].toFixed(1)}\t${s[Math.ceil(s.length * 0.9) - 1].toFixed(1)}` }
  console.log('flow\tresult\tKB\tcold median\tcold p90\tapp-cold median\tapp-cold p90\twarm median\twarm p90')
  const { env, cookie } = await setup(bulk)
  for (const flow of FLOWS) await measure(env, cookie, flow)
  for (const [i, flow] of FLOWS.entries()) {
    const child = (...extra: string[]) => JSON.parse(execFileSync(process.execPath, [fileURLToPath(import.meta.url), bulk, `--one=${i}`, ...extra], { encoding: 'utf8' }))
    const cold = Array.from({ length: runs }, () => child())
    const appCold = Array.from({ length: runs }, () => child('--platform-warm'))
    const warm = []
    for (let r = 0; r < runs * 2; r++) warm.push(await measure(env, cookie, flow))
    console.log(`${flow[0]}\t${cold[0].what}\t${(cold[0].bytes / 1000).toFixed(0)}\t${stats(cold.map((c) => c.used))}\t${stats(appCold.map((c) => c.used))}\t${stats(warm.map((w) => w.used))}`)
  }
}
