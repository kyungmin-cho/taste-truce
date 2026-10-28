import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfig, getScene, openSession, plan, type PlanBody } from './api'
import type { Config, Result, Step, Suggestion } from './types'

// One run of the agent: what was asked, the steps it took and what it returned.
export type Run = { id: number; ask: string; steps: Step[]; result: Result | null; error: string | null; preset?: string }

export function useTruce() {
  const [config, setConfig] = useState<Config | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nextId = useRef(1)

  const current = [...runs].reverse().find((r) => r.result)?.result ?? null
  const previous = runs.filter((r) => r.result).at(-2)?.result ?? null
  const live = runs.at(-1) ?? null

  const patch = (id: number, change: Partial<Run>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)))

  const loadPreset = useCallback(async (name: string) => {
    setBusy(true)
    setError(null)
    setPreset(name)
    try {
      const result = await getScene(name)
      setRuns([{ id: nextId.current++, ask: '', steps: result.steps ?? [], result, error: null, preset: name }])
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await openSession()
        const data = await getConfig()
        if (!alive) return
        setConfig(data)
        await loadPreset(data.default_scene)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadPreset])

  const run = useCallback(
    async (ask: string, extra: Partial<PlanBody> = {}) => {
      if (busy || !current) return null
      const id = nextId.current++
      setBusy(true)
      setError(null)
      setRuns((all) => [...all, { id, ask, steps: [], result: null, error: null }])
      const body: PlanBody = {
        people: current.people,
        choices: current.choices ?? {},
        start_radius: current.start_radius,
        area: current.area,
        occasion: current.occasion,
        veto: current.veto,
        veto_text: '',
        current_pick: current.picks[0]?.id,
        ...extra,
      }
      const steps: Step[] = []
      try {
        const result = await plan(body, (step) => {
          steps.push(step)
          patch(id, { steps: [...steps] })
        })
        patch(id, { result, steps: [...steps] })
        return result
      } catch (err) {
        const message = (err as Error).message
        patch(id, { error: message })
        setError(message)
        return null
      } finally {
        setBusy(false)
      }
    },
    [busy, current],
  )

  const addCondition = (text: string) => run(text, { veto_text: text })
  const vetoPlace = (id: string, name: string) =>
    current && run(`Not ${name}`, { veto: { ...current.veto, excluded: [...new Set([...current.veto.excluded, id])] } })
  const resetExclusions = () => run('Reset exclusions', { veto: { excluded: [], no_bars: false } })
  const followSuggestion = (s: Suggestion) => run(s.label, { veto_text: s.label, suggested_action: { name: s.name, arguments: s.arguments } })

  return { config, preset, runs, current, previous, live, busy, error, loadPreset, addCondition, vetoPlace, resetExclusions, followSuggestion }
}

export type Truce = ReturnType<typeof useTruce>
