import type { Person, Scene, Veto } from './types'

export const AREAS = ['Seongsu', 'Williamsburg NYC'] as const
export const OCCASIONS = ['Dinner', 'Cafe', 'Drinks'] as const
export const SEED_TYPES = ['movie', 'artist', 'brand', 'place', 'book', 'tv_show'] as const
const RADII = [100, 2000, 3500, 5000]
export const MAX_FRIENDS = 5
export const MAX_SEEDS = 3

// Ready-made tastes that replace friend 2, to see how one friend moves the fair pick.
export const SWAPS: Person[] = [
  { name: 'Hip-hop + sneakers', seeds: [{ query: 'Kendrick Lamar', type: 'artist' }, { query: 'Nike', type: 'brand' }] },
  { name: 'K-pop + streetwear', seeds: [{ query: 'BTS', type: 'artist' }, { query: 'Supreme', type: 'brand' }] },
]

export const sceneOf = (s: Scene): Scene => ({
  people: s.people.map((p) => ({ name: p.name, seeds: p.seeds.map((x) => ({ query: x.query, type: x.type })) })),
  area: s.area,
  occasion: s.occasion,
  start_radius: s.start_radius,
})

export const sameScene = (a: Scene, b: Scene) => JSON.stringify(sceneOf(a)) === JSON.stringify(sceneOf(b))

// Scene links (#scene=<base64url JSON>) use the previous page's format. They carry the inputs and the
// conditions by name (no bars, quieter, cheaper), never entity ids, so vetoed places and the answers
// to "which one did you mean?" stay in this tab. The previous page reads the inputs and ignores the rest.
export function encodeScene(scene: Scene, veto?: Veto | null) {
  const conditions = linkConditions(veto)
  const text = JSON.stringify({ v: 1, ...sceneOf(scene), ...(conditions ? { conditions } : {}) })
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

const CATEGORIES = ['bar', 'pub', 'nightclub']
const TAGS = ['Loud', 'Busy', 'Lively', 'Expensive', 'Moderately expensive']
type LinkConditions = { categories?: string[]; tags?: string[]; max_price_level?: number; vegetarian?: boolean }

function linkConditions(veto?: Veto | null): LinkConditions | null {
  if (!veto) return null
  const c: LinkConditions = {}
  if (veto.categories?.length) c.categories = veto.categories
  if (veto.tags?.length) c.tags = veto.tags
  if (veto.max_price_level) c.max_price_level = veto.max_price_level
  if (veto.vegetarian) c.vegetarian = true
  return Object.keys(c).length ? c : null
}

const listOf = (value: unknown, allowed: string[]) => Array.isArray(value) && value.length <= allowed.length && value.every((x) => allowed.includes(x))

// A scene link's inputs and the veto its conditions stand for.
export function decodeLink(hash: string): { scene: Scene; veto: Veto } {
  const text = hash.replace(/^#scene=/, '').replaceAll('-', '+').replaceAll('_', '/')
  if (text.length > 12000) throw new Error('Scene link is too long.')
  const scene = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(text), (c) => c.charCodeAt(0))))
  if (
    scene.v !== 1 ||
    !Array.isArray(scene.people) ||
    scene.people.length < 1 ||
    scene.people.length > MAX_FRIENDS ||
    !(AREAS as readonly string[]).includes(scene.area) ||
    !(OCCASIONS as readonly string[]).includes(scene.occasion) ||
    !RADII.includes(scene.start_radius)
  )
    throw new Error('Invalid scene link.')
  for (const p of scene.people) {
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 || !Array.isArray(p.seeds) || p.seeds.length < 1 || p.seeds.length > MAX_SEEDS)
      throw new Error('Invalid friend.')
    for (const s of p.seeds)
      if (typeof s.query !== 'string' || !s.query.trim() || s.query.length > 120 || !(SEED_TYPES as readonly string[]).includes(s.type))
        throw new Error('Invalid taste seed.')
  }
  const c = scene.conditions ?? {}
  if (
    typeof c !== 'object' ||
    (c.categories !== undefined && !listOf(c.categories, CATEGORIES)) ||
    (c.tags !== undefined && !listOf(c.tags, TAGS)) ||
    (c.max_price_level !== undefined && ![1, 2].includes(c.max_price_level)) ||
    (c.vegetarian !== undefined && c.vegetarian !== true)
  )
    throw new Error('Invalid conditions in the scene link.')
  const veto: Veto = { excluded: [] }
  if (c.categories?.length) veto.categories = c.categories
  if (c.tags?.length) veto.tags = c.tags
  if (c.max_price_level) veto.max_price_level = c.max_price_level
  if (c.vegetarian) veto.vegetarian = true
  return { scene: sceneOf(scene), veto }
}
