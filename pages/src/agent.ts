// Port of agent.py: a bounded tool loop that resolves, clarifies, retrieves, widens, rescores and decides.
import { OCCASIONS, ambiguity, completeScores, concession, concessionTable, consensus, eligible, ranked, tasteContrast } from './logic.ts'
import { applyTools, chooseTools, labelFor, maxRadius, observeReplan, validate, type Action } from './planner.ts'
import { BudgetError, InternalError, PlannerError, QlooError, ValueError, casefold, g, hashable, isDict, pyLen, pyStr, re, slice, sorted, strip, truthy, type Obj } from './py.ts'
import type { Hit, Qloo } from './qloo.ts'
import type { Session } from './store.ts'

export const AREAS: { [area: string]: [number, number] } = { Seongsu: [127.0557, 37.5445], 'Williamsburg NYC': [-73.9571, 40.7081] }

const ZIP = re(String.raw`\b\d{5}\b`)
// Williamsburg keeps Brooklyn: a 3.5 km circle also reaches the Lower East Side.
export function inArea(e: Obj, area: string): boolean {
  if (area !== 'Williamsburg NYC') return true
  const address = e.address || ''
  const zip = ZIP.exec(address)
  return !zip || zip[0].startsWith('112') || address.includes('Brooklyn')
}

export const DEFAULT_PEOPLE = [
  { name: 'Indie + jazz', seeds: [{ query: 'Moonrise Kingdom', type: 'movie' }, { query: 'Miles Davis', type: 'artist' }] },
  { name: 'K-pop + streetwear', seeds: [{ query: 'BTS', type: 'artist' }, { query: 'Supreme', type: 'brand' }] },
  { name: 'Coffee + design', seeds: [{ query: 'Blue Bottle Coffee', type: 'brand' }, { query: 'Muji', type: 'brand' }] },
]

const SEED_TYPES = ['movie', 'artist', 'brand', 'place', 'book', 'tv_show']
const ms = (start: number) => Math.round((performance.now() - start) * 10) / 10
const get = (o: Obj, key: string, fallback: unknown) => (Object.hasOwn(o, key) ? o[key] : fallback)
const has = (o: Obj, key: unknown) => {
  if (!hashable(key)) throw new InternalError('unhashable')
  return typeof key === 'string' && Object.hasOwn(o, key)
}

// Results in submission order; the first failure in that order wins, after every task has finished,
// as with ThreadPoolExecutor.map.
async function all<T>(tasks: Promise<T>[]): Promise<T[]> {
  const settled = await Promise.allSettled(tasks)
  for (const s of settled) if (s.status === 'rejected') throw s.reason
  return settled.map((s) => (s as PromiseFulfilledResult<T>).value)
}

export async function run(env: Obj, qloo: Qloo, session: Session, body: Obj, emit: (event: Obj) => void): Promise<Obj> {
  const started = performance.now()
  const people = get(body, 'people', DEFAULT_PEOPLE)
  const area0 = get(body, 'area', 'Williamsburg NYC')
  const occasion0 = get(body, 'occasion', 'Dinner')
  const radius0 = get(body, 'start_radius', 2000)
  if (!(typeof radius0 === 'number' && [100, 2000, 3500, 5000].includes(radius0))) throw new ValueError('Choose a supported starting radius.')
  if (!has(AREAS, area0) || !has(OCCASIONS, occasion0) || !Array.isArray(people) || !(1 <= people.length && people.length <= 5)) {
    throw new ValueError('Choose a supported scene and one to five friends.')
  }
  for (const p of people) {
    if (!isDict(p) || typeof p.name !== 'string' || !(1 <= pyLen(strip(p.name)) && pyLen(strip(p.name)) <= 60) || !(1 <= pyLen(get(p, 'seeds', [])) && pyLen(get(p, 'seeds', [])) <= 3)) {
      throw new ValueError('Each friend needs a name and one to three taste seeds.')
    }
    if (!Array.isArray(p.seeds)) throw new InternalError('seeds are not a list')
    for (const s of p.seeds) {
      if (!isDict(s)) throw new InternalError('seed is not a dict')
      if (typeof s.query !== 'string' || !(1 <= pyLen(strip(s.query)) && pyLen(strip(s.query)) <= 120) || !SEED_TYPES.includes(s.type)) {
        throw new ValueError('Use a supported seed type and a name under 120 characters.')
      }
    }
  }
  const steps: Obj[] = []
  const step = (tool: string, entities: unknown[], count: number, latency = 0, extra: Obj = {}) => {
    const row = { tool, entities, count, latency_ms: Math.round(latency * 10) / 10, ...extra }
    steps.push(row)
    emit({ event: 'step', step: row })
  }
  const request = async (tool: string, path: string, params: Obj, names: string[]) => {
    const t = performance.now()
    const [rows, hit] = await qloo.request(session, path, params)
    step(tool, names, rows.length, ms(t), { cache: hit as Hit, ...('filter.results.entities' in params ? { entity_ids: params['filter.results.entities'].split(',') } : {}) })
    return rows
  }
  let veto = truthy(get(body, 'veto', null)) ? body.veto : {}
  const text = slice(strip(pyStr(get(body, 'veto_text', ''))), 500)
  if (!isDict(veto)) throw new ValueError('Invalid exclusions.')
  veto = Object.fromEntries(Object.entries(veto).filter(([k]) => ['no_bars', 'excluded', 'categories', 'tags', 'vegetarian', 'max_price_level'].includes(k)))
  if (!Object.hasOwn(veto, 'excluded')) veto.excluded = []
  if (!Array.isArray(veto.excluded) || veto.excluded.length > 100) throw new ValueError('Too many exclusions.')
  if (veto.excluded.some((x: unknown) => typeof x !== 'string' || pyLen(x) > 120)) throw new ValueError('Invalid place exclusion.')
  for (const [key, allowed] of [['categories', ['bar', 'pub', 'nightclub']], ['tags', ['Loud', 'Busy', 'Lively', 'Expensive', 'Moderately expensive']]] as [string, string[]][]) {
    if (!Object.hasOwn(veto, key)) continue
    if (!Array.isArray(veto[key])) throw new ValueError('Invalid condition.')
    for (const x of veto[key]) {
      if (!hashable(x)) throw new InternalError('unhashable')
      if (!allowed.includes(x)) throw new ValueError('Invalid condition.')
    }
  }
  if (Object.hasOwn(veto, 'max_price_level') && ![1, 2, true].includes(veto.max_price_level)) throw new ValueError('Invalid price limit.')
  let scene: Obj = { people, area: area0, occasion: occasion0, start_radius: radius0 }
  let t = performance.now()
  let planner: string
  let actions: Action[]
  try {
    if (truthy(get(body, 'suggested_action', null))) [planner, actions] = ['User-selected next step', validate([body.suggested_action])]
    else [planner, actions] = await chooseTools(env, text, scene)
  } catch (err) {
    if (err instanceof PlannerError) step(err.planner, ['No supported tool matched; ask for a condition'], 0, ms(t))
    throw err
  }
  step(planner, actions.map((a) => a.name + ' · ' + labelFor(a)), actions.length, ms(t))
  let needsTaste: boolean
  ;[scene, veto, needsTaste] = applyTools(scene, veto, actions, get(body, 'current_pick', null))
  let { people: friends, area, occasion } = scene as { people: Obj[]; area: string; occasion: string }
  const startRadius = Math.min(scene.start_radius, maxRadius(area))
  if (needsTaste) return { status: 'friend_taste', people: friends, area, occasion, start_radius: startRadius, veto, planner, steps }
  const choices = get(body, 'choices', {})
  const choice = (key: string) => {
    if (!isDict(choices)) throw new InternalError('choices are not a dict')
    return get(choices, key, null)
  }
  const resolve = async ([pi, si, seed]: [number, number, Obj]) => {
    const params: Obj = { query: seed.query, types: 'urn:entity:' + seed.type, take: 5 }
    if (seed.type === 'place') {
      const [lon, lat] = AREAS[area]
      Object.assign(params, { 'filter.location': `${lat},${lon}`, 'filter.radius': 15 })
    }
    const results = await request('/search', '/search', params, [seed.query])
    const key = `${pi}:${si}`
    const chosen = choice(key)
    if (chosen === 'skip') return { pi, si, seed, key, selected: 'skip' as const, results }
    let selected: Obj | null = results.find((r) => r.id === chosen) ?? null
    if (truthy(chosen) && !selected) throw new ValueError('The selected entity is not in the search results.')
    const ambiguous = ambiguity(results, seed.query) || (seed.type === 'place' && results.length > 1)
    if (!selected && results.length && !ambiguous) selected = results.find((r) => strip(casefold(r.name)) === strip(casefold(seed.query))) ?? null
    return { pi, si, seed, key, selected, results }
  }
  const jobs: [number, number, Obj][] = friends.flatMap((p, pi) => p.seeds.map((s: Obj, si: number) => [pi, si, s] as [number, number, Obj]))
  const resolved = await all(jobs.map(resolve))
  const clarification: Obj[] = []
  const ids: string[][] = friends.map(() => [])
  const seedNames = new Map<string, string>()
  const resolvedChoices: Obj = {}
  const activeSeeds: Obj[][] = friends.map(() => [])
  for (const { pi, seed, key, selected, results } of resolved) {
    if (selected === 'skip') continue
    activeSeeds[pi].push(seed)
    if (selected) {
      seedNames.set(selected.id, selected.name)
      resolvedChoices[`${pi}:${activeSeeds[pi].length - 1}`] = selected.id
      ids[pi].push(selected.id)
    } else clarification.push({ key, person: friends[pi].name, query: seed.query, options: results })
  }
  if (clarification.length) {
    step('ask user', clarification.map((c) => c.query), clarification.length)
    return { status: 'clarification', people: friends, area, occasion, start_radius: startRadius, questions: clarification, planner, steps, veto, elapsed_ms: Math.round(performance.now() - started) }
  }
  if (ids.some((x) => !x.length)) throw new ValueError('Each friend needs at least one resolved taste. Add another taste or remove that friend after skipping.')
  friends = friends.map((p, i) => ({ ...p, seeds: activeSeeds[i] }))
  const tags = OCCASIONS[occasion]
  step('choose category', tags.map((x) => x.split(':').pop()!.replace(/_/g, ' ')), tags.length, 0, { occasion, operator: 'intersection' })
  const [lon, lat] = AREAS[area]
  const keep = (e: Obj, v: Obj) => inArea(e, area) && eligible(e, occasion, v)
  let pool = new Map<string, Obj>()
  let lists: Obj[][] = []
  let baseline: Obj[] = []
  const excluded = new Set<string>()
  const attempts = ([[100, 10], [2000, 30], [3500, 40], [5000, 50]] as [number, number][]).filter(([r]) => startRadius <= r && r <= maxRadius(area))
  let radius = 0
  let take = 0
  let params: Obj = {}
  for (let attempt = 0; attempt < attempts.length; attempt++) {
    ;[radius, take] = attempts[attempt]
    params = { 'filter.type': 'urn:entity:place', 'filter.location': `POINT(${lon} ${lat})`, 'filter.location.radius': radius, take, 'filter.tags': tags.join(','), 'operator.filter.tags': 'intersection' }
    const retrieve = async (i: number) => {
      const p = { ...params, 'signal.interests.entities': ids[i].join(',') }
      const rows = await request('/v2/insights · person', '/v2/insights', p, [friends[i].name, ...friends[i].seeds.map((s: Obj) => s.query)])
      for (const e of rows) if (keep(e, {}) && !keep(e, veto)) excluded.add(e.id)
      return rows.filter((e) => keep(e, veto))
    }
    const results = await all([...friends.map((_, i) => retrieve(i)), request('/v2/insights · popularity', '/v2/insights', params, [area, occasion, 'No taste signal'])])
    lists = results.slice(0, friends.length)
    const baseRows = results[friends.length]
    for (const e of baseRows) if (keep(e, {}) && !keep(e, veto)) excluded.add(e.id)
    baseline = baseRows.filter((e) => keep(e, veto))
    pool = new Map()
    for (const es of lists) for (const e of es) pool.set(e.id, e)
    step('validate category + exclusions', [area, `${radius} m`, `take ${take}`], pool.size)
    if (pool.size >= 5) break
    if (attempt + 1 < attempts.length) {
      const [nextRadius, nextTake] = attempts[attempt + 1]
      step('widen → retry', [`${radius} → ${nextRadius} m`, `take ${take} → ${nextTake}`, 'Fewer than 5 eligible places'], pool.size)
    } else step('candidate limit reached', ['Return the actual remaining count'], pool.size)
  }
  if (!pool.size) throw new QlooError('No eligible places remain. Change the scene or reset exclusions.')
  if (pool.size > 50) {
    let k = Math.floor(50 / friends.length)
    const union = (n: number) => new Set(lists.flatMap((rows) => rows.slice(0, n).map((e) => e.id))).size
    while (union(k + 1) <= 50 && k < Math.max(...lists.map((x) => x.length))) k += 1
    pool = new Map()
    for (const rows of lists) for (const e of rows.slice(0, k)) pool.set(e.id, e)
    step('bound candidate union', [`Top ${k} per person; at most 50 candidates`], pool.size)
  }
  let poolRows = [...pool.values()]
  const rescore = async (i: number) => {
    const chunk = sorted(poolRows.map((e) => e.id))
    const query = { 'filter.type': 'urn:entity:place', 'filter.results.entities': chunk.join(','), 'signal.interests.entities': ids[i].join(','), take: chunk.length, 'feature.explainability': 'true' }
    const rows = await request('/v2/insights · rescore', '/v2/insights', query, [friends[i].name, ...poolRows.map((e) => e.name)])
    for (const e of rows) {
      e.contributions = e.explainability.filter((c: Obj) => typeof c.score === 'number').map((c: Obj) => ({ seed: seedNames.get(c.entity_id) ?? 'Unknown seed', score: c.score }))
    }
    return completeScores(poolRows, rows) ? ranked(rows) : null
  }
  let method = 'maximin-rank'
  try {
    if (poolRows.length > 50) throw new QlooError('Union exceeds the API take ceiling of 50')
    const rescored = await all(friends.map((_, i) => rescore(i)))
    if (rescored.some((r) => r === null)) throw new QlooError('Incomplete affinity coverage')
    lists = rescored as Obj[][]
  } catch (err) {
    if (err instanceof BudgetError || !(err instanceof QlooError)) throw err
    method = 'rank-sum'
    step('rank-sum', ['Rescoring incomplete; retrieve more candidates'], pool.size)
    const larger = { ...params, take: 50 }
    const widen = async (i: number) => (await request('/v2/insights · fallback take 50', '/v2/insights', { ...larger, 'signal.interests.entities': ids[i].join(',') }, [friends[i].name])).filter((e) => keep(e, veto))
    lists = await all(friends.map((_, i) => widen(i)))
    pool = new Map()
    for (const es of lists) for (const e of es) pool.set(e.id, e)
    poolRows = [...pool.values()]
  }
  t = performance.now()
  const allPicks = consensus(poolRows, lists, method, poolRows.length)
  const picks = allPicks.slice(0, 10)
  if (!picks.length) throw new QlooError('There are no comparable candidates. Change the scene.')
  if (lists.some((rows) => !rows.length)) throw new QlooError('One signal has no candidates after exclusions. Change the scene.')
  const explanations = friends.map((p, i) => concession(p, lists[i], picks[0], i))
  step('consensus · ' + method, picks.map((e) => e.name), picks.length, ms(t))
  const [base, contrast] = tasteContrast(picks, allPicks, baseline)
  const quiet = (text || Object.values(veto).some(truthy)) && !excluded.size && actions.every((a) => ['plan', 'exclude_categories', 'exclude_tags', 'exclude_place'].includes(a.name))
  const result: Obj = {
    status: 'done', choices: resolvedChoices, area, occasion, people: friends, picks, personal: lists.map((es) => es.slice(0, 10)),
    baseline: base, overlap: contrast.overlap, overlap_denominator: Math.min(10, picks.length), pool_size: pool.size, method,
    concessions: explanations, veto, planner, start_radius: startRadius, excluded_count: excluded.size,
    notice: quiet ? 'Nothing matched, nothing changed.' : '', radius, take, contrast, session_calls: await qloo.used(session),
  }
  result.concession_table = concessionTable(friends, lists, base, picks[0])
  if (text) {
    const observation = { excluded_count: excluded.size, remaining_count: pool.size, radius, nothing_matched: result.notice === 'Nothing matched, nothing changed.' }
    t = performance.now()
    const [source, suggestions] = await observeReplan(env, text, scene, actions, observation)
    result.suggestions = suggestions
    step('observe → replan · ' + source, [`${observation.remaining_count} places left · ${observation.excluded_count} excluded · ${g(observation.radius / 1000)} km`, ...suggestions.map((s) => s.label)], suggestions.length, ms(t))
  }
  result.steps = steps
  result.elapsed_ms = Math.round(performance.now() - started)
  return result
}
