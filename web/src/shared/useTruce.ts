import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfig, getScene, openSession, plan, type PlanBody } from './api'
import { decodeScene, sameTastes, sceneOf } from './scene'
import type { Config, Question, Result, Scene, Step, Suggestion } from './types'

// One run of the agent: what was asked, the steps it took and what it returned.
// `waiting` marks a run that stopped to ask which entity a taste means.
export type Run = { id: number; ask: string; steps: Step[]; result: Result | null; error: string | null; preset?: string; waiting?: boolean }
export type Pending = { question: Question; body: PlanBody; ask: string }
// Opens the friend editor with these inputs; `focus` is [friend, taste] to put the cursor in.
export type EditRequest = { scene: Scene; focus?: [number, number]; id: number }

const NO_VETO = { excluded: [], no_bars: false }

export function useTruce() {
  const [config, setConfig] = useState<Config | null>(null)
  const [preset, setPreset] = useState<string | null>(null)
  const [runs, setRuns] = useState<Run[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [editRequest, setEditRequest] = useState<EditRequest | null>(null)
  // Inputs sent last, so the editor and the scene link still work before a plan has finished.
  const [sentScene, setSentScene] = useState<Scene | null>(null)
  const nextId = useRef(1)

  const withResults = runs.filter((r) => r.result)
  const current = withResults.at(-1)?.result ?? null
  const previous = withResults.at(-2)?.result ?? null
  const live = runs.at(-1) ?? null
  // Inputs to edit or share: those of a run that stopped to ask something, else the result's.
  // Only the inputs: the editor sends this scene back, and a whole Result is far over the server's limit.
  const scene: Scene | null = live?.waiting ? sentScene : current ? sceneOf(current) : sentScene

  const patch = (id: number, change: Partial<Run>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)))

  const loadPreset = useCallback(async (name: string) => {
    setBusy(true)
    setError(null)
    setPending(null)
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

  // Sends one plan request and files the answer: a result, a question, or a friend to fill in.
  const send = useCallback(async (ask: string, body: PlanBody) => {
    const id = nextId.current++
    setBusy(true)
    setError(null)
    setPending(null)
    setSentScene(sceneOf(body))
    setRuns((all) => [...all, { id, ask, steps: [], result: null, error: null }])
    const steps: Step[] = []
    try {
      const answer = await plan(body, (step) => {
        steps.push(step)
        patch(id, { steps: [...steps] })
      })
      const asked = sceneOf(answer)
      if (answer.status === 'clarification' && 'questions' in answer) {
        patch(id, { steps: [...steps], waiting: true })
        setSentScene(asked)
        setPending({ question: answer.questions[0], body: { ...body, ...asked, veto: answer.veto }, ask })
        return null
      }
      if (answer.status === 'friend_taste') {
        patch(id, { steps: [...steps], waiting: true })
        setSentScene(asked)
        const friend = answer.people.length - 1
        setEditRequest({ scene: asked, focus: [friend, Math.max(0, answer.people[friend].seeds.length - 1)], id })
        return null
      }
      const result = answer as Result
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
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        await openSession()
        const data = await getConfig()
        if (!alive) return
        setConfig(data)
        if (location.hash.startsWith('#scene=')) {
          let linked: Scene
          try {
            linked = decodeScene(location.hash)
          } catch (err) {
            setError((err as Error).message)
            await loadPreset(data.default_scene)
            return
          }
          await send('Scene link', { ...linked, choices: {}, veto: NO_VETO, veto_text: '' })
        } else await loadPreset(data.default_scene)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadPreset, send])

  const run = (ask: string, extra: Partial<PlanBody> = {}) => {
    if (busy || !current) return null
    return send(ask, {
      people: current.people,
      choices: current.choices ?? {},
      start_radius: current.start_radius,
      area: current.area,
      occasion: current.occasion,
      veto: current.veto,
      veto_text: '',
      current_pick: current.picks[0]?.id,
      ...extra,
    })
  }

  const addCondition = (text: string) => run(text, { veto_text: text })
  const vetoPlace = (id: string, name: string) =>
    current && run(`Not ${name}`, { veto: { ...current.veto, excluded: [...new Set([...current.veto.excluded, id])] } })
  const resetExclusions = () => run('Reset exclusions', { veto: NO_VETO })
  const followSuggestion = (s: Suggestion) => run(s.label, { veto_text: s.label, suggested_action: { name: s.name, arguments: s.arguments } })

  // Edited friends or scene: earlier exclusions are dropped, and entity choices survive only
  // when every taste and the area stay the same.
  const recompute = (next: Scene, ask = 'Recompute') => {
    if (busy) return null
    const keep = current && current.area === next.area && sameTastes(current.people, next.people)
    setPreset(null)
    return send(ask, { ...sceneOf(next), choices: keep ? (current.choices ?? {}) : {}, veto: NO_VETO, veto_text: '' })
  }

  // Answer to "which one did you mean?": an entity id, or skip this taste.
  const answer = (choice: string) => {
    if (!pending || busy) return
    const { question, body, ask } = pending
    const [pi, si] = question.key.split(':').map(Number)
    if (choice === 'skip' && body.people[pi]?.seeds.length === 1) {
      // A friend needs one taste: clear it and let the user type another one.
      const people = body.people.map((p, i) => (i === pi ? { ...p, seeds: p.seeds.map((s, j) => (j === si ? { ...s, query: '' } : s)) } : p))
      setPending(null)
      setEditRequest({ scene: { ...body, people }, focus: [pi, si], id: nextId.current++ })
      return
    }
    send(ask, { ...body, choices: { ...body.choices, [question.key]: choice } })
  }

  const dismissQuestion = () => setPending(null)
  const openEditor = (focus?: [number, number], from: Scene | null = scene) => from && setEditRequest({ scene: from, focus, id: nextId.current++ })
  const closeEditor = () => setEditRequest(null)

  return {
    config, preset, runs, current, previous, live, busy, error, scene, pending, editRequest,
    loadPreset, addCondition, vetoPlace, resetExclusions, followSuggestion, recompute, answer, dismissQuestion, openEditor, closeEditor,
  }
}

export type Truce = ReturnType<typeof useTruce>
