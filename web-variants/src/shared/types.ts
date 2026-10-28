export type Seed = { query: string; type: string }
export type Person = { name: string; seeds: Seed[] }
export type Tag = { id: string; name: string }
export type Place = {
  id: string
  name: string
  genre: string
  address: string
  location?: { lat: number; lon: number }
  tags: Tag[]
  price_level?: number
}
export type Pick = Place & { ranks: number[]; worst_rank: number; rank_sum: number; observed: boolean[] }
export type ConcessionRow = { label: string; id: string; name: string; ranks: (number | null)[]; worst_rank: number }
export type Concession = {
  person: string
  top: string
  rank: number | null
  rank_drop: number
  contributions?: { seed: string; score: number }[]
  added_tags?: string[]
  removed_tags?: string[]
  text: string
}
export type ContrastRow = Place & { taste_rank: number | null; popularity_rank: number | null; change: 'shared' | 'added' | 'removed' }
export type Step = { tool: string; entities?: string[]; count?: number; latency_ms?: number }
export type Suggestion = { label: string; name: string; arguments: Record<string, unknown> }
export type Veto = { excluded: string[]; no_bars?: boolean; [k: string]: unknown }
export type Result = {
  status: string
  people: Person[]
  area: string
  occasion: string
  start_radius: number
  radius: number
  method: string
  planner: string
  pool_size: number
  overlap: number
  excluded_count: number
  notice?: string
  picks: Pick[]
  baseline: Place[]
  personal: Place[][]
  concession_table: ConcessionRow[]
  concessions: Concession[]
  contrast: { baseline_count: number; pick_popularity_rank: number | null; rows: ContrastRow[] }
  steps?: Step[]
  suggestions?: Suggestion[]
  choices?: Record<string, string>
  veto: Veto
}
export type Config = {
  people: Person[]
  default_scene: string
  presets: Record<string, { label: string; people: Person[]; area: string; occasion: string; start_radius: number }>
}
