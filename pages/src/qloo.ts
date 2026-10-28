// Port of qloo.py for Pages: the Qloo key stays a server secret and responses are cached in KV.
//
// KV layout (see seed_kv.py, which writes the same layout from the Python cache):
//   q:<signature>   {"saved": epoch seconds, "rows": [row, ...]}
//                   a row is either a whole compacted entity or {"p": <hash>, "affinity", "explainability", "popularity"}
//   p:<hash>        the rest of a compacted entity, stored once however many responses list it
// The signature is qloo.Qloo.signature, so a seeded entry answers exactly the request that produced it.
import { venueTerms } from './logic.ts'
import { BudgetError, InternalError, QlooError, isDict, pyStr, signature, type Obj } from './py.ts'
import type { Session, Store } from './store.ts'

export interface KV {
  get(key: string, type: 'text'): Promise<string | null>
  get(keys: string[], type: 'text'): Promise<Map<string, string | null>>
  put(key: string, value: string): Promise<void>
}

export type Hit = boolean | string

const DESCRIPTIONS = ['description', 'short_description', 'overall_description', 'cuisine_description', 'ambience_description', 'amenities_description', 'service_description', 'unique_selling_points']
const get = (o: Obj, key: string, fallback: unknown = null) => (isDict(o) && Object.hasOwn(o, key) ? o[key] : fallback)

// agent.compact: the fields the agent and both pages use, from one Qloo entity.
export function compact(e: Obj): Obj {
  if (!isDict(e) || !Object.hasOwn(e, 'entity_id') || !Object.hasOwn(e, 'name')) throw new InternalError('entity without id or name')
  const prop = e.properties || {}
  const query = e.query || {}
  return {
    id: e.entity_id, name: e.name, types: get(e, 'types', [get(e, 'subtype')]),
    location: get(e, 'location'), address: get(prop, 'address', ''),
    genre: get(prop.primary_genre || {}, 'name', ''),
    tags: (e.tags || []).filter((t: Obj) => t.id || t.tag_id).map((t: Obj) => ({ id: t.id || t.tag_id, name: t.name || t.id || t.tag_id })),
    price_level: get(prop, 'price_level'), explainability: get(query.explainability || {}, 'signal.interests.entities', []),
    affinity: get(query, 'affinity'), popularity: get(e, 'popularity'), closed: get(prop, 'is_closed', false),
    venue_terms: venueTerms(DESCRIPTIONS.filter((k) => typeof prop[k] === 'string').map((k) => prop[k] || '').join(' ')),
  }
}

// Parsed place records, shared by every request this isolate serves. Keys are content hashes,
// so an entry can never go stale; the size bound keeps the isolate well inside its memory.
const PLACES = new Map<string, Obj>()
let placeBytes = 0
const PLACE_BYTES = 6_000_000

// Missing records are read with bulk gets of up to 100 keys, one KV operation each.
async function places(kv: KV, hashes: string[]): Promise<Map<string, Obj | null>> {
  const out = new Map<string, Obj | null>()
  const missing = hashes.filter((h) => {
    const hit = PLACES.get(h)
    if (hit) out.set(h, hit)
    return !hit
  })
  for (let i = 0; i < missing.length; i += 100) {
    const found = await kv.get(missing.slice(i, i + 100).map((h) => 'p:' + h), 'text')
    for (const h of missing.slice(i, i + 100)) {
      const text = found.get('p:' + h)
      const record = text ? JSON.parse(text) : null
      out.set(h, record)
      if (text && placeBytes + text.length <= PLACE_BYTES) {
        PLACES.set(h, record)
        placeBytes += text.length
      }
    }
  }
  return out
}

// Seeded responses never change, so an isolate keeps the ones it has read (score rows only).
const RESPONSES = new WeakMap<KV, Map<string, Obj>>()

export async function readCache(kv: KV, digest: string): Promise<{ saved: number; rows: Obj[] } | null> {
  let known = RESPONSES.get(kv)
  if (!known) RESPONSES.set(kv, (known = new Map()))
  let item = known.get(digest)
  if (!item) {
    const text = await kv.get('q:' + digest, 'text')
    if (!text) return null
    item = JSON.parse(text) as Obj
    if (item.rows.every((r: Obj) => r.p) && known.size < 400) known.set(digest, item)
  }
  const records = await places(kv, [...new Set<string>(item.rows.filter((r: Obj) => r.p).map((r: Obj) => r.p))])
  if ([...records.values()].some((r) => !r)) return null
  const rows = item.rows.map((r: Obj) => (r.p ? { ...records.get(r.p), affinity: r.affinity, explainability: r.explainability, popularity: r.popularity } : { ...r }))
  return { saved: item.saved, rows }
}

export class Qloo {
  env: Obj
  kv: KV
  store: Store
  ttl: number
  inflight = new Map<string, Promise<[Obj[], Hit]>>()

  constructor(env: Obj, kv: KV, store: Store) {
    this.env = env
    this.kv = kv
    this.store = store
    this.ttl = Number(env.QLOO_CACHE_TTL_SECONDS || '0')
  }

  used(session: Session) {
    return this.store.used(session)
  }

  // Concurrent identical requests in one plan wait for the first, which then counts as a cache hit.
  async request(session: Session, path: string, params: Obj): Promise<[Obj[], Hit]> {
    const digest = await signature(path, params)
    const running = this.inflight.get(digest)
    if (running) {
      const [rows] = await running
      return [rows.map((r) => ({ ...r })), true]
    }
    const work = this.fetchOnce(session, digest, path, params)
    this.inflight.set(digest, work)
    try {
      const [rows, hit] = await work
      return [rows.map((r) => ({ ...r })), hit]
    } finally {
      this.inflight.delete(digest)
    }
  }

  private async fetchOnce(session: Session, digest: string, path: string, params: Obj): Promise<[Obj[], Hit]> {
    const cached = await readCache(this.kv, digest)
    if (cached && (this.ttl <= 0 || Date.now() / 1000 - cached.saved < this.ttl)) return [cached.rows, true]
    const key = this.env.QLOO_API_KEY || ''
    if (!key) throw new QlooError('Set QLOO_API_KEY on the server, then restart.')
    try {
      await this.store.reserve(session)
    } catch (err) {
      if (err instanceof BudgetError && cached) return [cached.rows, 'stale · budget reached']
      throw err
    }
    const base = String(this.env.QLOO_BASE_URL || 'https://hackathon.api.qloo.com').replace(/\/+$/, '')
    const query = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, pyStr(v)]))
    let data: Obj
    try {
      const response = await fetch(base + path + '?' + query, {
        headers: { 'X-Api-Key': key, Accept: 'application/json', 'User-Agent': 'TasteTruce/1.0' },
        signal: AbortSignal.timeout(12000),
      })
      if (!response.ok) throw new QlooError(`Qloo returned HTTP ${response.status}. Please retry later.`)
      data = await response.json()
    } catch (err) {
      if (err instanceof QlooError) throw err
      throw new QlooError('Qloo could not be reached. Please retry later.')
    }
    if (!isDict(data)) throw new InternalError('unexpected response')
    if (data.errors || (Object.hasOwn(data, 'success') && !data.success)) throw new QlooError('Qloo could not complete this request.')
    let entities = data.results ?? []
    if (isDict(entities)) entities = entities.entities ?? []
    const rows = entities.map(compact)
    try {
      await this.kv.put('q:' + digest, JSON.stringify({ saved: Date.now() / 1000, rows }))
    } catch (err) {
      console.error('cache write failed: ' + ((err as Error)?.name || 'Error'))
    }
    return [rows, false]
  }
}
