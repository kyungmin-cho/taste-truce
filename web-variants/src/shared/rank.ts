import type { Pick, Result } from './types'

export const fmtRank = (rank: number | null | undefined, observed = true) => (rank == null || !observed ? '—' : `#${rank}`)

// Index of the friend who gives up the most for this place (the maximin bottleneck).
export function worstIndex(ranks: (number | null)[]) {
  let at = -1
  ranks.forEach((r, i) => {
    if (r != null && (at < 0 || r > (ranks[at] as number))) at = i
  })
  return at
}

// 0 for a friend's #1, 1 for the last place in the pool.
export const rankDepth = (rank: number, pool: number) => (pool <= 1 ? 0 : Math.min(1, (rank - 1) / (pool - 1)))

export const pickOf = (result: Result): Pick => result.picks[0]

export function personalTop(result: Result, i: number) {
  return result.concession_table.find((row) => row.ranks[i] === 1)
}

export const shortName = (name: string) => name.split(' + ')[0]

// Friends tied at the row's worst rank; empty when everyone ranks it the same.
export function worstSet(ranks: (number | null)[]) {
  const seen = ranks.filter((r): r is number => r != null)
  if (seen.length < 2 || Math.max(...seen) === Math.min(...seen)) return new Set<number>()
  const max = Math.max(...seen)
  return new Set(ranks.flatMap((r, i) => (r === max ? [i] : [])))
}
