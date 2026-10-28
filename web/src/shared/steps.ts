import type { Step } from './types'

// Agent steps as shown in the panel. Stored steps keep the server's step names; they are renamed
// here for display only, with the same wording as the previous page (static/steps.js).
export type StepView = {
  title: string
  kind: 'qloo' | 'plan' | 'filter' | 'pick' | 'replan'
  lines: string[]
  // Only Qloo calls report how many results came back.
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
      ...(tool.endsWith('rescore') ? { lines: names.slice(0, 1), list: names.slice(1) } : {}),
    }
  if (tool.startsWith('Direct')) return { ...base, title: 'Plan', lines: [] }
  if (tool.startsWith('observe')) return { ...base, kind: 'replan', title: 'Observe → replan', lines: names }
  if (tool === 'ask user') return { ...base, title: 'Ask which one' }
  if (tool === 'choose category') return { ...base, title: 'Choose category' }
  if (tool.startsWith('validate'))
    return { ...base, kind: 'filter', title: 'Filter places', lines: [`${names[0]} · within ${distance(parseInt(names[1], 10))} · ${places(count)}`] }
  if (tool.startsWith('widen')) {
    const [, from, to] = (names[0] || '').match(/(\d+) → (\d+)/) || []
    return { ...base, kind: 'filter', title: 'Search farther', lines: from ? [`${distance(+from)} → ${distance(+to)} · fewer than 5 places`] : [] }
  }
  if (tool === 'candidate limit reached') return { ...base, kind: 'filter', title: 'Widest search reached', lines: [`${places(count)} left`] }
  if (tool.startsWith('bound')) {
    const [, k] = (names[0] || '').match(/(\d+)/) || []
    return { ...base, kind: 'filter', title: 'Shared list', lines: [`Top ${k} per friend · ${places(count)}`] }
  }
  if (tool === 'rank-sum') return { ...base, kind: 'pick', title: 'Lowest rank sum', lines: ['Some ranks are missing; searching wider'] }
  if (tool.startsWith('consensus')) return { ...base, kind: 'pick', title: 'Fair pick', lines: [], list: names }
  return base
}

// The endpoint of a Qloo step ("/search", "/v2/insights"), or null for the agent's own steps.
export const endpoint = (row: Step) => (String(row.tool || '').startsWith('/') ? row.tool.replace(/ · .*/, '') : null)

// How many Qloo calls of each endpoint ran.
export function qlooCalls(steps: Step[]) {
  const groups = new Map<string, number>()
  for (const s of steps) {
    const key = endpoint(s)
    if (key) groups.set(key, (groups.get(key) ?? 0) + 1)
  }
  return [...groups.entries()]
}

// Consecutive calls to the same Qloo endpoint and mode fold into one row; the agent's own
// steps stay one row each. `first` is the 0-based index of the first step in the group.
export type StepGroup = { first: number; steps: Step[] }
export function groupSteps(steps: Step[]): StepGroup[] {
  const groups: StepGroup[] = []
  steps.forEach((step, i) => {
    const last = groups.at(-1)
    const key = endpoint(step) && viewStep(step).title
    if (last && key && viewStep(last.steps[0]).title === key) last.steps.push(step)
    else groups.push({ first: i, steps: [step] })
  })
  return groups
}
