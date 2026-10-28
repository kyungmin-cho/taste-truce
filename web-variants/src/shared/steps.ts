import type { Step } from './types'

// Display names for the server's step records, matching the production panel.
export type StepView = {
  title: string
  kind: 'qloo' | 'plan' | 'filter' | 'pick' | 'replan'
  lines: string[]
  count: number | null
  list: string[] | null
}

const ID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
const distance = (m: number) => (m < 1000 ? `${m} m` : `${m / 1000} km`)
const places = (n: number) => `${n} ${n === 1 ? 'place' : 'places'}`

export function viewStep(row: Step): StepView {
  const tool = String(row.tool || '')
  const names = (row.entities || []).map(String).filter((x) => !ID.test(x))
  const count = row.count ?? 0
  const base: StepView = { title: tool, kind: 'plan', lines: names, count: null, list: null }
  if (tool.startsWith('/'))
    return {
      ...base,
      kind: 'qloo',
      title: tool.replace(/ · fallback.*/, ' · person'),
      count,
      ...(tool.endsWith('rescore') ? { list: names.slice(1), lines: names.slice(0, 1) } : {}),
    }
  if (tool.startsWith('Direct')) return { ...base, title: 'Plan', lines: [] }
  if (tool.startsWith('observe')) return { ...base, kind: 'replan', title: 'Observe → replan', lines: names }
  if (tool === 'ask user') return { ...base, title: 'Ask which one' }
  if (tool === 'choose category') return { ...base, title: 'Choose category' }
  if (tool.startsWith('validate'))
    return { ...base, kind: 'filter', title: 'Filter places', lines: [`${names[0]} · within ${distance(parseInt(names[1], 10))}`], count }
  if (tool.startsWith('widen')) {
    const [, from, to] = (names[0] || '').match(/(\d+) → (\d+)/) || []
    return { ...base, kind: 'filter', title: 'Search farther', lines: from ? [`${distance(+from)} → ${distance(+to)}`] : [] }
  }
  if (tool === 'candidate limit reached') return { ...base, kind: 'filter', title: 'Widest search reached', lines: [`${places(count)} left`] }
  if (tool.startsWith('bound')) return { ...base, kind: 'filter', title: 'Shared list', lines: names }
  if (tool === 'rank-sum') return { ...base, kind: 'pick', title: 'Lowest rank sum', lines: [] }
  if (tool.startsWith('consensus')) return { ...base, kind: 'pick', title: 'Fair pick', lines: [], list: names }
  if (/planner/i.test(tool)) return { ...base, title: 'Plan', lines: [] }
  return base
}

// Groups for compact summaries: how many Qloo calls of each endpoint ran.
export function qlooCalls(steps: Step[]) {
  const groups = new Map<string, number>()
  for (const s of steps) if (s.tool.startsWith('/')) {
    const key = s.tool.replace(/ · .*/, '')
    groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()]
}
