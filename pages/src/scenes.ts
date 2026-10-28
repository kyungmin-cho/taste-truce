// Port of scenes.py: preset inputs and saved scene snapshots, kept in KV.
//
//   scene:<name>       the scene exactly as /scene/<name> returns it: public fields only, with saved_utc
//   scene-meta:<name>  {"version": 2, "saved": epoch seconds}, so health checks need not read the scene
import { DEFAULT_PEOPLE } from './agent.ts'
import { ValueError, isDict, type Obj } from './py.ts'
import type { KV } from './qloo.ts'

export const PRESETS: { [name: string]: { label: string; area: string; people: Obj[] } } = {
  seongsu: { label: 'Seongsu', area: 'Seongsu', people: DEFAULT_PEOPLE },
  williamsburg: { label: 'Williamsburg', area: 'Williamsburg NYC', people: DEFAULT_PEOPLE },
  majority: { label: 'Williamsburg · majority / minority', area: 'Williamsburg NYC', people: [...DEFAULT_PEOPLE.slice(0, 2),
    { name: 'Pop + athleisure', seeds: [{ query: 'Taylor Swift', type: 'artist' }, { query: 'Lululemon', type: 'brand' }] }] },
}
export const VERSION = 2

export function defaultScene(env: Obj): string {
  const name = env.DEFAULT_SCENE || 'williamsburg'
  if (!Object.hasOwn(PRESETS, name)) throw new ValueError('DEFAULT_SCENE must be seongsu, williamsburg or majority')
  return name
}

export function sceneBody(name: string): Obj {
  const p = PRESETS[name]
  return structuredClone({ people: p.people, area: p.area, occasion: 'Dinner', start_radius: 2000 })
}

// Provider scores the agent ranks with; neither page shows them, so responses leave them out.
const RAW_FIELDS = ['affinity', 'explainability', 'popularity']
export function publicResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicResult)
  if (isDict(value)) {
    const raw = Object.hasOwn(value, 'id')
    return Object.fromEntries(Object.entries(value).filter(([k]) => !(raw && RAW_FIELDS.includes(k))).map(([k, v]) => [k, publicResult(v)]))
  }
  return value
}

// The same filter as publicResult, applied while serializing instead of on a copy.
export function publicJson(value: unknown): string {
  return JSON.stringify(value, function (this: Obj, key: string, v: unknown) {
    return RAW_FIELDS.includes(key) && Object.hasOwn(this, 'id') && !Array.isArray(this) ? undefined : v
  })
}

const utc = (saved: number) => new Date(Math.floor(saved) * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z')

export async function sceneMeta(kv: KV, env: Obj, name: string): Promise<{ saved: number } | null> {
  if (!Object.hasOwn(PRESETS, name)) return null
  try {
    const text = await kv.get('scene-meta:' + name, 'text')
    if (!text) return null
    const meta = JSON.parse(text)
    const ttl = parseInt(env.DEFAULT_SCENE_TTL_SECONDS || '0', 10)
    if (ttl && ttl < 2592000) throw new ValueError('Default scene TTL must be zero or at least 30 days')
    if (meta.version !== VERSION || (ttl && Date.now() / 1000 - meta.saved >= ttl)) return null
    return meta
  } catch {
    return null
  }
}

// The scene as JSON text, served without parsing it.
export async function readScene(kv: KV, env: Obj, name: string): Promise<string | null> {
  if (!(await sceneMeta(kv, env, name))) return null
  return kv.get('scene:' + name, 'text')
}

export async function saveScene(kv: KV, name: string, result: Obj) {
  const saved = Date.now() / 1000
  await kv.put('scene:' + name, publicJson({ ...result, saved_utc: utc(saved) }))
  await kv.put('scene-meta:' + name, JSON.stringify({ version: VERSION, saved }))
}

export async function health(kv: KV, env: Obj): Promise<Obj> {
  const name = defaultScene(env)
  const meta = await sceneMeta(kv, env, name)
  const ready = meta !== null
  return { status: ready ? 'ok' : 'not_ready', ready, default_scene: name, default_scene_ready: ready, needs_new_calls: !ready, saved_utc: ready ? utc(meta!.saved) : null }
}
