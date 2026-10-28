import { useState, type FormEvent } from 'react'
import { CornerDownLeftIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from '@/components/ui/input-group'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import { hasExclusions, openStarters } from '@/shared/conditions'
import type { Truce } from '@/shared/useTruce'

// One more condition in plain words, the agent's suggested next step, and quick conditions.
export function ConditionBar({ t, className }: { t: Truce; className?: string }) {
  const [text, setText] = useState('')
  const r = t.current
  const excluded = hasExclusions(r)
  const suggestions = r?.suggestions ?? []
  const asks = openStarters(r).filter((a) => !suggestions.some((s) => s.label.toLowerCase() === a.toLowerCase()))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const value = text.trim()
    if (!value || t.busy) return
    setText('')
    t.addCondition(value)
  }

  return (
    <form onSubmit={submit} className={cn('flex flex-col gap-2.5', className)}>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((s) => (
          <Button key={s.label} type="button" variant="secondary" size="sm" disabled={t.busy || !r} onClick={() => t.followSuggestion(s)}>
            {s.label}
          </Button>
        ))}
        {asks.map((a) => (
          <Button key={a} type="button" variant="outline" size="sm" disabled={t.busy || !r} onClick={() => t.addCondition(a.toLowerCase())}>
            {a}
          </Button>
        ))}
      </div>
      <InputGroup className="h-11 bg-background">
        <InputGroupInput
          data-tt="condition"
          aria-label="One more condition"
          placeholder="One more condition…"
          autoComplete="off"
          enterKeyHint="send"
          value={text}
          onChange={(e) => setText(e.target.value)}
          disabled={!r}
        />
        <InputGroupAddon align="inline-end">
          {excluded && (
            <InputGroupButton type="button" size="sm" className="h-8 px-2.5 text-muted-foreground" disabled={t.busy} onClick={() => t.resetExclusions()} aria-label="Reset exclusions">
              <span className="md:hidden">Reset</span>
              <span className="hidden md:inline">Reset exclusions</span>
            </InputGroupButton>
          )}
          <InputGroupButton type="submit" variant="default" size="sm" className="h-8 px-3" disabled={t.busy || !text.trim()}>
            {t.busy ? <Spinner /> : <CornerDownLeftIcon />}
            Replan
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>
    </form>
  )
}
