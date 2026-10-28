import { ArrowRightIcon } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { Toaster } from '@/components/ui/sonner'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { PlaceMap } from '@/shared/PlaceMap'
import { useTruce } from '@/shared/useTruce'
import { Conditions } from './Conditions'
import { Matrix, PopularList } from './Matrix'
import { StepsSheet } from './StepsSheet'

export function App() {
  const t = useTruce()
  const result = t.current
  const pick = result?.picks[0]
  const [mode, setMode] = useState<'taste' | 'popular'>('taste')
  const [limit, setLimit] = useState<number | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const seen = useRef<number | null>(null)

  // Each new result resets the slider to the fair pick's bottleneck.
  useEffect(() => {
    if (pick) setLimit(pick.worst_rank)
    setMode('taste')
  }, [result, pick])

  useEffect(() => {
    const run = t.live
    if (!run || run.id === seen.current || run.preset) return
    if (run.result) {
      seen.current = run.id
      const r = run.result
      toast(`${r.pool_size} places left`, { description: `Fair pick: ${r.picks[0]?.name}` })
    } else if (run.error) {
      seen.current = run.id
      toast.error(run.error)
    }
  }, [t.live])

  const k = limit ?? pick?.worst_rank ?? 1
  const passing = result ? result.picks.filter((p) => p.worst_rank <= k).length : 0
  const mapPlaces = useMemo(() => (result ? (mode === 'taste' ? result.picks : result.baseline) : []), [result, mode])
  const steps = t.live?.steps ?? []
  const prevPick = t.previous?.picks[0]
  const changed = t.previous && result && (prevPick?.id !== pick?.id || t.previous.pool_size !== result.pool_size)
  const expected = Math.max(steps.length + 1, (t.previous?.steps?.length ?? 17) + 1)

  return (
    <TooltipProvider>
      <div data-tt-busy={String(t.busy)} className="min-h-svh">
        <header className="border-b bg-card">
          <div className="mx-auto flex max-w-[1360px] flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6">
            <span className="text-[15px] font-semibold tracking-tight">taste truce</span>
            {t.config && (
              <Tabs
                value={t.preset ?? undefined}
                onValueChange={(v) => t.loadPreset(String(v))}
                className="order-3 w-full overflow-x-auto sm:order-none sm:w-auto"
              >
                <TabsList variant="line">
                  {Object.entries(t.config.presets).map(([id, p]) => (
                    <TabsTrigger key={id} value={id} disabled={t.busy}>
                      {p.label}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </Tabs>
            )}
            <div className="ml-auto flex items-center gap-3">
              <StepsSheet steps={steps} busy={t.busy} />
              <span className="hidden text-xs text-muted-foreground sm:inline">Powered by Qloo</span>
            </div>
          </div>
          {t.busy && (
            <Progress
              value={Math.min(95, (steps.length / expected) * 100)}
              aria-label="Agent progress"
              className="h-0.5 rounded-none [&_[data-slot=progress-track]]:h-0.5 [&_[data-slot=progress-track]]:rounded-none"
            />
          )}
        </header>

        <main className="mx-auto flex max-w-[1360px] flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
          {!result ? (
            <div className="flex flex-col gap-4">
              {t.error ? <p className="text-sm text-destructive">{t.error}</p> : null}
              <Skeleton className="h-10 w-80" />
              <Skeleton className="h-[480px] w-full" />
            </div>
          ) : (
            <>
              <section className="flex flex-wrap items-end justify-between gap-4">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                    <h1 data-tt="pick" className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
                      {pick?.name}
                    </h1>
                    <p className="tnum text-lg text-muted-foreground sm:text-xl">
                      {result.method !== 'rank-sum' ? (
                        <>
                          in everyone’s top <span className="font-semibold text-foreground">{pick?.worst_rank}</span> of {result.pool_size}
                        </>
                      ) : (
                        <>lowest rank sum of {result.pool_size}</>
                      )}
                    </p>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    {pick?.genre} · {pick?.address}
                  </p>
                  {changed && prevPick && (
                    <p className="tnum flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
                      <span className="line-through decoration-muted-foreground/60">{prevPick.name}</span>
                      <ArrowRightIcon className="size-3.5" aria-label="now" />
                      <span className="font-medium text-foreground">{pick?.name}</span>
                      <span className="mx-1 text-border">|</span>
                      {t.previous!.pool_size} <ArrowRightIcon className="size-3.5" aria-label="to" /> {result.pool_size} places
                    </p>
                  )}
                </div>
                <ToggleGroup
                  value={[mode]}
                  onValueChange={(v) => v[0] && setMode(v[0] as 'taste' | 'popular')}
                  variant="outline"
                  size="sm"
                  spacing={0}
                  aria-label="Ranking source"
                >
                  <ToggleGroupItem value="taste">Taste</ToggleGroupItem>
                  <ToggleGroupItem value="popular">Popular</ToggleGroupItem>
                </ToggleGroup>
              </section>

              <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px] lg:grid-rows-[auto_1fr]">
                <Card className="order-2 gap-0 py-0 lg:order-none lg:row-span-2">
                  {mode === 'taste' ? (
                    <>
                      <div className="flex flex-col gap-3 border-b px-4 py-4 sm:flex-row sm:items-center sm:gap-6 sm:px-5">
                        <label htmlFor="limit" className="tnum shrink-0 text-sm font-medium">
                          Nobody below #{k}
                        </label>
                        <Slider
                          id="limit"
                          min={1}
                          max={result.pool_size}
                          value={[k]}
                          onValueChange={(v) => setLimit(Array.isArray(v) ? v[0] : v)}
                          aria-label="Lowest rank allowed for any friend"
                          className="sm:max-w-xs"
                        />
                        <span className="tnum shrink-0 text-sm text-muted-foreground" aria-live="polite">
                          {passing} of {result.picks.length} pass
                        </span>
                      </div>
                      <div className="overflow-x-auto px-1 py-2 sm:px-3">
                        <Matrix result={result} limit={k} activeId={activeId} onActive={setActiveId} onVeto={t.vetoPlace} busy={t.busy} />
                      </div>
                    </>
                  ) : (
                    <div className="overflow-x-auto px-1 py-2 sm:px-3">
                      <PopularList result={result} activeId={activeId} onActive={setActiveId} />
                    </div>
                  )}
                </Card>

                <Card className="isolate order-3 gap-0 overflow-hidden py-0 lg:order-none">
                  <PlaceMap places={mapPlaces} pickId={pick?.id} activeId={activeId} onSelect={setActiveId} className="h-[280px] w-full sm:h-[320px]" />
                </Card>
                <Card className="order-1 gap-3 py-4 lg:order-none">
                  <CardHeader className="sr-only px-4">
                    <CardTitle>Conditions</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4">
                    <Conditions t={t} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </main>
        <footer className="mx-auto max-w-[1360px] px-4 pb-8 text-xs text-muted-foreground sm:hidden">Powered by Qloo</footer>
        <Toaster position="bottom-center" duration={2500} />
      </div>
    </TooltipProvider>
  )
}
