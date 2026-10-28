import { useEffect, useRef } from 'react'
import { ListChecksIcon, TrendingUpIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { worstIndex } from '@/shared/rank'
import type { Place, Result } from '@/shared/types'
import type { Truce } from '@/shared/useTruce'
import { FriendHeads, RankCell } from './Pick'

type Props = { t: Truce; r: Result; popular: boolean; activeId: string | null; setActiveId: (id: string | null) => void }

function Mark({ label, icon: Icon }: { label: string; icon: typeof TrendingUpIcon }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span tabIndex={0} />} className="shrink-0 rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={label}>
        <Icon className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

// The taste shortlist with every friend's rank, or with taste off the popularity top 10.
export function Shortlist({ t, r, popular, activeId, setActiveId }: Props) {
  const shared = new Set(r.contrast.rows.filter((x) => x.change === 'shared').map((x) => x.id))
  const rows: Place[] = popular ? r.baseline : r.picks
  const pickId = r.picks[0]?.id
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())
  useEffect(() => {
    if (activeId) rowRefs.current.get(activeId)?.scrollIntoView({ block: 'nearest' })
  }, [activeId])
  return (
    <Table aria-label={popular ? 'Most popular nearby' : 'Shortlist'}>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="h-8 w-7 text-xs font-medium text-muted-foreground">
            <span className="sr-only">Number</span>
          </TableHead>
          <TableHead className="h-8 text-xs font-medium text-muted-foreground">{popular ? 'By popularity' : 'Place'}</TableHead>
          {!popular && <FriendHeads people={r.people} />}
          <TableHead className="w-9">
            <span className="sr-only">Veto</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody onMouseLeave={() => setActiveId(null)}>
        {rows.map((p, i) => {
          const fair = p.id === pickId
          const ranks = 'ranks' in p ? (p as Result['picks'][number]) : null
          const worst = ranks ? worstIndex(ranks.ranks) : -1
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
                  {shared.has(p.id) && (popular ? <Mark label="Also on the taste shortlist" icon={ListChecksIcon} /> : <Mark label="Also in the popular top 10" icon={TrendingUpIcon} />)}
                </div>
                <div className="truncate text-[11px] text-muted-foreground">{p.genre}</div>
              </TableCell>
              {!popular && ranks && ranks.ranks.map((rank, j) => <RankCell key={j} rank={rank} observed={ranks.observed[j]} worst={j === worst} />)}
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
