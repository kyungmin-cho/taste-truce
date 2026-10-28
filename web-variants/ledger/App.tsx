import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowRightIcon, CheckIcon, ChevronRightIcon, CornerDownLeftIcon, RotateCcwIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PlaceMap } from '@/shared/PlaceMap'
import { fmtRank, rankDepth, worstSet } from '@/shared/rank'
import { qlooCalls, viewStep } from '@/shared/steps'
import type { Person, Result, Step } from '@/shared/types'
import { useTruce, type Truce } from '@/shared/useTruce'

const STARTERS = ['No bars please', 'Somewhere quieter']

export function App() {
  const t = useTruce()
  const result = t.current
  const announced = useRef<number | null>(null)

  // One toast per finished replan, saying what the condition changed.
  useEffect(() => {
    const run = t.live
    if (!run || !run.ask || !run.result || announced.current === run.id) return
    announced.current = run.id
    const before = t.previous
    toast(`${run.result.pool_size} places left`, {
      description: before && before.picks[0]?.id !== run.result.picks[0]?.id ? `${before.picks[0].name} → ${run.result.picks[0].name}` : undefined,
    })
  }, [t.live, t.previous])

  return (
    <div data-tt-busy={String(t.busy)} className="min-h-dvh bg-background text-foreground">
      <header className="sticky top-0 z-20 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex max-w-[1440px] flex-wrap items-center gap-x-6 px-4 sm:h-14 sm:flex-nowrap sm:px-6">
          <a href="./" className="flex h-12 items-center font-heading text-[15px] font-semibold tracking-tight whitespace-nowrap sm:h-auto">
            taste truce
          </a>
          {t.config && (
            <Tabs className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:order-none sm:mx-0 sm:w-auto sm:px-0" value={t.preset ?? undefined} onValueChange={(v) => v && v !== t.preset && t.loadPreset(String(v))}>
              <TabsList variant="line" aria-label="Scene">
                {Object.entries(t.config.presets).map(([id, p]) => (
                  <TabsTrigger key={id} value={id} disabled={t.busy}>
                    {p.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
          )}
          <span className="ml-auto text-xs whitespace-nowrap text-muted-foreground">Powered by Qloo</span>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1440px] gap-x-10 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-8 py-8">
          {result ? <Verdict result={result} previous={t.previous} /> : <VerdictSkeleton error={t.error} />}
          {result && (
            <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
              <PlaceMap
                places={result.picks}
                pickId={result.picks[0]?.id}
                className="h-[260px] overflow-hidden sm:h-[340px] rounded-xl ring-1 ring-border"
              />
              <WhoGivesUp result={result} />
            </section>
          )}
          {result && <Conditions t={t} result={result} />}
          {result && <Shortlist t={t} result={result} />}
        </div>
        <AgentRail t={t} />
      </main>
    </div>
  )
}

// The question the page answers: where do we go, and what does each friend give up.
function Verdict({ result, previous }: { result: Result; previous: Result | null }) {
  const pick = result.picks[0]
  const changed = previous && previous.picks[0]?.id !== pick.id
  return (
    <section aria-labelledby="pick" className="grid items-end gap-8 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Fair pick · {result.area.replace(' NYC', '')} · Fri 7 p.m.
        </p>
        <h1 id="pick" data-tt="pick" className="mt-2 font-heading text-4xl sm:text-5xl leading-none font-semibold tracking-[-0.03em] text-balance">
          {pick.name}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          {pick.genre} · {pick.address}
        </p>
        {changed && (
          <p className="mt-3 inline-flex items-center gap-2 text-sm text-muted-foreground">
            <s className="decoration-muted-foreground/60">{previous.picks[0].name}</s>
            <ArrowRightIcon className="size-3.5" aria-hidden />
            <span className="text-foreground">{pick.name}</span>
            <span className="tabular-nums">
              · {previous.pool_size} → {result.pool_size} places
            </span>
          </p>
        )}
      </div>
      <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl bg-border ring-1 ring-border">
        {result.people.map((person, i) => (
          <FriendRank key={person.name} person={person} rank={pick.ranks[i]} observed={pick.observed[i]} pool={result.pool_size} worst={worstSet(pick.ranks).has(i)} />
        ))}
      </div>
    </section>
  )
}

// One friend's rank for the fair pick, on a track from their #1 to the last candidate.
function FriendRank({ person, rank, observed, pool, worst }: { person: Person; rank: number; observed: boolean; pool: number; worst: boolean }) {
  const at = rankDepth(rank, pool)
  return (
    <div className="flex min-w-0 flex-col gap-3 bg-card p-3 sm:w-44 sm:p-4">
      <FriendName person={person} className="truncate text-xs text-muted-foreground" />
      <p className="flex items-baseline gap-1.5 tabular-nums">
        <span className={cn('text-3xl font-semibold tracking-tight', worst && 'text-primary')}>{fmtRank(rank, observed)}</span>
        <span className="text-xs text-muted-foreground">of {pool}</span>
      </p>
      <div className="relative h-1.5 rounded-full bg-muted" aria-hidden>
        <div className={cn('absolute inset-y-0 left-0 rounded-full', worst ? 'bg-primary' : 'bg-foreground/70')} style={{ width: `max(6px, ${at * 100}%)` }} />
      </div>
    </div>
  )
}

function FriendName({ person, className }: { person: Person; className?: string }) {
  return (
    <HoverCard>
      <HoverCardTrigger render={<button type="button" className={cn('w-fit rounded-sm text-left underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none', className)} />}>
        {person.name}
      </HoverCardTrigger>
      <HoverCardContent className="w-60">
        <p className="text-sm font-medium">{person.name}</p>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          {person.seeds.map((s) => (
            <div key={s.query} className="contents">
              <dt className="text-muted-foreground capitalize">{s.type.replace('_', ' ')}</dt>
              <dd>{s.query}</dd>
            </div>
          ))}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}

// Each friend's own #1 next to the fair pick: the cost of a compromise, cell by cell.
function WhoGivesUp({ result }: { result: Result }) {
  const rows = result.concession_table.filter((row) => row.ranks.some((r) => r !== null))
  const pickId = result.picks[0]?.id
  return (
    <div className="min-w-0 self-start">
      <h2 className="mb-2 text-sm font-medium">Who gives up what</h2>
      <Table className="table-fixed">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-[44%]">
              <span className="sr-only">Place</span>
            </TableHead>
            {result.people.map((p) => (
              <TableHead key={p.name} className="text-center text-xs font-normal whitespace-normal text-muted-foreground">
                {p.name}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const worst = worstSet(row.ranks)
            return (
              <TableRow key={row.id} className={cn('hover:bg-transparent', row.id === pickId && 'bg-accent/60')}>
                <TableCell className="py-2.5 whitespace-normal">
                  <span className="block truncate font-medium">{row.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{row.label}</span>
                </TableCell>
                {row.ranks.map((r, i) => (
                  <TableCell key={i} className="p-1">
                    <HeatCell rank={r} pool={result.pool_size} worst={worst.has(i)} label={`${result.people[i].name} ranks ${row.name} ${fmtRank(r)} of ${result.pool_size}`} />
                  </TableCell>
                ))}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

// Closer to a friend's #1 = deeper tint. The row's worst rank is set in the accent.
function HeatCell({ rank, pool, worst, label }: { rank: number | null; pool: number; worst?: boolean; label: string }) {
  const depth = rank == null ? 1 : rankDepth(rank, pool)
  return (
    <span
      aria-label={label}
      className={cn('flex h-9 items-center justify-center rounded-md text-sm tabular-nums', worst ? 'font-semibold text-primary' : 'text-foreground')}
      style={{ background: rank == null ? 'transparent' : `color-mix(in oklch, var(--heat) ${Math.round((1 - depth) ** 2 * 15 + 2)}%, var(--card))` }}
    >
      {fmtRank(rank)}
    </span>
  )
}

function Conditions({ t, result }: { t: Truce; result: Result }) {
  const [text, setText] = useState('')
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || t.busy) return
    setText('')
    t.addCondition(value)
  }
  const excluded = result.veto.excluded.length > 0 || Boolean(result.veto.no_bars) || result.excluded_count > 0
  return (
    <section aria-label="Add a condition" className="flex flex-col gap-3">
      <form onSubmit={submit}>
        <InputGroup className="h-12 bg-card">
          <InputGroupInput
            data-tt="condition"
            aria-label="One more condition"
            placeholder="One more condition…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={t.busy}
            className="text-base"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" size="sm" variant="default" disabled={t.busy || !text.trim()}>
              {t.busy ? <Spinner data-icon="inline-start" /> : <CornerDownLeftIcon data-icon="inline-start" />}
              Replan
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
      <div className="flex flex-wrap items-center gap-2">
        {STARTERS.map((label) => (
          <Button key={label} size="sm" variant="outline" disabled={t.busy} onClick={() => t.addCondition(label.toLowerCase())}>
            {label}
          </Button>
        ))}
        {(result.suggestions ?? []).map((s) => (
          <Button key={s.label} size="sm" variant="outline" disabled={t.busy} onClick={() => t.followSuggestion(s)}>
            {s.label}
          </Button>
        ))}
        {excluded && (
          <Button size="sm" variant="ghost" disabled={t.busy} onClick={() => t.resetExclusions()} className="ml-auto text-muted-foreground">
            <RotateCcwIcon data-icon="inline-start" />
            Reset exclusions
          </Button>
        )}
      </div>
    </section>
  )
}

function Shortlist({ t, result }: { t: Truce; result: Result }) {
  const popular = useMemo(() => new Set(result.contrast.rows.filter((r) => r.change === 'shared').map((r) => r.id)), [result])
  return (
    <section aria-labelledby="shortlist">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 id="shortlist" className="text-sm font-medium">
          Shortlist
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">top 10 of {result.pool_size}</span>
      </div>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-10 text-right">#</TableHead>
            <TableHead>Place</TableHead>
            <TableHead className="w-12 text-center">
              <Tooltip>
                <TooltipTrigger render={<span tabIndex={0} className="cursor-default rounded-sm text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" />}>Pop.</TooltipTrigger>
                <TooltipContent>Also in the popularity top 10</TooltipContent>
              </Tooltip>
            </TableHead>
            {result.people.map((p) => (
              <TableHead key={p.name} className="w-28 text-center text-xs font-normal text-muted-foreground">
                {p.name}
              </TableHead>
            ))}
            <TableHead className="w-12">
              <span className="sr-only">Veto</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {result.picks.map((place, n) => {
            const worst = worstSet(place.ranks)
            return (
              <TableRow key={place.id} className={cn(n === 0 && 'bg-accent/60 hover:bg-accent/60')}>
                <TableCell className="text-right text-muted-foreground tabular-nums">{n + 1}</TableCell>
                <TableCell className="max-w-0">
                  <span className="font-medium">{place.name}</span>
                  <span className="ml-2 truncate text-muted-foreground">{place.genre}</span>
                </TableCell>
                <TableCell className="text-center">{popular.has(place.id) && <CheckIcon className="mx-auto size-4 text-muted-foreground" aria-label="In the popularity top 10" />}</TableCell>
                {place.ranks.map((r, i) => (
                  <TableCell key={i} className="p-1">
                    <HeatCell rank={place.observed[i] ? r : null} pool={result.pool_size} worst={worst.has(i)} label={`${result.people[i].name} ranks ${place.name} ${fmtRank(r, place.observed[i])}`} />
                  </TableCell>
                ))}
                <TableCell className="text-right">
                  <Tooltip>
                    <TooltipTrigger render={<Button size="icon-sm" variant="ghost" aria-label={`Veto ${place.name}`} disabled={t.busy} onClick={() => t.vetoPlace(place.id, place.name)} />}>
                      <XIcon />
                    </TooltipTrigger>
                    <TooltipContent>Veto</TooltipContent>
                  </Tooltip>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </section>
  )
}

// The agent's work for the result on screen (or the run in progress), one tool call per row.
function AgentRail({ t }: { t: Truce }) {
  const run = t.busy ? t.live : [...t.runs].reverse().find((r) => r.result)
  const steps = run?.steps ?? []
  const max = Math.max(1, ...steps.map((s) => s.count ?? 0))
  const calls = qlooCalls(steps).reduce((n, [, c]) => n + c, 0)
  const end = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (t.busy) end.current?.scrollIntoView({ block: 'nearest' })
  }, [steps.length, t.busy])
  return (
    <aside aria-labelledby="agent" className="border-t py-8 lg:sticky lg:top-14 lg:max-h-[calc(100dvh-3.5rem)] lg:self-start lg:overflow-y-auto lg:border-t-0 lg:border-l lg:pl-8">
      <div className="flex items-baseline justify-between">
        <h2 id="agent" className="text-sm font-medium">
          Agent
        </h2>
        <span className="text-xs text-muted-foreground tabular-nums">
          {steps.length} steps · {calls} Qloo calls
        </span>
      </div>
      {run?.ask && (
        <p className="mt-3 rounded-md bg-muted px-3 py-2 text-sm">
          “{run.ask}”
        </p>
      )}
      <ol className="mt-4 flex flex-col">
        {steps.length === 0 && Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="my-2 h-8" />)}
        {steps.map((step, i) => (
          <StepRow key={i} n={i + 1} step={step} max={max} live={t.busy && i === steps.length - 1} />
        ))}
        <li ref={end} aria-hidden />
      </ol>
    </aside>
  )
}

function StepRow({ n, step, max, live }: { n: number; step: Step; max: number; live: boolean }) {
  const v = viewStep(step)
  const qloo = v.kind === 'qloo'
  return (
    <li className="grid grid-cols-[24px_minmax(0,1fr)_auto] gap-x-2 border-b border-border/60 py-2 text-sm last:border-0">
      <span className="pt-px text-xs text-muted-foreground tabular-nums">{n}</span>
      <div className="min-w-0">
        <p className={cn('truncate', qloo ? 'font-mono text-[13px]' : 'font-medium', v.kind === 'pick' && 'text-primary')}>{v.title}</p>
        {v.lines.length > 0 && <p className="truncate text-xs text-muted-foreground">{v.lines.join(' · ')}</p>}
        {v.list && v.list.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="group mt-1 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
              <ChevronRightIcon className="size-3 transition-transform group-data-[panel-open]:rotate-90" aria-hidden />
              {v.list.length} places
            </CollapsibleTrigger>
            <CollapsibleContent>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">{v.list.join(' · ')}</p>
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      <div className="flex w-14 flex-col items-end gap-1 pt-0.5">
        {live ? (
          <Spinner className="size-3.5 text-muted-foreground" />
        ) : v.count != null ? (
          <>
            <span className="text-xs tabular-nums">{v.count}</span>
            <span className="h-1 w-full rounded-full bg-muted" aria-hidden>
              <span className="block h-full rounded-full bg-foreground/40" style={{ width: `${(v.count / max) * 100}%` }} />
            </span>
          </>
        ) : (
          v.kind === 'pick' && <Badge variant="secondary">pick</Badge>
        )}
      </div>
    </li>
  )
}

function VerdictSkeleton({ error }: { error: string | null }) {
  if (error) return <p className="text-sm text-destructive">{error}</p>
  return (
    <div className="flex flex-col gap-3">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-12 w-96" />
      <Skeleton className="h-4 w-72" />
    </div>
  )
}
