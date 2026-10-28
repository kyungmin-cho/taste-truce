import { ArrowUpIcon, RotateCcwIcon } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Bubble, BubbleContent } from '@/components/ui/bubble'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Marker, MarkerContent } from '@/components/ui/marker'
import { Message, MessageContent } from '@/components/ui/message'
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from '@/components/ui/message-scroller'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { TooltipProvider } from '@/components/ui/tooltip'
import { useTruce, type Run } from '@/shared/useTruce'
import type { Result } from '@/shared/types'
import { ResultCard } from './ResultCard'
import { RunTrace } from './RunTrace'

const PROMPTS = ['No bars please', 'Somewhere quieter']

export function App() {
  const t = useTruce()
  const finished = t.runs.filter((r) => r.result)
  const latestResultRun = finished.at(-1)

  return (
    <TooltipProvider>
      <div data-tt-busy={String(t.busy)} className="flex h-dvh flex-col">
        <header className="flex h-14 shrink-0 items-center gap-4 border-b px-4 sm:px-6">
          <a href="./" className="shrink-0 text-[15px] font-semibold tracking-tight whitespace-nowrap">
            taste truce
          </a>
          {t.config && (
            <ToggleGroup
              aria-label="Scene"
              value={t.preset ? [t.preset] : []}
              onValueChange={(v: string[]) => v[0] && v[0] !== t.preset && t.loadPreset(v[0])}
              disabled={t.busy}
              size="sm"
              className="min-w-0 overflow-x-auto"
            >
              {Object.entries(t.config.presets).map(([id, p]) => (
                <ToggleGroupItem key={id} value={id} className="px-2.5 whitespace-nowrap">
                  {p.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <span className="ml-auto hidden shrink-0 text-xs text-muted-foreground sm:inline">Powered by Qloo</span>
        </header>

        <MessageScrollerProvider autoScroll>
          <MessageScroller className="flex-1">
            <MessageScrollerViewport>
              <MessageScrollerContent className="mx-auto w-full max-w-[1240px] gap-5 px-4 py-5 sm:px-6">
                {!t.runs.length && !t.error && <Pending />}
                {t.runs.map((run, i) => {
                  const prev = t.runs.slice(0, i).filter((r) => r.result).at(-1)?.result ?? null
                  return (
                    <Turn
                      key={run.id}
                      run={run}
                      index={i}
                      previous={prev}
                      latest={run === latestResultRun}
                      live={t.busy && run === t.runs.at(-1)}
                      busy={t.busy}
                      onVeto={t.vetoPlace}
                    />
                  )
                })}
                {t.error && !t.runs.some((r) => r.error) && (
                  <Bubble variant="destructive">
                    <BubbleContent>{t.error}</BubbleContent>
                  </Bubble>
                )}
              </MessageScrollerContent>
            </MessageScrollerViewport>
            <MessageScrollerButton />
          </MessageScroller>
        </MessageScrollerProvider>

        <Composer t={t} />
      </div>
    </TooltipProvider>
  )
}

function Turn({
  run,
  index,
  previous,
  latest,
  live,
  busy,
  onVeto,
}: {
  run: Run
  index: number
  previous: Result | null
  latest: boolean
  live: boolean
  busy: boolean
  onVeto: (id: string, name: string) => void
}) {
  const scene = run.result ?? previous
  return (
    <>
      {index > 0 && (
        <MessageScrollerItem messageId={`marker-${run.id}`}>
          <Marker variant="separator">
            <MarkerContent className="text-xs">Turn {index + 1}</MarkerContent>
          </Marker>
        </MessageScrollerItem>
      )}
      <MessageScrollerItem messageId={`ask-${run.id}`} scrollAnchor>
        <Message align="end">
          <MessageContent>
            {run.ask ? (
              <Bubble variant="default" align="end">
                <BubbleContent className="px-4 text-[15px]">{run.ask}</BubbleContent>
              </Bubble>
            ) : (
              scene && <SceneBubble result={scene} />
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
      <MessageScrollerItem messageId={`reply-${run.id}`}>
        <Message align="start">
          <MessageContent className="gap-4">
                        <div className="grid items-start gap-6 lg:grid-cols-[264px_minmax(0,1fr)]">
              <div className="lg:sticky lg:top-4">
                {run.steps.length > 0 ? (
                  <RunTrace steps={run.steps} live={live && !run.result} />
                ) : (
                  live && (
                    <span className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Spinner /> Planning
                    </span>
                  )
                )}
              </div>
              {run.result && <ResultCard result={run.result} previous={previous} latest={latest} busy={busy} onVeto={onVeto} />}
              {live && !run.result && <Skeleton className="h-80 w-full rounded-xl" />}
            </div>
            {run.error && (
              <Bubble variant="destructive">
                <BubbleContent>{run.error}</BubbleContent>
              </Bubble>
            )}
          </MessageContent>
        </Message>
      </MessageScrollerItem>
    </>
  )
}

// The opening turn: who is coming, where and when. A grid, one column per friend.
function SceneBubble({ result }: { result: Result }) {
  const area = result.area.replace(/ NYC$/, '')
  return (
    <Card className="w-full max-w-[640px] gap-0 self-end bg-secondary py-0 ring-0">
      <CardContent className="flex flex-col gap-2.5 p-3.5">
        <p className="text-sm font-medium">
          {area} · Fri 7 p.m. · {result.occasion}
        </p>
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${result.people.length}, minmax(0, 1fr))` }}>
          {result.people.map((p) => (
            <div key={p.name} className="flex min-w-0 flex-col gap-0.5 rounded-lg bg-card p-2.5">
              <span className="truncate text-xs font-semibold">{p.name}</span>
              <span className="truncate text-xs text-muted-foreground">{p.seeds.map((s) => s.query).join(' · ')}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function Pending() {
  return (
    <div className="flex flex-col gap-4">
      <Skeleton className="ml-auto h-24 w-full max-w-[640px] rounded-xl" />
      <Skeleton className="h-5 w-48" />
      <Skeleton className="h-80 w-full rounded-xl" />
    </div>
  )
}

function Composer({ t }: { t: ReturnType<typeof useTruce> }) {
  const [text, setText] = useState('')
  const current = t.current
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || t.busy || !current) return
    setText('')
    t.addCondition(value)
  }
  const excluded = !!current && (current.veto.excluded.length > 0 || !!current.veto.no_bars)
  return (
    <div className="shrink-0 border-t bg-background/95 px-4 pt-3 pb-4 sm:px-6">
      <form onSubmit={submit} className="mx-auto flex w-full max-w-[1240px] flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          {PROMPTS.map((p) => (
            <Button key={p} type="button" variant="outline" size="sm" disabled={t.busy || !current} onClick={() => t.addCondition(p)}>
              {p}
            </Button>
          ))}
          {(current?.suggestions ?? []).map((s) => (
            <Button key={s.label} type="button" variant="outline" size="sm" disabled={t.busy} onClick={() => t.followSuggestion(s)}>
              {s.label}
            </Button>
          ))}
          {excluded && (
            <Button type="button" variant="ghost" size="sm" disabled={t.busy} onClick={() => t.resetExclusions()}>
              <RotateCcwIcon data-icon="inline-start" />
              Reset exclusions
            </Button>
          )}
        </div>
        <InputGroup className="h-11 bg-card">
          <InputGroupInput
            data-tt="condition"
            aria-label="One more condition"
            placeholder="One more condition…"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!current}
            autoComplete="off"
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton type="submit" variant="default" size="icon-sm" disabled={t.busy || !text.trim()} aria-label="Replan">
              {t.busy ? <Spinner /> : <ArrowUpIcon />}
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </form>
    </div>
  )
}
