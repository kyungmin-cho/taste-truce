import { ListTreeIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { qlooCalls, viewStep } from '@/shared/steps'
import type { Step } from '@/shared/types'
import { cn } from '@/lib/utils'

export function StepsSheet({ steps, busy }: { steps: Step[]; busy: boolean }) {
  const calls = steps.filter((s) => s.tool.startsWith('/')).length
  const max = Math.max(1, ...steps.map((s) => s.count ?? 0))
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline" size="sm" />}>
        <ListTreeIcon data-icon="inline-start" />
        <span className="tnum">
          {steps.length} steps · {calls} Qloo calls
        </span>
      </SheetTrigger>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetHeader className="border-b p-5">
          <SheetTitle>Agent steps</SheetTitle>
          <SheetDescription className="flex flex-wrap gap-1.5 pt-1">
            {qlooCalls(steps).map(([tool, n]) => (
              <Badge key={tool} variant="secondary" className="font-mono tnum">
                {tool} ×{n}
              </Badge>
            ))}
          </SheetDescription>
        </SheetHeader>
        <ScrollArea className="min-h-0 flex-1">
          <ol className="flex flex-col px-5 py-3" aria-busy={busy}>
            {steps.map((step, i) => {
              const v = viewStep(step)
              return (
                <li key={i} className="grid grid-cols-[2rem_1fr_auto] items-baseline gap-x-2 border-b border-border/60 py-2.5 last:border-0">
                  <span className="tnum text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                  <div className="min-w-0">
                    <div className={cn('text-sm font-medium', v.kind === 'qloo' && 'font-mono text-[13px]')}>{v.title}</div>
                    {v.lines.length > 0 && <div className="truncate text-xs text-muted-foreground">{v.lines.join(' · ')}</div>}
                    {v.list && v.list.length > 0 && (
                      <Collapsible>
                        <CollapsibleTrigger className="mt-1 rounded text-xs font-medium text-primary underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                          {v.list.length} places
                        </CollapsibleTrigger>
                        <CollapsibleContent>
                          <p className="pt-1 text-xs leading-relaxed text-muted-foreground">{v.list.join(' · ')}</p>
                        </CollapsibleContent>
                      </Collapsible>
                    )}
                  </div>
                  {v.count !== null ? (
                    <div className="flex w-20 items-center justify-end gap-2" aria-label={`${v.count} returned`}>
                      <span className="h-1.5 rounded-full bg-primary/70" style={{ width: `${Math.max(4, (v.count / max) * 44)}px` }} />
                      <span className="tnum w-6 text-right text-xs text-muted-foreground">{v.count}</span>
                    </div>
                  ) : (
                    <span />
                  )}
                </li>
              )
            })}
          </ol>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
