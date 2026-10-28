import { CornerDownLeftIcon, RotateCcwIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Command, CommandDialog, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command'
import { Kbd } from '@/components/ui/kbd'
import type { Truce } from '@/shared/useTruce'
import { hasExclusions, openStarters } from '@/shared/conditions'


function ConditionCommand({ t, onDone, autoFocus }: { t: Truce; onDone?: () => void; autoFocus?: boolean }) {
  const [text, setText] = useState('')
  const result = t.current
  const excluded = hasExclusions(result)
  const submit = (value: string) => {
    const v = value.trim()
    if (!v || t.busy) return
    setText('')
    onDone?.()
    void t.addCondition(v)
  }
  return (
    <Command className="rounded-lg! border bg-card p-1" loop>
      <CommandInput
        data-tt="condition"
        value={text}
        onValueChange={setText}
        autoFocus={autoFocus}
        disabled={t.busy}
        placeholder="One more condition"
        aria-label="One more condition"
        onKeyDown={(e) => {
          // Typed text wins over the highlighted suggestion.
          if (e.key === 'Enter' && text.trim()) {
            e.preventDefault()
            submit(text)
          }
        }}
      />
      <CommandList className="max-h-none">
        <CommandGroup>
          {text.trim() && (
            <CommandItem forceMount value={'__typed ' + text} onSelect={() => submit(text)}>
              <CornerDownLeftIcon />
              <span className="truncate">Replan with “{text.trim()}”</span>
            </CommandItem>
          )}
          {openStarters(result).map((c) => (
            <CommandItem key={c} value={c} disabled={t.busy} onSelect={() => submit(c)}>
              <SparklesIcon />
              {c}
            </CommandItem>
          ))}
          {(result?.suggestions ?? []).map((s) => (
            <CommandItem
              key={s.label}
              value={s.label}
              disabled={t.busy}
              onSelect={() => {
                onDone?.()
                void t.followSuggestion(s)
              }}
            >
              <SparklesIcon />
              {s.label}
            </CommandItem>
          ))}
          {excluded && (
            <CommandItem
              value="Reset exclusions"
              disabled={t.busy}
              onSelect={() => {
                onDone?.()
                void t.resetExclusions()
              }}
            >
              <RotateCcwIcon />
              Reset exclusions
            </CommandItem>
          )}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}

export function Conditions({ t }: { t: Truce }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        setOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <section aria-labelledby="cond-title" className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 id="cond-title" className="text-sm font-semibold">
          Replan
        </h2>
        <span className="hidden items-center gap-1 text-xs text-muted-foreground sm:flex">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
        </span>
      </div>
      <ConditionCommand t={t} />
      <CommandDialog open={open} onOpenChange={setOpen} title="Add a condition" description="Replan the shortlist with one more condition">
        <ConditionCommand t={t} autoFocus onDone={() => setOpen(false)} />
      </CommandDialog>
    </section>
  )
}
