// Port of logic.py: consensus on comparable per-person ranks, with auditable concessions.
import { casefold, cmp, re, sorted, strip, type Obj } from './py.ts'

export const CATEGORY = 'urn:tag:category:place:'
export const DINNER = 'urn:tag:dining_options:place:dinner'
export const OCCASIONS: { [occasion: string]: string[] } = { Dinner: [CATEGORY + 'restaurant', DINNER], Cafe: [CATEGORY + 'cafe'], Drinks: [CATEGORY + 'bar'] }

// Derived tag facts are cached per tags array. A place record's tags array is shared by every
// response row that lists the place and is never changed, so each place is worked out once.
function memo<T>(cache: WeakMap<object, T>, tags: Obj[], make: () => T): T {
  let value = cache.get(tags)
  if (value === undefined) {
    value = make()
    cache.set(tags, value)
  }
  return value
}
const TAG_IDS = new WeakMap<object, Set<string>>()
const KINDS = new WeakMap<object, Set<string>>()
const NAMES = new WeakMap<object, Set<string>>()
const EVIDENCE = new WeakMap<object, Map<string, string[]>>()

export const tagIds = (e: Obj): Set<string> => {
  const tags = e.tags ?? []
  return memo(TAG_IDS, tags, () => new Set(tags.map((t: Obj) => t.id)))
}
const tagNames = (e: Obj): Set<string> => {
  const tags = e.tags ?? []
  return memo(NAMES, tags, () => new Set(tags.map((t: Obj) => casefold(t.name))))
}

const NOT_DRINKING = new Set(['espresso_bar', 'coffee_bar', 'juice_bar', 'sushi_bar', 'salad_bar', 'snack_bar'])
const FOOD_BARS = String.raw`\b(?:sushi|raw|juice|salad|snack|espresso|coffee|noodle|poke|omakase|yogurt) bars?\b|\bbar-?b-?q\b`
const FOOD_BARS_RE = re(FOOD_BARS, 'gi')
const foodBars = (text: string) => text.replace(FOOD_BARS_RE, ' ')

const PUB_WORDS = String.raw`(?:gastro)?pubs?|taverns?|saloons?|taprooms?|tap rooms?|beer halls?|beer gardens?|biergartens?|brewpubs?`
const CLUB_WORDS = String.raw`night ?clubs?|supper clubs?|dance halls?`
const VENUE_NAMES: { [kind: string]: RegExp } = {
  bar: re(String.raw`\b(?:bars?|lounges?|speakeasy|${PUB_WORDS}|${CLUB_WORDS})\b`, 'i'),
  pub: re(String.raw`\b(?:${PUB_WORDS})\b`, 'i'),
  nightclub: re(String.raw`\b(?:${CLUB_WORDS})\b`, 'i'),
}
const VENUE_TERMS: { [kind: string]: RegExp } = {
  bar: re(String.raw`\b(?:(?:aperitivo|cocktail|wine|beer|whiske?y|sake|mezcal|tequila|dive|sports|piano|tiki|karaoke|hookah|neighborhood) (?:bar|lounge)s?|bar (?:&|and) grill|speakeasy|hookah|${PUB_WORDS}|${CLUB_WORDS})\b`, 'i'),
  pub: re(String.raw`\b(?:${PUB_WORDS})\b`, 'i'),
  nightclub: re(String.raw`\b(?:${CLUB_WORDS})\b`, 'i'),
}
const TERMS_ALL = new RegExp(VENUE_TERMS.bar.source, 'giu')
const TERMS_EXACT: { [kind: string]: RegExp } = Object.fromEntries(Object.entries(VENUE_TERMS).map(([k, r]) => [k, new RegExp(`^(?:${r.source})$`, 'iu')]))
for (const pattern of [TERMS_ALL, ...Object.values(TERMS_EXACT)]) {
  pattern.test('warm up')
  pattern.lastIndex = 0
}
const CLUB_TAGS = ['urn:tag:ambience:qloo:club_like', 'urn:tag:ambience:qloo:nightclub_energy', 'urn:tag:setting:qloo:supper_club', 'urn:tag:setting:qloo:dance_hall']
const VENUE_TAGS: { [kind: string]: Set<string> } = {
  bar: new Set([...CLUB_TAGS, 'urn:tag:amenity:qloo:hookah', 'urn:tag:activity_type:qloo:hookah_smoking', 'urn:tag:activity_type:qloo:smoking_hookah']),
  pub: new Set(),
  nightclub: new Set(CLUB_TAGS),
}

const DESCRIPTIVE = ['urn:tag:genre:', 'urn:tag:category:', 'urn:tag:offerings:', 'urn:tag:dining_options:', 'urn:tag:ambience:', 'urn:tag:culinary_style:', 'urn:tag:service_type:', 'urn:tag:beverage_offering:']
const VEGETARIAN = ['urn:tag:offerings:place:vegetarian_options', 'urn:tag:category:place:vegetarian_restaurant', 'urn:tag:genre:place:restaurant:vegetarian', 'urn:tag:amenity:qloo:vegetarian_options', 'urn:tag:dietary_option:qloo:vegetarian']
const VETO_TAGS = new Set(['Loud', 'Busy', 'Lively', 'Expensive', 'Moderately expensive'].map(casefold))

// Whether any rule, comparison or page reads this tag. A Qloo place lists a few hundred; about a third are kept.
export function keptTag(t: Obj): boolean {
  const id: string = t.id
  return !id.startsWith('urn:') || DESCRIPTIVE.some((p) => id.startsWith(p)) || VEGETARIAN.includes(id) || VENUE_TAGS.bar.has(id) || VETO_TAGS.has(casefold(t.name))
}

export function venueTerms(text: string): string[] {
  const found = new Set<string>()
  for (const m of foodBars(text || '').matchAll(TERMS_ALL)) found.add(m[0].toLowerCase())
  return sorted(found)
}

export function placeKinds(e: Obj): Set<string> {
  return memo(KINDS, e.tags ?? [], () => kindsOf(e))
}

function kindsOf(e: Obj): Set<string> {
  const kinds = new Set<string>()
  for (const t of tagIds(e)) {
    for (const prefix of [CATEGORY, 'urn:tag:genre:place:restaurant:', 'urn:tag:genre:place:']) {
      if (t.startsWith(prefix)) kinds.add(t.slice(prefix.length))
    }
  }
  for (const k of NOT_DRINKING) kinds.delete(k)
  return kinds
}

export function isKind(e: Obj, category: string): boolean {
  const match = (k: string) => {
    if (category === 'bar') return ['bar', 'lounge', 'nightclub', 'taproom', 'beer_hall', 'beer_garden'].includes(k) || k.endsWith('_bar') || k.startsWith('bar_') || k.endsWith('pub')
    if (category === 'pub') return k.endsWith('pub') || ['taproom', 'beer_hall', 'beer_garden'].includes(k)
    return k === category || k.endsWith('_' + category)
  }
  return [...placeKinds(e)].some(match)
}

export function venueEvidence(e: Obj, category: string): string[] {
  const known = memo(EVIDENCE, e.tags ?? [], () => new Map<string, string[]>())
  const key = [category, e.name, e.genre, ...(e.venue_terms ?? [])].join('\u0000')
  let found = known.get(key)
  if (!found) {
    found = evidenceOf(e, category)
    known.set(key, found)
  }
  return [...found]
}

function evidenceOf(e: Obj, category: string): string[] {
  const found = sorted(placeKinds(e)).filter((k) => isKind({ tags: [{ id: CATEGORY + k }] }, category))
  if (VENUE_NAMES[category].test(foodBars(e.genre ?? ''))) found.push('genre: ' + e.genre)
  if (VENUE_NAMES[category].test(foodBars(e.name ?? ''))) found.push('name: ' + e.name)
  for (const t of e.venue_terms ?? []) if (TERMS_EXACT[category].test(t)) found.push('described as ' + t)
  const ids = tagIds(e)
  for (const t of sorted([...VENUE_TAGS[category]].filter((x) => ids.has(x)))) found.push('tag ' + t.split(':').pop())
  return found
}

export function eligible(e: Obj, occasion: string, veto: Obj): boolean {
  const tags = tagIds(e)
  if (!OCCASIONS[occasion].every((t) => tags.has(t))) return false
  const genre = (e.genre ?? '').toLowerCase()
  const has = (words: string[]) => words.some((x) => genre.includes(x))
  if (occasion === 'Dinner' && !has(['restaurant', 'ramen', 'noodle', 'sushi', 'barbecue', 'steak', 'pizza', 'diner', 'bistro'])) return false
  if (occasion === 'Cafe' && !has(['cafe', 'coffee'])) return false
  if (occasion === 'Drinks' && (!has(['bar', 'pub', 'nightclub', 'lounge', 'brewery']) || genre.includes('store'))) return false
  const categories = new Set<string>([...(veto.categories ?? []), ...(veto.no_bars ? ['bar'] : [])])
  if ([...categories].some((c) => venueEvidence(e, c).length)) return false
  if ((veto.tags ?? []).length && veto.tags.some((t: string) => tagNames(e).has(casefold(t)))) return false
  if (veto.vegetarian && !VEGETARIAN.some((t) => tags.has(t))) return false
  if (veto.max_price_level && (typeof e.price_level !== 'number' || !(0 < e.price_level && e.price_level <= Number(veto.max_price_level)))) return false
  return !e.closed && !(veto.excluded ?? []).includes(e.id)
}

// Affinity only determines order within a single person's pool request.
export const ranked = (rows: Obj[]) => [...rows].sort((a, b) => cmp([-a.affinity, a.id], [-b.affinity, b.id]))

export function consensus(pool: Obj[], lists: Obj[][], method = 'maximin-rank', limit = 10): Obj[] {
  const ranks = lists.map((rows) => new Map(rows.map((e, i) => [e.id, i + 1])))
  const n = Math.max(pool.length, ...lists.map((x) => x.length)) + 1
  const candidates: Obj[] = []
  for (const e of pool) {
    const rs = ranks.map((r) => r.get(e.id) ?? n)
    if (method === 'maximin-rank' && ranks.some((r) => !r.has(e.id))) continue
    candidates.push({ ...e, ranks: rs, worst_rank: Math.max(...rs), rank_sum: rs.reduce((a, b) => a + b, 0), observed: ranks.map((r) => r.has(e.id)) })
  }
  const key = method === 'maximin-rank' ? (e: Obj) => [e.worst_rank, e.rank_sum, e.id] : (e: Obj) => [e.rank_sum, e.worst_rank, e.id]
  return candidates.sort((a, b) => cmp(key(a), key(b))).slice(0, limit)
}

export function concession(person: Obj, rows: Obj[], pick: Obj, index: number): Obj {
  const first = rows[0]
  const rank = pick.ranks[index]
  const observed = pick.observed[index]
  const descriptive = (e: Obj) => {
    const out = new Map<string, string>()
    for (const t of e.tags ?? []) if (!t.id.startsWith('urn:') || DESCRIPTIVE.some((p) => t.id.startsWith(p))) out.set(t.id, t.name)
    return out
  }
  const firstTags = descriptive(first)
  const pickTags = descriptive(pick)
  const only = (a: Map<string, string>, b: Map<string, string>) => sorted(new Set([...a].filter(([k]) => !b.has(k)).map(([, v]) => v))).slice(0, 3)
  const removed = only(firstTags, pickTags)
  const added = only(pickTags, firstTags)
  const seeds = person.seeds.map((s: Obj) => s.query).join(' and ')
  let text = `People who like ${seeds} tend toward ${first.name} in this pool. `
  if (observed) text += rank === 1 ? 'The shared pick is also #1 for this taste signal. ' : `The shared pick is #${rank} for this taste signal: a ${rank - 1}-place drop from #1. `
  else text += 'The shared pick was absent from this signal’s returned list; its rank is unknown. '
  if (removed.length || added.length) text += 'Tag difference: ' + (removed.join(', ') || 'no unique tags') + ' → ' + (added.join(', ') || 'no unique tags') + '.'
  else text += 'No tag difference is recorded.'
  const scored = rows.find((e) => e.id === pick.id) ?? {}
  return {
    contributions: scored.contributions ?? [], top_contributions: first.contributions ?? [], person: person.name, top: first.name,
    rank: observed ? rank : null, rank_drop: observed ? rank - 1 : null, removed_tags: removed, added_tags: added, text,
  }
}

export function completeScores(pool: Obj[], rows: Obj[]): boolean {
  const expected = new Set(pool.map((e) => e.id))
  const got = new Set(rows.map((e) => e.id))
  return rows.length === expected.size && got.size === expected.size && [...got].every((id) => expected.has(id)) && rows.every((e) => typeof e.affinity === 'number' && Number.isFinite(e.affinity))
}

export function ambiguity(results: Obj[], query: string): boolean {
  const q = strip(casefold(query))
  return results.filter((e) => strip(casefold(e.name)) === q).length !== 1
}

export function tasteContrast(picks: Obj[], allPicks: Obj[], popularity: Obj[]): [Obj[], Obj] {
  const sample = [...popularity].sort((a, b) => cmp([-(a.popularity || 0), a.id], [-(b.popularity || 0), b.id]))
  const baseline = sample.slice(0, 10)
  const tasteRanks = new Map(allPicks.map((e, i) => [e.id, i + 1]))
  const popRanks = new Map(sample.map((e, i) => [e.id, i + 1]))
  const tasteIds = new Set(picks.map((e) => e.id))
  const baselineIds = new Set(baseline.map((e) => e.id))
  const unique = new Map<string, Obj>()
  for (const e of [...picks, ...baseline]) unique.set(e.id, e)
  const rows = [...unique.values()].map((e) => ({
    ...e, taste_rank: tasteRanks.get(e.id) ?? null, popularity_rank: popRanks.get(e.id) ?? null,
    change: tasteIds.has(e.id) && baselineIds.has(e.id) ? 'shared' : tasteIds.has(e.id) ? 'added' : 'removed',
  }))
  const pick = picks[0]
  const top3 = new Set(baseline.slice(0, 3).map((e) => e.id))
  return [baseline, {
    overlap: [...tasteIds].filter((id) => baselineIds.has(id)).length,
    top3_overlap: new Set(picks.slice(0, 3).map((e) => e.id).filter((id) => top3.has(id))).size,
    taste_count: picks.length, baseline_count: baseline.length, sample_count: sample.length,
    pick_popularity_rank: popRanks.get(pick.id) ?? null, rows,
  }]
}

export function concessionTable(people: Obj[], lists: Obj[][], baseline: Obj[], pick: Obj): Obj[] {
  const ranks = lists.map((rows) => new Map(rows.map((e, i) => [e.id, i + 1])))
  const rows: Obj[] = []
  const add = (label: string, entity: Obj) => {
    const values = ranks.map((r) => r.get(entity.id) ?? null)
    const known = values.filter((v) => v !== null) as number[]
    rows.push({ label, id: entity.id, name: entity.name, ranks: values, worst_rank: known.length === values.length ? Math.max(...known) : null })
  }
  if (baseline.length) add('Popularity #1', baseline[0])
  people.forEach((p, i) => { if (lists[i].length) add(p.name + ' #1', lists[i][0]) })
  const favorites = lists.filter((rows) => rows.length).map((rows) => rows[0].id)
  for (const id of new Set(favorites)) {
    const count = favorites.filter((x) => x === id).length
    if (count > people.length / 2 && count >= 2) add(`Majority #1 (${count}/${people.length})`, lists.flat().find((e) => e.id === id)!)
  }
  add(pick.observed.every(Boolean) ? 'Fair pick' : 'Fair pick · lowest rank sum', pick)
  return mergeRows(rows)
}

export function mergeRows(rows: Obj[]): Obj[] {
  const merged = new Map<string, Obj>()
  for (const row of rows) {
    const same = merged.get(row.id)
    if (!same) merged.set(row.id, { ...row })
    else if (row.label.startsWith('Fair pick')) same.label = row.label + ' · ' + same.label
    else same.label += ' · ' + row.label
  }
  return [...merged.values()]
}
