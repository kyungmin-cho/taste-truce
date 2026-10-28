import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { Truce } from '@/shared/useTruce'

// "Which one did you mean?" when a taste matches several entities. Default export: own chunk.
export default function Clarify({ t }: { t: Truce }) {
  const q = t.pending?.question
  return (
    <Dialog open={!!q} onOpenChange={(open) => !open && t.dismissQuestion()}>
      <DialogContent className="gap-4 sm:max-w-md">
        {q && (
          <>
            <DialogHeader>
              <DialogTitle>Which “{q.query}”?</DialogTitle>
              <DialogDescription>{q.person}</DialogDescription>
            </DialogHeader>
            {q.options.length ? (
              <ul className="-mx-2 flex max-h-[50dvh] flex-col overflow-y-auto" aria-label="Matches">
                {q.options.map((o) => (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={t.busy}
                      onClick={() => t.answer(o.id)}
                      className="flex w-full flex-col items-start rounded-md px-2 py-2 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <span className="text-sm font-medium">{o.name}</span>
                      <span className="text-xs text-muted-foreground">{[o.genre || o.types?.join(', '), o.address].filter(Boolean).join(' · ')}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">No matches.</p>
            )}
            <DialogFooter>
              <Button
                variant="outline"
                disabled={t.busy}
                onClick={() => {
                  const body = t.pending?.body
                  t.dismissQuestion()
                  t.openEditor(undefined, body)
                }}
              >
                Edit tastes
              </Button>
              <Button variant="secondary" disabled={t.busy} onClick={() => t.answer('skip')}>
                None of these
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
