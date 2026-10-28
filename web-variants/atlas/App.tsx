import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react'
import { ChevronRightIcon, CornerDownLeftIcon, TrendingUpIcon, XIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PlaceMap } from '@/shared/PlaceMap'
import { fmtRank, rankDepth, shortName, worstIndex } from '@/shared/rank'
import { qlooCalls, viewStep } from '@/shared/steps'
import type { Person, Result, Step } from '@/shared/types'
import { useTruce, type Truce } from '@/shared/useTruce'

const DESKTOP_PAD: [number, number] = [56, 150]
const PANEL_PAD: [number, number] = [448, 56]

function useMedia(query: string) {
  return useSyncExternalStore(
    (notify) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    () => window.matchMedia(query).matches,
  )
}

type Tab = 'pick' | 'list' | 'agent'

export function App() {
  const t = useTruce()
  const mobile = useMedia('(max-width: 767px)')
  const [tab, setTab] = useState<Tab>('pick')
  const [activeId, setActiveId] = useState<string | null>(null)
  const toasted = useRef(0)
  const result = t.current

  // One toast per finished replan, with the count that changed.
  useEffect(() => {
    const run = t.live
    if (!run || !run.ask || run.id === toasted.current) return
    if (run.error) {
      toasted.current = run.id
      toast.error(run.error)
    } else if (run.result) {
      toasted.current = run.id
      const r = run.result
      toast(`${r.pool_size} places left`, { description: `Fair pick: ${r.picks[0]?.name}` })
    }
  }, [t.live])

  const select = (id: string) => {
    setActiveId(id)
    setTab('list')
  }

  const mobilePad = useMemo<[number, number]>(() => [24, Math.round(window.innerHeight * 0.5) + 24], [])

  return (
    <TooltipProvider>
      <div data-tt-busy={String(t.busy)} className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
        <PlaceMap
          className="absolute inset-0 z-0"
          places={result?.picks ?? []}
          pickId={result?.picks[0]?.id}
          activeId={activeId}
          onSelect={select}
          padding={mobile ? mobilePad : DESKTOP_PAD}
          paddingTopLeft={mobile ? [24, 72] : PANEL_PAD}
        />
        {mobile ? (
          <MobileLayout t={t} tab={tab} setTab={setTab} activeId={activeId} setActiveId={setActiveId} />
        ) : (
          <>
            <aside className="atlas-surface absolute top-4 bottom-4 left-4 z-10 flex w-(--atlas-panel) flex-col overflow-hidden rounded-2xl bg-card">
              <PanelHeader t={t} />
              <PanelTabs t={t} tab={tab} setTab={setTab} activeId={activeId} setActiveId={setActiveId} />
            </aside>
            <div className="pointer-events-none absolute right-6 bottom-6 left-[calc(var(--atlas-panel)+2.5rem)] z-10 flex justify-center">
              <ConditionBar t={t} className="atlas-surface pointer-events-auto w-full max-w-xl rounded-2xl bg-card p-3" />
            </div>
          </>
        )}
        <Toaster position={mobile ? 'top-center' : 'top-right'} duration={2500} />
      </div>
    </TooltipProvider>
  )
}

function PanelHeader({ t }: { t: Truce }) {
  const presets = Object.entries(t.config?.presets ?? {})
  const r = t.current
  return (
    <header className="flex flex-col gap-3 border-b px-5 pt-4 pb-3">
      <div className="flex items-baseline justify-between">
        <a href="./" className="text-[15px] font-semibold tracking-tight">
          taste truce
        </a>
        <span className="text-[11px] text-muted-foreground">Powered by Qloo</span>
      </div>
      <SceneSwitch t={t} presets={presets} />
      {r && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {r.area} · {r.occasion} · within {r.radius / 1000} km · {r.pool_size} candidates
        </p>
      )}
    </header>
  )
}

function SceneSwitch({ t, presets }: { t: Truce; presets: [string, { label: string }][] }) {
  return (
    <ToggleGroup
      aria-label="Scene"
      variant="outline"
      size="sm"
      spacing={0}
      className="w-full"
      value={t.preset ? [t.preset] : []}
      onValueChange={(value: string[]) => value[0] && value[0] !== t.preset && t.loadPreset(value[0])}
      disabled={t.busy}
    >
      {presets.map(([id, p]) => {
        const label = p.label.split(' · ').at(-1) ?? p.label
        return (
          <ToggleGroupItem key={id} value={id} className="flex-1 text-xs capitalize" title={p.label}>
            {label}
          </ToggleGroupItem>
        )
      })}
    </ToggleGroup>
  )
}

type TabProps = { t: Truce; tab: Tab; setTab: (t: Tab) => void; activeId: string | null; setActiveId: (id: string | null) => void }

function stepsOf(t: Truce): Step[] {
  if (t.live && (t.busy || t.live.result) && t.live.steps.length) return t.live.steps
  return t.current?.steps ?? []
}

function PanelTabs({ t, tab, setTab, activeId, setActiveId, compact = false }: TabProps & { compact?: boolean }) {
  const r = t.current
  const steps = stepsOf(t)
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
      <div className="relative border-b px-5">
        <TabsList variant="line" className="h-10 gap-4 p-0">
          {!compact && <TabsTrigger value="pick" className="px-0">Pick</TabsTrigger>}
          <TabsTrigger value="list" className="px-0">
            Shortlist <span className="text-muted-foreground tabular-nums">{r?.picks.length ?? ''}</span>
          </TabsTrigger>
          <TabsTrigger value="agent" className="px-0">
            Agent <span className="text-muted-foreground tabular-nums">{steps.length || ''}</span>
          </TabsTrigger>
          {compact && <TabsTrigger value="pick" className="px-0">Their #1s</TabsTrigger>}
        </TabsList>
        {t.busy && <Progress value={null} aria-label="Agent working" className="absolute inset-x-0 -bottom-px gap-0 *:h-0.5 *:rounded-none" />}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!r ? (
          <PanelSkeleton error={t.error} />
        ) : (
          <>
            <TabsContent value="pick" className="px-5 py-5">
              {compact ? <AlternativesTable r={r} /> : <PickView r={r} />}
            </TabsContent>
            <TabsContent value="list" className="px-2 py-2">
              <Shortlist t={t} r={r} activeId={activeId} setActiveId={setActiveId} />
            </TabsContent>
            <TabsContent value="agent" className="px-5 py-4">
              <AgentSteps steps={steps} busy={t.busy} />
            </TabsContent>
          </>
        )}
      </ScrollArea>
    </Tabs>
  )
}

function PanelSkeleton({ error }: { error: string | null }) {
  if (error) return <p className="p-5 text-sm text-destructive">{error}</p>
  return (
    <div className="flex flex-col gap-3 p-5">
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-8 w-56" />
      <Skeleton className="h-4 w-64" />
      <Skeleton className="mt-4 h-24 w-full" />
    </div>
  )
}

function Hero({ r }: { r: Result }) {
  const pick = r.picks[0]
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] font-medium tracking-wider text-primary uppercase">Fair pick</span>
      <h1 data-tt="pick" className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance">
        {pick.name}
      </h1>
      <p className="truncate text-[13px] text-muted-foreground">
        {pick.genre} · {pick.address}
      </p>
      <p className="mt-2 text-[13px] tabular-nums">
        {r.method === 'rank-sum' ? (
          <>Lowest rank sum of {r.pool_size}</>
        ) : (
          <>
            Nobody ranks it below <strong className="font-semibold">#{pick.worst_rank}</strong>{' '}
            <span className="text-muted-foreground">of {r.pool_size}</span>
          </>
        )}
      </p>
    </div>
  )
}

function PickView({ r }: { r: Result }) {
  return (
    <div className="flex flex-col gap-6">
      <Hero r={r} />
      <RankMeters r={r} />
      <AlternativesTable r={r} />
    </div>
  )
}

function FriendName({ person, className }: { person: Person; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />} className={cn('truncate rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', className)}>
        {person.name}
      </TooltipTrigger>
      <TooltipContent>{person.seeds.map((s) => s.query).join(' · ')}</TooltipContent>
    </Tooltip>
  )
}

// Each friend's rank for the fair pick on a 1..pool track; their own #1 sits at the left end.
function RankMeters({ r }: { r: Result }) {
  const pick = r.picks[0]
  return (
    <section aria-label="Each friend's rank for the fair pick" className="flex flex-col gap-4">
      {r.people.map((person, i) => {
        const rank = pick.ranks[i]
        const seen = pick.observed[i]
        const depth = seen ? rankDepth(rank, r.pool_size) : 0
        const own = r.personal[i]?.[0]
        return (
          <div key={person.name} className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1">
            <FriendName person={person} className="text-[13px] font-medium" />
            <div className="relative h-6" role="img" aria-label={`${person.name}: ${fmtRank(rank, seen)} of ${r.pool_size}`}>
              <div className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-full bg-muted" />
              <div className="absolute top-1/2 left-0 h-1 -translate-y-1/2 rounded-full bg-primary/25" style={{ width: `${depth * 100}%` }} />
              <div className="absolute top-1/2 left-0 size-2 -translate-y-1/2 rounded-full bg-foreground/35" />
              <span
                className="absolute top-1/2 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground tabular-nums"
                style={{ left: `${depth * 100}%`, transform: `translate(-${depth * 100}%, -50%)` }}
              >
                {fmtRank(rank, seen)}
              </span>
            </div>
            <span />
            <span className="truncate text-xs text-muted-foreground">
              Own #1 · {own?.name ?? '—'}
            </span>
          </div>
        )
      })}
    </section>
  )
}

function compactLabel(label: string, people: Person[]) {
  return people.reduce((text, p) => text.replaceAll(p.name, shortName(p.name)), label)
}

function RankCell({ rank, worst, observed = true }: { rank: number | null; worst: boolean; observed?: boolean }) {
  return (
    <TableCell className={cn('w-12 text-right tabular-nums', worst ? 'font-semibold text-foreground' : 'text-muted-foreground')}>
      {fmtRank(rank, observed)}
    </TableCell>
  )
}

function FriendHeads({ people }: { people: Person[] }) {
  return (
    <>
      {people.map((p) => (
        <TableHead key={p.name} className="w-12 text-right text-xs font-medium text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />} className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {shortName(p.name)}
            </TooltipTrigger>
            <TooltipContent>{p.name}</TooltipContent>
          </Tooltip>
        </TableHead>
      ))}
    </>
  )
}

// The places each friend would pick alone, ranked by everyone; the fair pick row is tinted.
function AlternativesTable({ r }: { r: Result }) {
  const rows = r.concession_table.filter((row) => row.ranks.some((x) => x !== null))
  return (
    <Table aria-label="Each friend's rank for the same places">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 pl-0 text-xs font-medium text-muted-foreground">Same places, every rank</TableHead>
          <FriendHeads people={r.people} />
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const worst = worstIndex(row.ranks)
          const fair = row.id === r.picks[0].id
          return (
            <TableRow key={row.id} className={cn(fair && 'bg-accent hover:bg-accent')}>
              <TableCell className="max-w-0 py-2 pl-0 whitespace-normal">
                <div className="truncate text-[13px] font-medium">{row.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{compactLabel(row.label, r.people)}</div>
              </TableCell>
              {row.ranks.map((rank, j) => (
                <RankCell key={j} rank={rank} worst={j === worst} />
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function Shortlist({ t, r, activeId, setActiveId }: { t: Truce; r: Result; activeId: string | null; setActiveId: (id: string | null) => void }) {
  const popular = new Set(r.contrast.rows.filter((x) => x.change === 'shared').map((x) => x.id))
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  useEffect(() => {
    if (activeId) rowRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])
  return (
    <Table aria-label="Shortlist">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 w-7 text-xs font-medium text-muted-foreground">
            <span className="sr-only">Number</span>
          </TableHead>
          <TableHead className="h-8 text-xs font-medium text-muted-foreground">Place</TableHead>
          <FriendHeads people={r.people} />
          <TableHead className="w-9">
            <span className="sr-only">Veto</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody onMouseLeave={() => setActiveId(null)}>
        {r.picks.map((p, i) => {
          const worst = worstIndex(p.ranks)
          const fair = i === 0
          return (
            <TableRow
              key={p.id}
              ref={(node) => {
                if (node) rowRefs.current.set(p.id, node)
              }}
              data-state={p.id === activeId ? 'selected' : undefined}
              onMouseEnter={() => setActiveId(p.id)}
              onFocus={() => setActiveId(p.id)}
              className={cn(fair && 'bg-accent hover:bg-accent')}
            >
              <TableCell className={cn('text-xs tabular-nums', fair ? 'font-semibold text-primary' : 'text-muted-foreground')}>{i + 1}</TableCell>
              <TableCell className="max-w-0 whitespace-normal">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-[13px] font-medium">{p.name}</span>
                  {popular.has(p.id) && (
                    <Tooltip>
                      <TooltipTrigger render={<span tabIndex={0} />} className="shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label="Also in the popular top 10">
                        <TrendingUpIcon className="size-3.5" />
                      </TooltipTrigger>
                      <TooltipContent>Also in the popular top 10</TooltipContent>
                    </Tooltip>
                  )}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{p.genre}</div>
              </TableCell>
              {p.ranks.map((rank, j) => (
                <RankCell key={j} rank={rank} observed={p.observed[j]} worst={j === worst} />
              ))}
              <TableCell className="pr-1">
                <Tooltip>
                  <TooltipTrigger
                    render={<Button variant="ghost" size="icon-sm" aria-label={`Veto ${p.name}`} disabled={t.busy} onClick={() => t.vetoPlace(p.id, p.name)} />}
                  >
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
  )
}

function AgentSteps({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const calls = qlooCalls(steps)
  const total = calls.reduce((n, [, c]) => n + c, 0)
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
        <span>
          <strong className="font-semibold text-foreground">{total}</strong> Qloo calls
        </span>
        {calls.map(([name, n]) => (
          <span key={name} className="font-mono">
            {name} ×{n}
          </span>
        ))}
      </div>
      <ol className="relative flex flex-col">
        <span aria-hidden className="absolute top-2 bottom-2 left-[0.6875rem] w-px bg-border" />
        {steps.map((step, i) => {
          const v = viewStep(step)
          const last = busy && i === steps.length - 1
          return (
            <li key={i} className="relative grid grid-cols-[1.5rem_1fr_auto] gap-x-3 py-2">
              <span
                className={cn(
                  'relative z-10 mt-0.5 grid size-[1.375rem] place-items-center rounded-full bg-card text-[10px] font-medium tabular-nums ring-1',
                  v.kind === 'qloo' ? 'text-primary ring-primary/40' : v.kind === 'replan' || v.kind === 'pick' ? 'bg-primary text-primary-foreground ring-primary' : 'text-muted-foreground ring-border',
                )}
              >
                {last ? <Spinner className="size-3" /> : i + 1}
              </span>
              <div className="min-w-0">
                <div className={cn('text-[13px] font-medium', v.kind === 'qloo' && 'font-mono text-[12px]')}>{v.title}</div>
                {v.lines.length > 0 && <div className="text-xs text-pretty text-muted-foreground">{v.lines.join(' · ')}</div>}
                {v.list && v.list.length > 0 && (
                  <Collapsible>
                    <CollapsibleTrigger className="group mt-1 inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
                      <ChevronRightIcon className="size-3 transition-transform group-data-panel-open:rotate-90" />
                      {v.list.length} places
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{v.list.join(' · ')}</p>
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </div>
              <span className="pt-0.5 text-xs text-muted-foreground tabular-nums">{v.count ?? ''}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

const DEFAULT_ASKS = ['No bars please', 'Somewhere quieter']

function ConditionBar({ t, className }: { t: Truce; className?: string }) {
  const [text, setText] = useState('')
  const r = t.current
  const excluded = !!r && (r.veto.excluded.length > 0 || !!r.veto.no_bars || r.excluded_count > 0)
  const suggestions = r?.suggestions ?? []
  const asks = DEFAULT_ASKS.filter((a) => !suggestions.some((s) => s.label.toLowerCase() === a.toLowerCase()))
  const liveStep = t.busy ? t.live?.steps.at(-1) : undefined

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || t.busy) return
    setText('')
    t.addCondition(value)
  }

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <Button key={s.label} type="button" variant="secondary" size="sm" disabled={t.busy} onClick={() => t.followSuggestion(s)}>
            {s.label}
          </Button>
        ))}
        {asks.map((a) => (
          <Button key={a} type="button" variant="outline" size="sm" disabled={t.busy} onClick={() => t.addCondition(a.toLowerCase())}>
            {a}
          </Button>
        ))}
      </div>
      <InputGroup className="h-11 bg-background">
        <InputGroupInput
          data-tt="condition"
          aria-label="One more condition"
          placeholder="One more condition…"
          autoComplete="off"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!r}
        />
        <InputGroupAddon align="inline-end">
          {excluded && (
            <InputGroupButton type="button" size="sm" className="h-8 px-2.5 text-muted-foreground" disabled={t.busy} onClick={() => t.resetExclusions()} aria-label="Reset exclusions">
              <span className="md:hidden">Reset</span>
              <span className="hidden md:inline">Reset exclusions</span>
            </InputGroupButton>
          )}
          <InputGroupButton type="submit" variant="default" size="sm" className="h-8 px-3" disabled={t.busy || !text.trim()}>
            {t.busy ? <Spinner /> : <CornerDownLeftIcon />}
            Replan
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
      {(liveStep || t.error) && (
        <p role="status" aria-live="polite" className={cn('truncate px-1 text-xs tabular-nums', t.error && !t.busy ? 'text-destructive' : 'text-muted-foreground')}>
          {t.busy && liveStep ? `Step ${t.live?.steps.length} · ${viewStep(liveStep).title}` : t.error}
        </p>
      )}
    </form>
  )
}

function MobileLayout({ t, tab, setTab, activeId, setActiveId }: TabProps) {
  const presets = Object.entries(t.config?.presets ?? {})
  const r = t.current
  const [mobileTab, setMobileTab] = useState<Tab>('list')
  useEffect(() => {
    if (tab === 'list') setMobileTab('list')
  }, [tab])
  return (
    <>
      <div className="atlas-surface absolute inset-x-3 top-3 z-10 flex items-center gap-2 rounded-xl bg-card p-1.5">
        <SceneSwitch t={t} presets={presets} />
      </div>
      <Drawer open modal={false} disablePointerDismissal snapPoints={[0.52, 0.94]} defaultSnapPoint={0.52} showSwipeHandle>
        <DrawerContent className="atlas-surface">
          <DrawerTitle className="sr-only">Fair pick and shortlist</DrawerTitle>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-5 pt-2 pb-4">
              {r ? (
                <>
                  <Hero r={r} />
                  <RankMeters r={r} />
                </>
              ) : (
                <PanelSkeleton error={t.error} />
              )}
              <ConditionBar t={t} />
            </div>
            <div className="flex h-[70dvh] flex-col">
              <PanelTabs
                t={t}
                tab={mobileTab}
                setTab={(v) => {
                  setMobileTab(v)
                  setTab(v)
                }}
                activeId={activeId}
                setActiveId={setActiveId}
                compact
              />
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </>
  )
}
