// Runs a list of HTTP requests through the Pages handlers and prints what came back, for
// tests/test_pages.py to compare with the Python server. Input on stdin:
//   {"bulk": path to a seed_kv.py file or null, "env": {...}, "requests": [{method, path, headers, body}]}
// The session cookie from / is carried to later requests unless a request sets its own Cookie.
import { readFileSync } from 'node:fs'
import { dispatch, makeEnv, type MemoryKV } from './support.ts'

const input = JSON.parse(readFileSync(0, 'utf8'))
const env = makeEnv(input.env ?? {}, input.bulk ? JSON.parse(readFileSync(input.bulk, 'utf8')) : [])
let cookie = ''
const out = []
for (const r of input.requests) {
  const headers = new Headers(r.headers ?? {})
  if (!headers.has('Cookie') && cookie) headers.set('Cookie', cookie)
  if (r.body !== undefined && r.body !== null && !headers.has('Content-Length')) headers.set('Content-Length', String(Buffer.byteLength(r.body)))
  const request = new Request('http://127.0.0.1:8788' + r.path, { method: r.method ?? 'GET', headers, body: r.body ?? undefined })
  const response = await dispatch(env, request)
  const set = response.headers.get('Set-Cookie')
  if (set) cookie = set.split(';')[0]
  out.push({ status: response.status, type: response.headers.get('Content-Type'), cookie: !!set, body: await response.text() })
}
const kv = env.CACHE as MemoryKV
process.stdout.write(JSON.stringify({ responses: out, kv_reads: kv.reads, kv_writes: kv.writes }))
