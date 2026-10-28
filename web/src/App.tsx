import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { LinkIcon, UsersIcon } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer'
import { Progress } from '@/components/ui/progress'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import { Toaster } from '@/components/ui/sonner'
import { Spinner } from '@/components/ui/spinner'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toggle } from '@/components/ui/toggle'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { encodeScene } from '@/shared/scene'
import type { Result, Scene } from '@/shared/types'
import { useTruce, type Truce } from '@/shared/useTruce'
import { AgentSteps, AgentStrip, stepsOf } from './app/Agent'
import { ConditionBar } from './app/ConditionBar'
import { AlternativesTable, Hero, PopularHero, RankMeters } from './app/Pick'
import { Shortlist } from './app/Shortlist'

// Leaflet, the friend editor and the question dialog load in their own chunks.
const PlaceMap = lazy(() => import('@/shared/PlaceMap'))
const FriendEditor = lazy(() => import('./app/FriendEditor'))
const Clarify = lazy(() => import('./app/Clarify'))

const DESKTOP_PAD: [number, number] = [56, 150]
const PANEL_PAD: [number, number] = [448, 56]
const MOBILE_TOP: [number, number] = [24, 132]
// Bottom sheet stops: half the screen, and open up to just below the floating scene card.
const HALF = 0.52
const fullSnap = () => Math.min(0.94, 1 - 124 / window.innerHeight)

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

// Keeps a lazily loaded part mounted after its first use so it can animate closed.
function useOnce(flag: boolean) {
  const seen = useRef(false)
  if (flag) seen.current = true
  return seen.current
}

type Tab = 'pick' | 'list' | 'agent'

export function App() {
  const t = useTruce()
  const mobile = useMedia('(max-width: 767px)')
  const [tab, setTab] = useState<Tab>('pick')
  const [popular, setPopular] = useState(false)
  const [activeId, setActiveId] = useState<string | null>(null)
  const toasted = useRef(0)
  const result = t.current

  // One toast per finished run that the user asked for.
  useEffect(() => {
    const run = t.live
    if (!run || !run.ask || run.id === toasted.current) return
    if (run.error) {
      toasted.current = run.id
      toast.error(run.error)
    } else if (run.result) {
      toasted.current = run.id
      const r = run.result
      if (r.notice) toast.warning(r.notice)
      else toast(`${r.pool_size} places left`, { description: `Fair pick: ${r.picks[0]?.name}` })
    }
  }, [t.live])

  // A new result shows the taste ranking again.
  useEffect(() => setPopular(false), [result])

  const share = async (scene: Scene) => {
    const url = new URL(location.href)
    url.hash = 'scene=' + encodeScene(scene)
    history.replaceState(null, '', url)
    try {
      await navigator.clipboard.writeText(url.href)
      toast.success('Scene link copied')
    } catch {
      toast('Copy the scene link from the address bar')
    }
  }

  const select = (id: string) => {
    setActiveId(id)
    setTab('list')
  }

  const mobilePad = useMemo<[number, number]>(() => [24, Math.round(window.innerHeight * HALF) + 24], [])
  const editorUsed = useOnce(!!t.editRequest)
  const questionUsed = useOnce(!!t.pending)

  return (
    <TooltipProvider>
      <div data-tt-busy={String(t.busy)} className="relative h-dvh w-full overflow-hidden bg-background text-foreground">
        <Suspense fallback={<div className="absolute inset-0 z-0 bg-muted" />}>
          <PlaceMap
            className="absolute inset-0 z-0"
            places={(popular ? result?.baseline : result?.picks) ?? []}
            pickId={result?.picks[0]?.id}
            activeId={activeId}
            onSelect={select}
            padding={mobile ? mobilePad : DESKTOP_PAD}
            paddingTopLeft={mobile ? MOBILE_TOP : PANEL_PAD}
            attribution={mobile ? 'topright' : 'bottomright'}
          />
        </Suspense>
        {mobile ? (
          <MobileLayout t={t} tab={tab} setTab={setTab} activeId={activeId} setActiveId={setActiveId} popular={popular} setPopular={setPopular} onShare={share} />
        ) : (
          <>
            <aside className="atlas-surface absolute top-4 bottom-4 left-4 z-10 flex w-(--atlas-panel) flex-col overflow-hidden rounded-2xl bg-card">
              <PanelHeader t={t} onShare={share} />
              <PanelTabs t={t} tab={tab} setTab={setTab} activeId={activeId} setActiveId={setActiveId} popular={popular} setPopular={setPopular} />
              {tab !== 'agent' && (
                <div className="border-t p-1.5">
                  <AgentStrip t={t} onOpen={() => setTab('agent')} />
                </div>
              )}
            </aside>
            <div className="pointer-events-none absolute right-6 bottom-6 left-[calc(var(--atlas-panel)+2.5rem)] z-10 flex justify-center">
              <ConditionBar t={t} className="atlas-surface pointer-events-auto w-full max-w-xl rounded-2xl bg-card p-3" />
            </div>
          </>
        )}
        <Toaster position={mobile ? 'top-center' : 'top-right'} mobileOffset={{ top: 'calc(max(0.75rem, env(safe-area-inset-top)) + 7rem)' }} duration={2500} />
      </div>
      <Suspense>
        {editorUsed && <FriendEditor t={t} request={t.editRequest} mobile={mobile} onShare={share} />}
        {questionUsed && <Clarify t={t} />}
      </Suspense>
    </TooltipProvider>
  )
}

function Brand() {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <a href="/" className="rounded-sm py-1 text-[15px] font-semibold tracking-tight outline-none focus-visible:ring-2 focus-visible:ring-ring">
        taste truce
      </a>
      <span className="truncate text-[11px] text-muted-foreground">Powered by Qloo</span>
    </div>
  )
}

function SceneActions({ t, onShare }: { t: Truce; onShare: (scene: Scene) => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button variant="outline" size="sm" disabled={!t.scene || t.busy} onClick={() => t.openEditor()} data-tt="friends">
        <UsersIcon />
        Friends
        <span className="text-muted-foreground tabular-nums">{t.scene?.people.length ?? ''}</span>
      </Button>
      <Tooltip>
        <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Copy scene link" disabled={!t.scene} onClick={() => t.scene && onShare(t.scene)} />}>
          <LinkIcon />
        </TooltipTrigger>
        <TooltipContent>Copy scene link</TooltipContent>
      </Tooltip>
    </div>
  )
}

function PanelHeader({ t, onShare }: { t: Truce; onShare: (scene: Scene) => void }) {
  const r = t.current
  return (
    <header className="flex flex-col gap-3 border-b px-5 pt-4 pb-3">
      <div className="flex items-center justify-between gap-2">
        <Brand />
        <SceneActions t={t} onShare={onShare} />
      </div>
      <SceneSwitch t={t} />
      {r && (
        <p className="text-xs text-muted-foreground tabular-nums">
          {r.area} · {r.occasion} · within {r.radius / 1000} km · {r.pool_size} candidates
        </p>
      )}
    </header>
  )
}

const sceneLabel = (label: string) => {
  const last = label.split(' · ').at(-1) ?? label
  return last.charAt(0).toUpperCase() + last.slice(1)
}

function SceneSwitch({ t }: { t: Truce }) {
  const presets = Object.entries(t.config?.presets ?? {})
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
      {presets.map(([id, p]) => (
        <ToggleGroupItem key={id} value={id} className="flex-1 text-xs" title={p.label}>
          {sceneLabel(p.label)}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

function TasteToggle({ popular, setPopular, disabled }: { popular: boolean; setPopular: (v: boolean) => void; disabled?: boolean }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<Toggle variant="outline" size="sm" pressed={popular} onPressedChange={setPopular} disabled={disabled} className="h-7 px-2 text-xs pointer-coarse:h-10 aria-pressed:border-primary/40 aria-pressed:bg-accent aria-pressed:text-accent-foreground" data-tt="taste-off" />}
      >
        Taste off
      </TooltipTrigger>
      <TooltipContent>Show the most popular places instead</TooltipContent>
    </Tooltip>
  )
}

type TabProps = {
  t: Truce
  tab: Tab
  setTab: (t: Tab) => void
  activeId: string | null
  setActiveId: (id: string | null) => void
  popular: boolean
  setPopular: (v: boolean) => void
}

function PanelTabs({ t, tab, setTab, activeId, setActiveId, popular, setPopular, compact = false }: TabProps & { compact?: boolean }) {
  const r = t.current
  const steps = stepsOf(t)
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="min-h-0 flex-1 gap-0">
      <div className="relative flex items-center justify-between gap-2 border-b px-5">
        <TabsList variant="line" className="h-10 gap-4 p-0">
          {!compact && (
            <TabsTrigger value="pick" className="px-0">
              Pick
            </TabsTrigger>
          )}
          <TabsTrigger value="list" className="px-0">
            Shortlist <span className="text-muted-foreground tabular-nums">{(popular ? r?.baseline.length : r?.picks.length) ?? ''}</span>
          </TabsTrigger>
          <TabsTrigger value="agent" data-live={t.busy || undefined} className="px-0 data-live:text-primary" data-tt="agent-tab">
            Agent
            {t.busy ? <Spinner className="size-3.5" /> : <span className="text-muted-foreground tabular-nums">{steps.length || ''}</span>}
          </TabsTrigger>
          {compact && (
            <TabsTrigger value="pick" className="px-0">
              Their #1s
            </TabsTrigger>
          )}
        </TabsList>
        <TasteToggle popular={popular} setPopular={setPopular} disabled={!r} />
        {t.busy && <Progress value={null} aria-label="Agent working" className="absolute inset-x-0 -bottom-px gap-0 *:h-0.5 *:rounded-none" />}
      </div>
      <ScrollArea className="min-h-0 flex-1">
        {!r && !t.live?.steps.length ? (
          <PanelSkeleton error={t.error} />
        ) : (
          <>
            <TabsContent value="pick" className="px-5 py-5">
              {r && (compact ? <AlternativesTable r={r} /> : <PickView r={r} previous={t.previous} popular={popular} />)}
            </TabsContent>
            <TabsContent value="list" className="px-2 py-2">
              {r && <Shortlist t={t} r={r} popular={popular} activeId={activeId} setActiveId={setActiveId} />}
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

function PickView({ r, previous, popular }: { r: Result; previous: Result | null; popular: boolean }) {
  if (popular) return <PopularHero r={r} />
  return (
    <div className="flex flex-col gap-6">
      <Hero r={r} previous={previous} />
      <RankMeters r={r} />
      <AlternativesTable r={r} />
    </div>
  )
}

function MobileLayout({ t, tab, setTab, activeId, setActiveId, popular, setPopular, onShare }: TabProps & { onShare: (scene: Scene) => void }) {
  const r = t.current
  const [mobileTab, setMobileTab] = useState<Tab>('list')
  const snaps = useMemo(() => [HALF, fullSnap()], [])
  const [snap, setSnap] = useState<number | string | null>(HALF)
  const tabsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (tab === 'list') setMobileTab('list')
  }, [tab])
  const openAgent = () => {
    setMobileTab('agent')
    setSnap(snaps[1])
    window.setTimeout(() => tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 120)
  }
  return (
    <>
      <div className="atlas-surface absolute inset-x-3 top-[max(0.75rem,env(safe-area-inset-top))] z-10 flex flex-col gap-1 rounded-xl bg-card p-1.5">
        <SceneSwitch t={t} />
        <AgentStrip t={t} onOpen={openAgent} className="px-2 py-1.5" />
      </div>
      <Drawer open modal={false} disablePointerDismissal snapPoints={snaps} snapPoint={snap} onSnapPointChange={setSnap} showSwipeHandle>
        <DrawerContent className="atlas-surface">
          <DrawerTitle className="sr-only">Fair pick and shortlist</DrawerTitle>
          <ScrollArea className="min-h-0 flex-1">
            <div className="flex flex-col gap-5 px-5 pt-2 pb-4">
              <div className="flex items-center justify-between gap-2">
                <Brand />
                <SceneActions t={t} onShare={onShare} />
              </div>
              {r ? (
                popular ? (
                  <PopularHero r={r} />
                ) : (
                  <>
                    <Hero r={r} previous={t.previous} />
                    <RankMeters r={r} />
                  </>
                )
              ) : (
                <PanelSkeleton error={t.error} />
              )}
              <ConditionBar t={t} />
            </div>
            <div ref={tabsRef} className="flex h-[70dvh] scroll-mt-2 flex-col">
              <PanelTabs
                t={t}
                tab={mobileTab}
                setTab={(v) => {
                  setMobileTab(v)
                  setTab(v)
                }}
                activeId={activeId}
                setActiveId={setActiveId}
                popular={popular}
                setPopular={setPopular}
                compact
              />
            </div>
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </>
  )
}

