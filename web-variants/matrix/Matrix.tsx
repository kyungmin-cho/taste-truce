import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { HoverCard, HoverCardContent, HoverCardTrigger } from '@/components/ui/hover-card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { rankDepth, worstIndex } from '@/shared/rank'
import type { Person, Result } from '@/shared/types'

// One pale band so ink text holds 4.5:1 on every cell: a friend's #1 is the
// most saturated teal, the last place in the pool is nearly white.
function heat(d: number) {
  return `oklch(${(0.72 + d * 0.25).toFixed(3)} ${(0.085 - d * 0.075).toFixed(3)} 200)`
}

type Row = { id: string; name: string; meta: string; ranks: (number | null)[]; worst: number; vetoable: boolean; n: number | null }

function FriendHead({ person }: { person: Person }) {
  return (
    <HoverCard>
      <HoverCardTrigger
        delay={150}
        render={
          <button
            type="button"
            className="w-full rounded px-1 text-center text-xs font-semibold text-foreground underline decoration-border decoration-dotted underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          />
        }
      >
        {person.name}
      </HoverCardTrigger>
      <HoverCardContent className="w-56">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
          {person.seeds.map((s) => (
            <div key={s.query} className="contents">
              <dt className="text-muted-foreground capitalize">{s.type.replace('_', ' ')}</dt>
              <dd className="font-medium">{s.query}</dd>
            </div>
          ))}
        </dl>
      </HoverCardContent>
    </HoverCard>
  )
}

function RankCell({
  rank,
  pool,
  person,
  place,
  worst,
  fail,
}: {
  rank: number | null
  pool: number
  person: string
  place: string
  worst: boolean
  fail: boolean
}) {
  if (rank == null)
    return (
      <TableCell className="p-0.5">
        <div className="grid h-10 place-items-center rounded-md bg-muted text-sm text-muted-foreground" aria-label={`${person}: no rank for ${place}`}>
          —
        </div>
      </TableCell>
    )
  const bg = heat(rankDepth(rank, pool))
  const label = `${person} ranks ${place} #${rank} of ${pool}`
  return (
    <TableCell className="p-0.5">
      <Tooltip>
        <TooltipTrigger
          render={
            <div
              tabIndex={0}
              aria-label={label}
              data-worst={worst}
              data-fail={fail}
              style={fail ? undefined : { background: bg }}
              className="heat tnum grid h-10 place-items-center rounded-md text-sm font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            />
          }
        >
          #{rank}
        </TooltipTrigger>
        <TooltipContent>{label}</TooltipContent>
      </Tooltip>
    </TableCell>
  )
}

type Props = {
  result: Result
  limit: number
  activeId: string | null
  onActive: (id: string | null) => void
  onVeto: (id: string, name: string) => void
  busy: boolean
}

export function Matrix({ result, limit, activeId, onActive, onVeto, busy }: Props) {
  const pool = result.pool_size
  const pickId = result.picks[0]?.id
  const shortlist: Row[] = result.picks.map((p, i) => ({
    id: p.id,
    name: p.name,
    meta: p.genre,
    ranks: p.ranks.map((r, j) => (p.observed[j] ? r : null)),
    worst: p.worst_rank,
    vetoable: true,
    n: i + 1,
  }))
  const ids = new Set(shortlist.map((r) => r.id))
  const outside: Row[] = result.concession_table
    .filter((row) => !ids.has(row.id) && row.ranks.some((r) => r !== null))
    .map((row) => ({ id: row.id, name: row.name, meta: row.label, ranks: row.ranks, worst: row.worst_rank, vetoable: false, n: null }))
  const cols = result.people.length

  const renderRow = (row: Row) => {
    const pick = row.id === pickId
    const worst = worstIndex(row.ranks)
    return (
      <TableRow
        key={row.id}
        data-pick={pick}
        onMouseEnter={() => onActive(row.id)}
        onMouseLeave={() => onActive(null)}
        className={cn(
          'row-fade border-0 hover:bg-transparent',
          pick && 'bg-accent/70 hover:bg-accent/70 [&>td:first-child]:rounded-l-lg [&>td:last-child]:rounded-r-lg',
          activeId === row.id && !pick && 'bg-muted/70 hover:bg-muted/70',
        )}
      >
        <TableCell className="tnum hidden w-8 pl-3 text-xs text-muted-foreground sm:table-cell">{row.n ? String(row.n).padStart(2, '0') : ''}</TableCell>
        <TableCell className="max-w-[112px] py-1.5 pl-2 sm:max-w-none sm:pl-2">
          <div className={cn('truncate text-sm', pick ? 'font-semibold' : 'font-medium')}>{row.name}</div>
          <div className="hidden truncate text-xs text-muted-foreground sm:block">{row.meta}</div>
        </TableCell>
        {row.ranks.map((r, j) => (
          <RankCell
            key={j}
            rank={r}
            pool={pool}
            person={result.people[j]?.name ?? ''}
            place={row.name}
            worst={j === worst && row.ranks.filter((x) => x != null).length > 1}
            fail={r != null && r > limit}
          />
        ))}
        <TableCell className="tnum hidden w-14 text-right text-sm sm:table-cell">
          <span className={cn(pick ? 'font-semibold text-foreground' : 'text-muted-foreground')}>#{row.worst}</span>
        </TableCell>
        <TableCell className="w-10 pr-2">
          {row.vetoable && (
            <Tooltip>
              <TooltipTrigger
                render={<Button variant="ghost" size="icon-sm" aria-label={`Veto ${row.name}`} disabled={busy} onClick={() => onVeto(row.id, row.name)} />}
              >
                <XIcon />
              </TooltipTrigger>
              <TooltipContent>Veto {row.name}</TooltipContent>
            </Tooltip>
          )}
        </TableCell>
      </TableRow>
    )
  }

  return (
    <Table className="min-w-[340px] border-separate border-spacing-y-0.5 sm:min-w-[520px]">
      <TableHeader className="[&_tr]:border-0">
        <TableRow className="hover:bg-transparent">
          <TableHead className="hidden w-8 sm:table-cell" />
          <TableHead className="pl-2 text-xs">Place</TableHead>
          {result.people.map((p) => (
            <TableHead key={p.name} className="w-[18%] px-0.5 text-center">
              <FriendHead person={p} />
            </TableHead>
          ))}
          <TableHead className="hidden w-14 text-right text-xs sm:table-cell">
            <Tooltip>
              <TooltipTrigger render={<span tabIndex={0} className="cursor-help underline decoration-dotted underline-offset-4" />}>Worst</TooltipTrigger>
              <TooltipContent>The lowest rank any friend gives this place</TooltipContent>
            </Tooltip>
          </TableHead>
          <TableHead className="w-10" />
        </TableRow>
      </TableHeader>
      <TableBody>
        {shortlist.map(renderRow)}
        {outside.length > 0 && (
          <>
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={cols + 4} className="pt-5 pb-1 pl-2 sm:pl-3 text-xs font-medium text-muted-foreground">
                Each friend’s own #1
              </TableCell>
            </TableRow>
            {outside.map(renderRow)}
          </>
        )}
      </TableBody>
    </Table>
  )
}

export function PopularList({ result, activeId, onActive }: { result: Result; activeId: string | null; onActive: (id: string | null) => void }) {
  const taste = new Set(result.picks.map((p) => p.id))
  return (
    <Table className="min-w-[360px]">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-8" />
          <TableHead className="text-xs">Most popular nearby</TableHead>
          <TableHead className="w-40 text-right text-xs">On the taste shortlist</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {result.baseline.map((p, i) => (
          <TableRow key={p.id} onMouseEnter={() => onActive(p.id)} onMouseLeave={() => onActive(null)} className={cn(activeId === p.id && 'bg-muted/70')}>
            <TableCell className="tnum pl-3 text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</TableCell>
            <TableCell>
              <div className="text-sm font-medium">{p.name}</div>
              <div className="text-xs text-muted-foreground">{p.genre}</div>
            </TableCell>
            <TableCell className="text-right text-sm">
              {taste.has(p.id) ? <span className="font-medium text-primary">Yes</span> : <span className="text-muted-foreground">No</span>}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}
