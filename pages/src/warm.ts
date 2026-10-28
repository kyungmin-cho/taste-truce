// Runs the agent once on made-up data while the isolate starts, before any request.
//
// The Workers Free plan allows 10 ms of CPU per request. Measured in node, a plan takes about 2 ms
// once the code has run, but the first plan in a fresh isolate also pays for compiling the agent,
// the ranking and the serializer. Doing that here moves the cost into isolate startup, which has its
// own limit (1 s). Nothing here reads KV or D1, calls the network, uses timers or random values,
// all of which the global scope forbids, and a failure only means the first request compiles instead.
import { DEFAULT_PEOPLE, run } from './agent.ts'
import { CATEGORY, DINNER } from './logic.ts'
import type { Obj } from './py.ts'
import type { Hit, Qloo } from './qloo.ts'
import { publicJson } from './scenes.ts'

const tag = (id: string, name: string) => ({ id, name })
const place = (i: number): Obj => ({
  id: `warm-${i}`, name: `Warm ${i}`, types: ['urn:entity:place'], location: { lat: 40.71, lon: -73.95 }, address: '1 Warm St, Brooklyn, NY 11211',
  genre: i % 4 ? 'Italian restaurant' : 'Cocktail bar', price_level: 1 + (i % 3), closed: false, venue_terms: i % 5 ? [] : ['wine bar'],
  tags: [tag(CATEGORY + (i % 4 ? 'restaurant' : 'bar'), 'Restaurant'), tag(DINNER, 'Dinner'), tag('urn:tag:ambience:qloo:cozy', 'Cozy'),
    tag('urn:tag:offerings:place:pasta', 'Pasta'), tag(`urn:tag:genre:place:restaurant:g${i % 3}`, `Genre ${i % 3}`), tag('urn:tag:ambience:qloo:loud', i % 2 ? 'Loud' : 'Calm')],
  explainability: [], affinity: null, popularity: (i * 37 % 100) / 100,
})
const PLACES = Array.from({ length: 24 }, (_, i) => place(i))

// Answers every request at once from PLACES, shaped like the cached responses the agent reads.
const fake = {
  async request(_session: unknown, path: string, params: Obj): Promise<[Obj[], Hit]> {
    if (path === '/search') {
      const q = params.query
      const rows = [{ ...place(0), id: 'warm-seed-' + q, name: q }]
      if (params.types === 'urn:entity:place') rows.push({ ...place(1), id: 'warm-seed-2-' + q, name: q })
      return [rows, true]
    }
    const ids: string[] | undefined = params['filter.results.entities']?.split(',')
    const seed = String(params['signal.interests.entities'] ?? '').length
    const rows = ids ? PLACES.filter((e) => ids.includes(e.id)) : PLACES.slice(seed % 5, (seed % 5) + Number(params.take) / 2)
    return [rows.map((e, i) => ({ ...e, affinity: ((i * 7 + seed) % 13) / 13, explainability: [{ entity_id: 'warm-seed-x', score: 0.5 }] })), true]
  },
  async used() {
    return 0
  },
} as unknown as Qloo

const scene = { people: DEFAULT_PEOPLE, area: 'Williamsburg NYC', occasion: 'Dinner', start_radius: 2000, choices: {}, veto: { excluded: [] } }
export const warmed = (async () => {
  const session = { id: 'warm', ip: '' }
  const statuses: string[] = []
  for (const body of [
    { ...scene, veto_text: '' },
    { ...scene, veto_text: 'no bars please' },
    { ...scene, veto_text: 'a cheaper option' },
    { ...scene, people: [...DEFAULT_PEOPLE, { name: 'Friend 4', seeds: [{ query: 'Warm Pizza', type: 'place' }] }], veto_text: '' },
  ]) {
    const result = await run({}, fake, session, body, () => {})
    publicJson({ event: 'result', result })
    statuses.push(result.status)
  }
  return statuses
})().catch((err) => [String(err)])
