import { ChevronRightIcon } from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { endpoint, groupSteps, qlooCalls, viewStep } from '@/shared/steps'
import type { Step } from '@/shared/types'
import type { Truce } from '@/shared/useTruce'

// Steps of the run on screen: the live run while it works or waits for an answer, else the result's.
export function stepsOf(t: Truce): Step[] {
  if (t.live && (t.busy || t.live.result || t.live.waiting) && t.live.steps.length) return t.live.steps
  return t.current?.steps ?? []
}

const qlooTotal = (steps: Step[]) => steps.filter((s) => endpoint(s)).length
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

const trigger = 'group inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
const chevron = 'size-3 transition-transform group-data-panel-open:rotate-90'

// One line that is always in view: every step as a tick (Qloo calls in the accent), the totals and
// the latest step. It opens the full list.
export function AgentStrip({ t, onOpen, className }: { t: Truce; onOpen: () => void; className?: string }) {
  const steps = stepsOf(t)
  if (!steps.length && !t.busy) return null
  const last = steps.at(-1)
  const latest = last ? viewStep(last) : null
  return (
    <button
      type="button"
      data-tt="agent-strip"
      onClick={onOpen}
      aria-label={`Agent: ${plural(steps.length, 'step')}, ${plural(qlooTotal(steps), 'Qloo call')}. Show steps`}
      className={cn('group flex w-full flex-col gap-1.5 rounded-lg px-3 py-2 text-left outline-none hover:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring', className)}
    >
      <span aria-hidden className="flex h-2 w-full gap-[3px]">
        {steps.map((s, i) => (
          <span key={i} className={cn('h-full min-w-0 flex-1 rounded-[1px]', endpoint(s) ? 'bg-primary' : 'bg-foreground/20')} />
        ))}
        {t.busy && <span className="h-full w-6 animate-pulse rounded-[1px] bg-primary/30" />}
      </span>
      <span className="flex w-full items-center gap-2 text-xs tabular-nums">
        {t.busy && <Spinner className="size-3 text-primary" />}
        <span className="shrink-0 font-medium">
          {plural(steps.length, 'step')} <span className="text-muted-foreground">·</span> {plural(qlooTotal(steps), 'Qloo call')}
        </span>
        {latest && (
          <span className={cn('min-w-0 flex-1 truncate text-right text-muted-foreground', latest.kind === 'qloo' && 'font-mono text-[11px]')}>{latest.title}</span>
        )}
        <ChevronRightIcon className="size-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" />
      </span>
    </button>
  )
}

export function AgentSteps({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const calls = qlooCalls(steps)
  const groups = groupSteps(steps)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>
          <strong className="font-semibold text-foreground">{plural(steps.length, 'step')}</strong>
        </span>
        <span>
          <strong className="font-semibold text-foreground">{calls.reduce((n, [, c]) => n + c, 0)}</strong> Qloo calls
        </span>
        {calls.map(([name, n]) => (
          <span key={name} className="font-mono">
            {name} ×{n}
          </span>
        ))}
      </div>
      <ol className="relative flex flex-col" aria-busy={busy}>
        <span aria-hidden className="absolute top-2 bottom-2 left-[1.125rem] w-px bg-border" />
        {groups.map((group, gi) => {
          const v = viewStep(group.steps[0])
          const many = group.steps.length > 1
          const working = busy && gi === groups.length - 1
          const number = many ? `${group.first + 1}–${group.first + group.steps.length}` : String(group.first + 1)
          const lines = many ? group.steps.map((s) => viewStep(s).lines[0]).filter(Boolean) : v.lines
          const count = many ? null : v.count
          return (
            <li key={group.first} className="relative grid grid-cols-[2.25rem_1fr_auto] gap-x-2.5 py-2">
              <span
                className={cn(
                  'relative z-10 mt-0.5 grid h-[1.375rem] min-w-[1.375rem] place-items-center justify-self-center rounded-full bg-card px-1.5 text-[10px] font-medium whitespace-nowrap tabular-nums ring-1',
                  v.kind === 'qloo' ? 'text-primary ring-primary/40' : v.kind === 'replan' || v.kind === 'pick' ? 'bg-primary text-primary-foreground ring-primary' : 'text-muted-foreground ring-border',
                )}
                aria-label={`Step ${number}`}
              >
                {working ? <Spinner className="size-3" /> : number}
              </span>
              <div className="min-w-0">
                <div className={cn('text-[13px] font-medium', v.kind === 'qloo' && 'font-mono text-[12px]')}>
                  {v.title}
                  {many && <span className="ml-1.5 font-sans text-muted-foreground tabular-nums">×{group.steps.length}</span>}
                </div>
                {lines.length > 0 && <div className="text-xs text-pretty text-muted-foreground">{lines.join(' · ')}</div>}
                {many && (
                  <Collapsible>
                    <CollapsibleTrigger className={cn(trigger, 'mt-1')}>
                      <ChevronRightIcon className={chevron} />
                      Results per call
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <ul className="mt-1 flex flex-col text-xs text-muted-foreground tabular-nums">
                        {group.steps.map((s, i) => {
                          const one = viewStep(s)
                          return (
                            <li key={i} className="flex justify-between gap-3">
                              <span className="truncate">{one.lines[0] ?? one.title}</span>
                              <span>{one.count}</span>
                            </li>
                          )
                        })}
                      </ul>
                    </CollapsibleContent>
                  </Collapsible>
                )}
                {!many && v.list && v.list.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger className={cn(trigger, 'mt-1')}>
                      <ChevronRightIcon className={chevron} />
                      {v.list.length} places
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{v.list.join(' · ')}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
              <span className="pt-0.5 text-xs text-muted-foreground tabular-nums">{count ?? ''}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
