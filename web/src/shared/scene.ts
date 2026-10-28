import type { Person, Scene } from './types'

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
export const sameTastes = (a: Person[], b: Person[]) =>
  JSON.stringify(a.map((p) => p.seeds.map((s) => [s.query, s.type]))) === JSON.stringify(b.map((p) => p.seeds.map((s) => [s.query, s.type])))

// Scene links carry the inputs only (#scene=<base64url JSON>), in the same format as the previous page.
export function encodeScene(scene: Scene) {
  const text = JSON.stringify({ v: 1, ...sceneOf(scene) })
  return btoa(String.fromCharCode(...new TextEncoder().encode(text)))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

export function decodeScene(hash: string): Scene {
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
  return sceneOf(scene)
}
