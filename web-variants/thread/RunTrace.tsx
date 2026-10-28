import {
  ArrowDownUpIcon,
  FilterIcon,
  ListChecksIcon,
  RefreshCwIcon,
  ScaleIcon,
  SearchIcon,
  TrendingUpIcon,
  UserRoundIcon,
  UtensilsIcon,
  type LucideIcon,
} from 'lucide-react'
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from '@/components/ui/trace'
import { viewStep } from '@/shared/steps'
import type { Step } from '@/shared/types'

// Consecutive calls of one kind fold into a single line; each call stays readable inside it.
type Group = { key: string; icon: LucideIcon; title: string; meta: string; rows: { label: string; count: number | null }[] }

const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`

function keyOf(step: Step) {
  const t = step.tool
  if (t === '/search') return 'search'
  if (t.includes('rescore')) return 'rescore'
  if (t.startsWith('/v2/insights')) return 'insights'
  return t
}

function group(steps: Step[]): Group[] {
  const out: { key: string; steps: Step[] }[] = []
  for (const s of steps) {
    const key = keyOf(s)
    const last = out.at(-1)
    if (last && last.key === key && ['search', 'insights', 'rescore'].includes(key)) last.steps.push(s)
    else out.push({ key, steps: [s] })
  }
  return out.map(({ key, steps: run }) => {
    if (key === 'search')
      return {
        key,
        icon: SearchIcon,
        title: `Looked up ${plural(run.length, 'taste')}`,
        meta: `/search × ${run.length}`,
        rows: run.map((s) => ({ label: viewStep(s).lines[0] ?? '', count: s.count ?? 0 })),
      }
    if (key === 'insights') {
      const people = run.filter((s) => !s.tool.includes('popularity')).length
      return {
        key,
        icon: run.length > 1 ? UserRoundIcon : TrendingUpIcon,
        title: people ? `Read ${plural(people, 'taste profile')}${people < run.length ? ' + popularity' : ''}` : 'Read popularity',
        meta: `/v2/insights × ${run.length}`,
        rows: run.map((s) => {
          const [who, ...seeds] = viewStep(s).lines
          return { label: s.tool.includes('popularity') ? `Popularity · ${who}` : `${who} · ${seeds.join(' + ')}`, count: s.count ?? 0 }
        }),
      }
    }
    if (key === 'rescore') {
      const places = run[0].count ?? 0
      return {
        key,
        icon: ArrowDownUpIcon,
        title: `Ranked ${plural(places, 'place')} for ${plural(run.length, 'friend')}`,
        meta: `/v2/insights · rescore × ${run.length}`,
        rows: run.map((s) => ({ label: viewStep(s).lines[0] ?? '', count: s.count ?? 0 })),
      }
    }
    const v = viewStep(run[0])
    const icon =
      v.kind === 'filter' ? FilterIcon : v.kind === 'pick' ? ScaleIcon : v.kind === 'replan' ? RefreshCwIcon : v.title === 'Choose category' ? UtensilsIcon : ListChecksIcon
    let title = v.title
    let meta = v.lines.join(' · ')
    if (v.title === 'Choose category') meta = v.lines.join(' · ')
    if (v.kind === 'filter' && v.count != null) title = `Kept ${plural(v.count, 'place')}`
    if (v.kind === 'pick') {
      title = 'Fair pick'
      meta = v.list?.[0] ?? ''
    }
    if (run[0].tool === 'Local planner' || /planner/i.test(run[0].tool)) {
      title = 'Plan'
      meta = (run[0].entities?.[0] ?? '').replace(/^\w+ · /, '')
    }
    if (v.kind === 'replan') {
      title = 'Checked the result'
      meta = (run[0].entities?.[0] ?? '').replace(/ · .*/, '')
    }
    return { key, icon, title, meta, rows: [] }
  })
}

export function RunTrace({ steps, live }: { steps: Step[]; live: boolean }) {
  const groups = group(steps)
  const qloo = steps.filter((s) => s.tool.startsWith('/')).length
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase tabular">
        {plural(steps.length, 'step')} · {plural(qloo, 'Qloo call')}
      </p>
      <Trace aria-live={live ? 'polite' : undefined}>
        {groups.map((g, i) => {
          const running = live && i === groups.length - 1
          const line = (
            <TraceLine status={running ? 'running' : undefined}>
              <TraceIcon>
                <g.icon />
              </TraceIcon>
              <TraceTitle className="shrink-0 text-foreground">{g.title}</TraceTitle>
              {g.meta && g.rows.length === 0 && <TraceDescription className="min-w-0 shrink truncate">{g.meta}</TraceDescription>}
              
            </TraceLine>
          )
          if (!g.rows.length) return <div key={i}>{line}</div>
          return (
            <TraceCollapsible key={i}>
              <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
              <TraceCollapsibleContent>
                <p className="mb-1.5 font-mono text-[11px] text-muted-foreground">{g.meta}</p>
                <dl className="grid grid-cols-[1fr_auto] gap-x-6 gap-y-1 text-xs">
                  {g.rows.map((r, j) => (
                    <div key={j} className="contents">
                      <dt className="truncate">{r.label}</dt>
                      <dd className="text-right tabular">{r.count}</dd>
                    </div>
                  ))}
                </dl>
              </TraceCollapsibleContent>
            </TraceCollapsible>
          )
        })}
      </Trace>
    </div>
  )
}
