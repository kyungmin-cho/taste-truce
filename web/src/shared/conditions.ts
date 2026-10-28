import type { Result } from './types'

// Quick conditions offered next to the input; a condition already in force is not offered again.
const STARTERS = [
  { label: 'No bars please', applied: (r: Result) => (r.veto.categories ?? []).includes('bar') },
  { label: 'Somewhere quieter', applied: () => false },
]

export function openStarters(result: Result | null) {
  return STARTERS.filter((s) => !result || !s.applied(result)).map((s) => s.label)
}

// Anything the group has ruled out: vetoed places or excluded categories.
export function hasExclusions(result: Result | null) {
  return !!result && (result.veto.excluded.length > 0 || (result.veto.categories ?? []).length > 0)
}
