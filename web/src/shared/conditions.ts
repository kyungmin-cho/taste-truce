import type { Result, Veto } from './types'

const QUIET = ['Loud', 'Busy', 'Lively']
const quiet = (v: Veto) => (v.tags ?? []).some((t) => QUIET.includes(t))

// Quick conditions offered next to the input; a condition already in force is not offered again.
const STARTERS = [
  { label: 'No bars please', applied: (r: Result) => (r.veto.categories ?? []).includes('bar') },
  { label: 'Somewhere quieter', applied: (r: Result) => quiet(r.veto) },
]

export function openStarters(result: Result | null) {
  return STARTERS.filter((s) => !result || !s.applied(result)).map((s) => s.label)
}

// One active condition: its label, and the veto without it.
export type Condition = { label: string; without: Veto }

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// The conditions in force, in the order the user sees them. They stay through friend edits and
// recomputes until the user removes one or resets them all.
export function activeConditions(veto: Veto | null | undefined): Condition[] {
  if (!veto) return []
  const out: Condition[] = []
  const categories = veto.categories ?? []
  const tags = veto.tags ?? []
  // "No bars please" excludes bars, pubs and nightclubs together; the chip uses the user's words.
  if (categories.length) out.push({ label: categories.includes('bar') ? 'No bars' : 'No ' + categories.map((c) => c + 's').join(', '), without: { ...veto, categories: [] } })
  else if (veto.no_bars) out.push({ label: 'No bars', without: { ...veto, no_bars: false } })
  if (quiet(veto)) out.push({ label: 'Somewhere quieter', without: { ...veto, tags: tags.filter((t) => !QUIET.includes(t)) } })
  if (tags.some((t) => t.includes('xpensive'))) out.push({ label: 'Skip expensive places', without: { ...veto, tags: tags.filter((t) => !t.includes('xpensive')) } })
  if (veto.max_price_level) out.push({ label: veto.max_price_level === 1 ? 'Cheapest places only' : 'Cheaper places', without: omit(veto, 'max_price_level') })
  if (veto.vegetarian) out.push({ label: 'Vegetarian options', without: omit(veto, 'vegetarian') })
  if (veto.excluded.length) out.push({ label: plural(veto.excluded.length, 'vetoed place'), without: { ...veto, excluded: [] } })
  return out
}

function omit(veto: Veto, key: string): Veto {
  const { [key]: _, ...rest } = veto
  return rest as Veto
}

// Anything the group has ruled out or asked for.
export function hasExclusions(result: Result | null) {
  return activeConditions(result?.veto).length > 0
}
