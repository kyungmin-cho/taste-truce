// CPU time of each dynamic route on a seeded cache, the number the Workers Free plan limits (10 ms).
// Usage: node test/bench.ts <seed bulk file>. Prints per-flow CPU ms for a cold and a warm isolate.
import { readFileSync } from 'node:fs'
import { dispatch, makeEnv } from './support.ts'

const entries = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const PEOPLE = [
  { name: 'Indie + jazz', seeds: [{ query: 'Moonrise Kingdom', type: 'movie' }, { query: 'Miles Davis', type: 'artist' }] },
  { name: 'K-pop + streetwear', seeds: [{ query: 'BTS', type: 'artist' }, { query: 'Supreme', type: 'brand' }] },
  { name: 'Pop + athleisure', seeds: [{ query: 'Taylor Swift', type: 'artist' }, { query: 'Lululemon', type: 'brand' }] },
]
const body = (extra: object) => JSON.stringify({ people: PEOPLE, choices: {}, start_radius: 2000, area: 'Williamsburg NYC', occasion: 'Dinner', veto: { excluded: [] }, veto_text: '', ...extra })
const flows: [string, string, string | null][] = [
  ['GET /scene/default', '/scene/default', null],
  ['GET /api/config', '/api/config', null],
  ['plan: default scene', '/api/plan', body({})],
  ['plan: no bars please', '/api/plan', body({ veto_text: 'no bars please' })],
  ['plan: replace friend 2', '/api/plan', body({ people: [PEOPLE[0], { name: 'Hip-hop + sneakers', seeds: [{ query: 'Kendrick Lamar', type: 'artist' }, { query: 'Nike', type: 'brand' }] }, PEOPLE[2]] })],
  ['plan: add Joe\'s Pizza (question)', '/api/plan', body({ people: [...PEOPLE, { name: 'Friend 4', seeds: [{ query: "Joe's Pizza", type: 'place' }] }] })],
]

const env = makeEnv({ QLOO_BASE_URL: 'http://127.0.0.1:9' }, entries)
const home = await dispatch(env, new Request('http://127.0.0.1/'))
const cookie = home.headers.get('Set-Cookie')!.split(';')[0]
const cpu = () => { const u = process.cpuUsage(); return (u.user + u.system) / 1000 }

for (const round of ['cold', 'warm', 'warm']) {
  for (const [label, path, data] of flows) {
    const headers: Record<string, string> = { Cookie: cookie }
    if (data) Object.assign(headers, { 'Content-Type': 'application/json', 'Content-Length': String(Buffer.byteLength(data)) })
    const start = cpu()
    const response = await dispatch(env, new Request('http://127.0.0.1' + path, { method: data ? 'POST' : 'GET', headers, body: data }))
    const text = await response.text()
    const used = cpu() - start
    const last = data ? JSON.parse(text.trim().split('\n').pop()!) : null
    const what = last ? (last.event === 'result' ? `${last.result.status} ${last.result.pool_size ?? ''}` : last.event) : response.status
    console.log(`${round}\t${used.toFixed(1)} ms\t${(text.length / 1000).toFixed(0)} KB\t${label}\t${what}`)
  }
}
