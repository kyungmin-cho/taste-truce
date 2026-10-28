import { ArrowRightIcon } from 'lucide-react'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { fmtRank, rankDepth, shortName, worstIndex } from '@/shared/rank'
import type { Person, Result } from '@/shared/types'

const focusRing = 'rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function Hero({ r, previous }: { r: Result; previous?: Result | null }) {
  const pick = r.picks[0]
  const was = previous?.picks[0]
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-primary">Fair pick</span>
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
            Nobody ranks it below <strong className="font-semibold">#{pick.worst_rank}</strong> <span className="text-muted-foreground">of {r.pool_size}</span>
          </>
        )}
      </p>
      {was && was.id !== pick.id && (
        <p data-tt="change" className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
          <span className="truncate line-through">{was.name}</span>
          <ArrowRightIcon className="size-3 shrink-0" aria-label="now" />
          <span className="shrink-0">
            {previous!.pool_size} → {r.pool_size} places
          </span>
        </p>
      )}
    </div>
  )
}

// With taste off: the most popular place nearby, and where the fair pick stands by popularity.
export function PopularHero({ r }: { r: Result }) {
  const top = r.baseline[0]
  const rank = r.contrast.pick_popularity_rank
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-muted-foreground">Most popular nearby</span>
      <h1 className="text-[28px] leading-tight font-semibold tracking-[-0.02em] text-balance">{top?.name ?? 'No popular places'}</h1>
      {top && (
        <p className="truncate text-[13px] text-muted-foreground">
          {top.genre} · {top.address}
        </p>
      )}
      <p className="mt-2 text-[13px] tabular-nums">
        Fair pick <strong className="font-semibold">{r.picks[0].name}</strong>{' '}
        <span className="text-muted-foreground">{rank ? `is #${rank} by popularity` : `is outside the popular top ${r.baseline.length}`}</span>
      </p>
      <p className="text-xs text-muted-foreground tabular-nums">
        {r.overlap} of the popular top {r.contrast.baseline_count} are on the taste shortlist
      </p>
    </div>
  )
}

type Share = { seed: string; score: number }

// A friend's tastes; with Qloo explainability, how much each one counts toward the fair pick's score.
export function FriendName({ person, shares, className }: { person: Person; shares?: Share[]; className?: string }) {
  const total = shares?.reduce((n, x) => n + x.score, 0) ?? 0
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />} className={cn('truncate', focusRing, className)}>
        {person.name}
      </TooltipTrigger>
      <TooltipContent>
        {total > 0 ? (
          <span className="grid grid-cols-[auto_auto] gap-x-3 tabular-nums" data-tt="seed-shares">
            {shares!.map((x) => (
              <span key={x.seed} className="contents">
                <span>{x.seed}</span>
                <span className="text-right">{Math.round((x.score / total) * 100)}%</span>
              </span>
            ))}
          </span>
        ) : (
          person.seeds.map((s) => s.query).join(' · ')
        )}
      </TooltipContent>
    </Tooltip>
  )
}

// Each friend's rank for the fair pick on a 1..pool track; their own #1 sits at the left end.
export function RankMeters({ r }: { r: Result }) {
  const pick = r.picks[0]
  return (
    <section aria-label="Each friend's rank for the fair pick" className="flex flex-col gap-4">
      {r.people.map((person, i) => {
        const rank = pick.ranks[i]
        const seen = pick.observed[i]
        const depth = seen ? rankDepth(rank, r.pool_size) : 0
        const own = r.personal[i]?.[0]
        return (
          <div key={person.name + i} className="grid grid-cols-[7.5rem_1fr] items-center gap-x-3 gap-y-1">
            <FriendName person={person} shares={r.concessions[i]?.contributions} className="text-[13px] font-medium" />
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
            <span className="truncate text-xs text-muted-foreground">Own #1 · {own?.name ?? '—'}</span>
          </div>
        )
      })}
    </section>
  )
}

function compactLabel(label: string, people: Person[]) {
  return people.reduce((text, p) => text.replaceAll(p.name, shortName(p.name)), label)
}

export function RankCell({ rank, worst, observed = true }: { rank: number | null; worst: boolean; observed?: boolean }) {
  return (
    <TableCell className={cn('w-12 text-right tabular-nums', worst ? 'font-semibold text-foreground' : 'text-muted-foreground')}>{fmtRank(rank, observed)}</TableCell>
  )
}

export function FriendHeads({ people }: { people: Person[] }) {
  return (
    <>
      {people.map((p, i) => (
        <TableHead key={p.name + i} className="w-12 text-right text-xs font-medium text-muted-foreground">
          <Tooltip>
            <TooltipTrigger render={<span tabIndex={0} />} className={focusRing}>
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
export function AlternativesTable({ r }: { r: Result }) {
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
