import { useEffect, useState } from 'react'
import { LinkIcon, PlusIcon, Trash2Icon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { hasExclusions } from '@/shared/conditions'
import { AREAS, MAX_FRIENDS, MAX_SEEDS, OCCASIONS, SEED_TYPES, SWAPS, sameScene } from '@/shared/scene'
import type { Person, Scene, Seed } from '@/shared/types'
import type { EditRequest, Truce } from '@/shared/useTruce'

type Props = { t: Truce; request: EditRequest | null; mobile: boolean; onShare: (scene: Scene) => void }

// Friends, their tastes and the scene. Default export so the editor loads in its own chunk.
export default function FriendEditor({ t, request, mobile, onShare }: Props) {
  return (
    <Sheet open={!!request} onOpenChange={(open) => !open && t.closeEditor()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md" initialFocus={false}>
        {request && <Editor key={request.id} t={t} request={request} mobile={mobile} onShare={onShare} />}
      </SheetContent>
    </Sheet>
  )
}

function IconAction({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-sm" aria-label={label} disabled={disabled} onClick={onClick} />}>{children}</TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

function Editor({ t, request, onShare }: Props & { request: EditRequest }) {
  const [draft, setDraft] = useState<Scene>(request.scene)
  const people = draft.people

  useEffect(() => {
    const [f, s] = request.focus ?? []
    if (f === undefined) return
    const id = window.setTimeout(() => document.getElementById(`seed-${f}-${s}`)?.focus(), 60)
    return () => window.clearTimeout(id)
  }, [request])

  const setPeople = (next: Person[]) => setDraft((d) => ({ ...d, people: next }))
  const editPerson = (i: number, change: Partial<Person>) => setPeople(people.map((p, j) => (j === i ? { ...p, ...change } : p)))
  const editSeed = (i: number, k: number, change: Partial<Seed>) => editPerson(i, { seeds: people[i].seeds.map((s, j) => (j === k ? { ...s, ...change } : s)) })

  const filled = (list: Person[]) => list.every((p) => p.name.trim() && p.seeds.every((s) => s.query.trim()))
  const complete = filled(people)
  const unchanged = !!t.current && sameScene(draft, t.current) && !hasExclusions(t.current)
  const submit = (scene: Scene, ask?: string) => {
    t.closeEditor()
    t.recompute(scene, ask)
  }

  return (
    <form
      className="flex min-h-0 flex-1 flex-col"
      onSubmit={(e) => {
        e.preventDefault()
        if (complete && !unchanged && !t.busy) submit(draft)
      }}
    >
      <SheetHeader className="gap-3 border-b px-5 pt-5 pb-4">
        <SheetTitle className="text-base">Friends and scene</SheetTitle>
        <SheetDescription className="sr-only">Edit each friend's tastes, the area and the occasion, then recompute the ranks.</SheetDescription>
        <div className="grid grid-cols-2 gap-2">
          <Label className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
            Area
            <NativeSelect className="w-full" value={draft.area} onChange={(e) => setDraft({ ...draft, area: e.target.value })}>
              {AREAS.map((a) => (
                <NativeSelectOption key={a} value={a}>
                  {a}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
          <Label className="flex flex-col items-start gap-1 text-xs text-muted-foreground">
            Occasion
            <NativeSelect className="w-full" value={draft.occasion} onChange={(e) => setDraft({ ...draft, occasion: e.target.value })}>
              {OCCASIONS.map((o) => (
                <NativeSelectOption key={o} value={o}>
                  {o}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Label>
        </div>
      </SheetHeader>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        <ol className="flex flex-col gap-5">
          {people.map((p, i) => (
            <li key={i} className="flex flex-col gap-2" aria-label={`Friend ${i + 1}`}>
              <div className="flex items-center gap-1">
                <Input
                  aria-label={`Friend ${i + 1} name`}
                  value={p.name}
                  maxLength={60}
                  aria-invalid={!p.name.trim() || undefined}
                  onChange={(e) => editPerson(i, { name: e.target.value })}
                  className="h-8 border-transparent px-1.5 text-sm font-medium shadow-none hover:border-input focus-visible:border-ring"
                />
                <IconAction label={`Remove ${p.name || `friend ${i + 1}`}`} disabled={people.length === 1} onClick={() => setPeople(people.filter((_, j) => j !== i))}>
                  <Trash2Icon />
                </IconAction>
              </div>
              {p.seeds.map((s, k) => (
                <div key={k} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-1.5">
                  <NativeSelect size="sm" className="w-full" aria-label={`Taste ${k + 1} type for ${p.name || `friend ${i + 1}`}`} value={s.type} onChange={(e) => editSeed(i, k, { type: e.target.value })}>
                    {SEED_TYPES.map((type) => (
                      <NativeSelectOption key={type} value={type}>
                        {type.replace('_', ' ')}
                      </NativeSelectOption>
                    ))}
                  </NativeSelect>
                  <Input
                    id={`seed-${i}-${k}`}
                    aria-label={`Taste ${k + 1} for ${p.name || `friend ${i + 1}`}`}
                    placeholder="A film, artist or brand"
                    value={s.query}
                    maxLength={120}
                    aria-invalid={!s.query.trim() || undefined}
                    onChange={(e) => editSeed(i, k, { query: e.target.value })}
                    className="h-7"
                  />
                  <IconAction label="Remove taste" disabled={p.seeds.length === 1} onClick={() => editPerson(i, { seeds: p.seeds.filter((_, j) => j !== k) })}>
                    <XIcon />
                  </IconAction>
                </div>
              ))}
              {p.seeds.length < MAX_SEEDS && (
                <Button type="button" variant="ghost" size="sm" className="self-start text-muted-foreground" onClick={() => editPerson(i, { seeds: [...p.seeds, { query: '', type: 'artist' }] })}>
                  <PlusIcon />
                  Add taste
                </Button>
              )}
            </li>
          ))}
        </ol>
        {people.length < MAX_FRIENDS && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            onClick={() => {
              setPeople([...people, { name: `Friend ${people.length + 1}`, seeds: [{ query: '', type: 'movie' }] }])
              window.setTimeout(() => document.getElementById(`seed-${people.length}-0`)?.focus(), 30)
            }}
          >
            <PlusIcon />
            Add friend
          </Button>
        )}
        {people.length >= 2 && (
          <>
            <Separator className="my-5" />
            <div className="flex flex-col gap-2">
              <span className="text-xs text-muted-foreground">Replace friend 2 and recompute</span>
              <div className="flex flex-wrap gap-1.5">
                {SWAPS.map((swap) => {
                  const swapped = people.map((p, j) => (j === 1 ? swap : p))
                  return (
                    <Button
                      key={swap.name}
                      type="button"
                      variant="secondary"
                      size="sm"
                      disabled={t.busy || people[1]?.name === swap.name || !filled(swapped)}
                      onClick={() => submit({ ...draft, people: swapped }, `Friend 2: ${swap.name}`)}
                    >
                      {swap.name}
                    </Button>
                  )
                })}
              </div>
            </div>
          </>
        )}
      </div>

      <SheetFooter className="flex-row items-center justify-between gap-2 border-t px-5 py-3">
        <Button type="button" variant="ghost" size="sm" disabled={!complete} onClick={() => onShare(draft)}>
          <LinkIcon />
          Copy scene link
        </Button>
        <Button type="submit" disabled={!complete || unchanged || t.busy}>
          Recompute ranks
        </Button>
      </SheetFooter>
    </form>
  )
}
