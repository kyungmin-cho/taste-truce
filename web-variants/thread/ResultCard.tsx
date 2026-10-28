import { ArrowRightIcon, ChevronDownIcon, FlameIcon, XIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { PlaceMap } from '@/shared/PlaceMap'
import { fmtRank, rankDepth, shortName } from '@/shared/rank'
import type { Result } from '@/shared/types'

// Every friend tied at the group's lowest rank is marked, not just the first.
function worstSet(ranks: (number | null)[]) {
  const seen = ranks.filter((r): r is number => r != null)
  const max = seen.length ? Math.max(...seen) : null
  return ranks.map((r) => r != null && r === max)
}

type Props = {
  result: Result
  previous: Result | null
  latest: boolean
  busy: boolean
  onVeto: (id: string, name: string) => void
}

export function ResultCard({ result, previous, latest, busy, onVeto }: Props) {
  const pick = result.picks[0]
  const [active, setActive] = useState<string | null>(null)
  if (!pick) return null
  const worst = worstSet(pick.ranks.map((r, i) => (pick.observed[i] ? r : null)))
  return (
    <Card className="gap-0 overflow-hidden py-0">
      {previous && <Delta from={previous} to={result} />}
      <div className={cn('grid', latest && 'lg:grid-cols-[minmax(0,1fr)_360px]')}>
        <CardContent className="flex min-w-0 flex-col gap-5 p-4 sm:p-6">
          <div className="flex flex-col gap-1">
            <p className="text-xs font-medium tracking-wide text-primary uppercase">Fair pick</p>
            <h2 data-tt={latest ? 'pick' : undefined} className="text-3xl font-semibold tracking-tight text-balance">
              {pick.name}
            </h2>
            <p className="text-sm text-muted-foreground">{[pick.genre, pick.address].filter(Boolean).join(' · ')}</p>
          </div>

          <div className="grid grid-cols-3 gap-3" role="list" aria-label="Each friend's rank for the fair pick">
            {result.people.map((p, i) => (
              <RankMeter
                key={p.name}
                name={p.name}
                rank={pick.observed[i] ? pick.ranks[i] : null}
                pool={result.pool_size}
                bottleneck={worst[i]}
              />
            ))}
          </div>

          {latest && <ConcessionTable result={result} />}
        </CardContent>
        {latest && (
          <div className="relative h-56 min-w-0 border-t lg:h-auto lg:min-h-72 lg:border-t-0 lg:border-l">
            <PlaceMap
              places={result.picks}
              pickId={pick.id}
              activeId={active}
              onSelect={setActive}
              className="absolute inset-0"
              padding={[28, 28]}
            />
          </div>
        )}
      </div>
      {latest && <Shortlist result={result} busy={busy} active={active} setActive={setActive} onVeto={onVeto} />}
    </Card>
  )
}

// The pick and pool before and after this turn, drawn rather than described.
function Delta({ from, to }: { from: Result; to: Result }) {
  const a = from.picks[0]
  const b = to.picks[0]
  const max = Math.max(from.pool_size, to.pool_size)
  return (
    <div className="grid gap-4 border-b bg-muted/60 px-6 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        {a.id === b.id ? (
          <span className="truncate">
            <span className="font-medium">{b.name}</span> <span className="text-muted-foreground">holds</span>
          </span>
        ) : (
          <>
            <span className="truncate text-muted-foreground line-through decoration-1">{a.name}</span>
            <ArrowRightIcon className="size-4 shrink-0 text-primary" aria-label="replaced by" />
            <span className="truncate font-medium">{b.name}</span>
          </>
        )}
      </div>
      <div className="flex items-center gap-3 text-sm tabular" aria-label={`Candidates ${from.pool_size} to ${to.pool_size}`}>
        <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-border">
          <div className="absolute inset-y-0 left-0 rounded-full bg-foreground/25" style={{ width: `${(from.pool_size / max) * 100}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: `${(to.pool_size / max) * 100}%` }} />
        </div>
        <span className="shrink-0 text-muted-foreground">
          {from.pool_size} <span aria-hidden>→</span> <span className="font-semibold text-foreground">{to.pool_size}</span> places
        </span>
      </div>
    </div>
  )
}

function RankMeter({ name, rank, pool, bottleneck }: { name: string; rank: number | null; pool: number; bottleneck: boolean }) {
  const depth = rank == null ? 0 : rankDepth(rank, pool)
  return (
    <div role="listitem" className="flex min-w-0 flex-col gap-2 rounded-lg bg-muted/70 p-3">
      <span className="truncate text-xs font-medium text-muted-foreground">{name}</span>
      <span className={cn('text-2xl font-semibold tabular', bottleneck && 'text-primary')}>
        {fmtRank(rank)}
        <span className="ml-1 text-xs font-normal text-muted-foreground">of {pool}</span>
      </span>
      <div className="relative h-1.5 rounded-full bg-border" aria-hidden>
        <div
          className={cn('absolute inset-y-0 left-0 rounded-full', bottleneck ? 'bg-primary' : 'bg-foreground/60')}
          style={{ width: `${Math.max(3, depth * 100)}%` }}
        />
      </div>
    </div>
  )
}

// Friend columns: the full taste label on wide screens, its first word on phones.
function FriendHead({ name }: { name: string }) {
  return (
    <TableHead className="text-right text-xs">
      <span className="sm:hidden" aria-hidden>
        {shortName(name)}
      </span>
      <span className="max-sm:sr-only">{name}</span>
    </TableHead>
  )
}

function ConcessionTable({ result }: { result: Result }) {
  const rows = result.concession_table.filter((r) => r.ranks.some((x) => x !== null))
  const pickId = result.picks[0].id
  return (
    <Table className="tabular">
      <TableHeader>
        <TableRow>
          <TableHead className="w-full">Who loves what</TableHead>
          {result.people.map((p) => (
            <FriendHead key={p.name} name={p.name} />
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => {
          const w = worstSet(row.ranks)
          const fair = row.id === pickId
          return (
            <TableRow key={row.id + row.label} className={cn(fair && 'bg-accent/60 hover:bg-accent/60')}>
              <TableCell className="max-w-0">
                <div className="truncate font-medium">{row.name}</div>
                <div className="text-xs whitespace-normal text-muted-foreground">{row.label}</div>
              </TableCell>
              {row.ranks.map((r, i) => (
                <TableCell key={i} className={cn('text-right', w[i] && 'font-semibold text-primary')}>
                  {fmtRank(r)}
                </TableCell>
              ))}
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function Shortlist({
  result,
  busy,
  active,
  setActive,
  onVeto,
}: {
  result: Result
  busy: boolean
  active: string | null
  setActive: (id: string | null) => void
  onVeto: (id: string, name: string) => void
}) {
  const popular = new Set(result.contrast.rows.filter((r) => r.change === 'shared').map((r) => r.id))
  return (
    <Collapsible className="border-t">
      <CollapsibleTrigger
        render={
          <Button variant="ghost" className="group/sl h-11 w-full justify-between rounded-none px-6 text-sm font-medium" />
        }
      >
        <span>The {result.picks.length} places</span>
        <ChevronDownIcon className="transition-transform group-aria-expanded/sl:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="px-3 pb-3">
          <Table className="tabular">
            <TableHeader>
              <TableRow>
                <TableHead className="w-10 text-right">#</TableHead>
                <TableHead className="w-full">Place</TableHead>
                {result.people.map((p) => (
                  <FriendHead key={p.name} name={p.name} />
                ))}
                <TableHead>
                  <span className="sr-only">Veto</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.picks.map((e, i) => {
                const w = worstSet(e.ranks.map((r, j) => (e.observed[j] ? r : null)))
                return (
                  <TableRow
                    key={e.id}
                    data-state={active === e.id ? 'selected' : undefined}
                    onMouseEnter={() => setActive(e.id)}
                    onMouseLeave={() => setActive(null)}
                  >
                    <TableCell className="text-right text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="max-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate font-medium">{e.name}</span>
                        {popular.has(e.id) && (
                          <Tooltip>
                            <TooltipTrigger
                              render={<span tabIndex={0} className="inline-flex rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" />}
                            >
                              <FlameIcon className="size-3.5" aria-label="In the popular top 10" />
                            </TooltipTrigger>
                            <TooltipContent>In the popular top 10</TooltipContent>
                          </Tooltip>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{e.genre}</div>
                    </TableCell>
                    {e.ranks.map((r, j) => (
                      <TableCell key={j} className={cn('text-right', w[j] && 'font-semibold text-primary')}>
                        {fmtRank(r, e.observed[j])}
                      </TableCell>
                    ))}
                    <TableCell>
                      <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Veto ${e.name}`} onClick={() => onVeto(e.id, e.name)}>
                        <XIcon />
                      </Button>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
