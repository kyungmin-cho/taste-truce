import { useCallback, useEffect, useRef, useState } from 'react'
import { getConfig, getScene, openSession, plan, type PlanBody } from './api'
import { decodeLink, encodeScene, sceneOf } from './scene'
import type { Config, Person, Question, Result, Scene, Seed, Step, Suggestion, Veto } from './types'

// One run of the agent: what was asked, the steps it took and what it returned.
// `waiting` marks a run that stopped to ask which entity a taste means.
// `conditioned` marks a run the user asked for with words or a suggestion, the only runs whose notice is shown.
export type Run = { id: number; ask: string; steps: Step[]; result: Result | null; error: string | null; preset?: string; waiting?: boolean; conditioned?: boolean }
export type Pending = { question: Question; body: PlanBody; ask: string }
// Opens the friend editor with these inputs; `focus` is [friend, taste] to put the cursor in.
export type EditRequest = { scene: Scene; focus?: [number, number]; id: number }

const NO_VETO: Veto = { excluded: [], no_bars: false }

// Each finished result is a history entry (#scene=… or the bare page for a saved scene) whose result
// is kept in this tab's sessionStorage, so reload, Back and Forward show it again without a request.
type Entry = { result: Result; preset: string | null }
const ENTRY = 'tt:entry:'
const INDEX = 'tt:entries'
const KEEP = 20

function saveEntry(id: string, entry: Entry) {
  try {
    const ids: string[] = JSON.parse(sessionStorage.getItem(INDEX) || '[]').filter((x: string) => x !== id)
    ids.push(id)
    while (ids.length > KEEP) sessionStorage.removeItem(ENTRY + ids.shift())
    for (;;) {
      try {
        sessionStorage.setItem(ENTRY + id, JSON.stringify(entry))
        break
      } catch (err) {
        // Storage full: drop the oldest entry and try again; with nothing left to drop, give up.
        if (ids.length <= 1) throw err
        sessionStorage.removeItem(ENTRY + ids.shift())
      }
    }
    sessionStorage.setItem(INDEX, JSON.stringify(ids))
  } catch {
    // Without storage the page still works; reload then plans the linked scene again.
  }
}

function loadEntry(id: unknown): Entry | null {
  if (typeof id !== 'string') return null
  try {
    return JSON.parse(sessionStorage.getItem(ENTRY + id) || 'null')
  } catch {
    return null
  }
}

// A resolved "which one did you mean?" belongs to a friend's taste in an area, wherever that taste sits.
const choiceKey = (area: string, person: Person, seed: Seed) => JSON.stringify([area, person.name.trim(), seed.type, seed.query.trim().toLowerCase()])

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
  // Conditions of a run that stopped to ask something; a finished run carries its own.
  const [sentVeto, setSentVeto] = useState<Veto | null>(null)
  const nextId = useRef(1)
  const chosen = useRef(new Map<string, string>())
  // Whether this page already has a history entry, and a counter that makes Back and Forward drop
  // the answer of a plan that was still running.
  const entered = useRef(false)
  const epoch = useRef(0)

  const withResults = runs.filter((r) => r.result)
  const current = withResults.at(-1)?.result ?? null
  const previous = withResults.at(-2)?.result ?? null
  const live = runs.at(-1) ?? null
  // Inputs to edit or share: those of a run that stopped to ask something, else the result's.
  // Only the inputs: the editor sends this scene back, and a whole Result is far over the server's limit.
  const scene: Scene | null = live?.waiting ? sentScene : current ? sceneOf(current) : sentScene
  // The conditions in force. Friend edits and recomputes keep them; only the user removes them.
  const veto: Veto = (live?.waiting ? sentVeto : current?.veto) ?? NO_VETO

  const patch = (id: number, change: Partial<Run>) => setRuns((all) => all.map((r) => (r.id === id ? { ...r, ...change } : r)))

  const remember = (result: Result) => {
    for (const [key, id] of Object.entries(result.choices ?? {})) {
      const [pi, si] = key.split(':').map(Number)
      const person = result.people[pi]
      if (person?.seeds[si]) chosen.current.set(choiceKey(result.area, person, person.seeds[si]), id)
    }
  }

  // Entity choices for these inputs: every taste answered before in this area keeps its answer.
  const choicesFor = (next: Scene) => {
    const out: Record<string, string> = {}
    next.people.forEach((p, pi) =>
      p.seeds.forEach((s, si) => {
        const id = chosen.current.get(choiceKey(next.area, p, s))
        if (id) out[`${pi}:${si}`] = id
      }),
    )
    return out
  }

  const commit = (result: Result, presetName: string | null) => {
    remember(result)
    const id = `${Date.now().toString(36)}-${nextId.current++}`
    saveEntry(id, { result, preset: presetName })
    const url = new URL(location.href)
    url.hash = presetName ? '' : 'scene=' + encodeScene(result, result.veto)
    history[entered.current ? 'pushState' : 'replaceState']({ tt: id }, '', url)
    entered.current = true
  }

  const restore = (entry: Entry) => {
    epoch.current++
    remember(entry.result)
    setPending(null)
    setEditRequest(null)
    setError(null)
    setPreset(entry.preset)
    setRuns([{ id: nextId.current++, ask: '', steps: entry.result.steps ?? [], result: entry.result, error: null, preset: entry.preset ?? undefined }])
  }

  const loadPreset = useCallback(async (name: string) => {
    const mine = epoch.current
    setBusy(true)
    setError(null)
    setPending(null)
    setPreset(name)
    try {
      const result = await getScene(name)
      if (epoch.current !== mine) return
      setRuns([{ id: nextId.current++, ask: '', steps: result.steps ?? [], result, error: null, preset: name }])
      commit(result, name)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  // Sends one plan request and files the answer: a result, a question, or a friend to fill in.
  const send = useCallback(async (ask: string, body: PlanBody) => {
    const id = nextId.current++
    const mine = epoch.current
    setBusy(true)
    setError(null)
    setPending(null)
    setSentScene(sceneOf(body))
    setRuns((all) => [...all, { id, ask, steps: [], result: null, error: null, conditioned: !!(body.veto_text || body.suggested_action) }])
    const steps: Step[] = []
    try {
      const answer = await plan(body, (step) => {
        steps.push(step)
        patch(id, { steps: [...steps] })
      })
      // Back or Forward moved to another entry while this plan ran.
      if (epoch.current !== mine) return null
      const asked = sceneOf(answer)
      if (answer.status === 'clarification' && 'questions' in answer) {
        patch(id, { steps: [...steps], waiting: true })
        setSentScene(asked)
        setSentVeto(answer.veto)
        setPending({ question: answer.questions[0], body: { ...body, ...asked, veto: answer.veto }, ask })
        return null
      }
      if (answer.status === 'friend_taste') {
        patch(id, { steps: [...steps], waiting: true })
        setSentScene(asked)
        setSentVeto(answer.veto)
        const friend = answer.people.length - 1
        setEditRequest({ scene: asked, focus: [friend, Math.max(0, answer.people[friend].seeds.length - 1)], id })
        return null
      }
      const result = answer as Result
      patch(id, { result, steps: [...steps] })
      commit(result, null)
      return result
    } catch (err) {
      if (epoch.current !== mine) return null
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
        // A reload shows this entry's result again before anything else loads.
        const entry = loadEntry(history.state?.tt)
        if (entry) {
          entered.current = true
          restore(entry)
        }
        await openSession()
        const data = await getConfig()
        if (!alive) return
        setConfig(data)
        if (entry) return
        if (location.hash.startsWith('#scene=')) {
          let linked: { scene: Scene; veto: Veto }
          try {
            linked = decodeLink(location.hash)
          } catch (err) {
            setError((err as Error).message)
            await loadPreset(data.default_scene)
            return
          }
          // veto_text stays empty: a link replays its conditions without the planner.
          await send('Scene link', { ...linked.scene, choices: {}, veto: linked.veto, veto_text: '' })
        } else await loadPreset(data.default_scene)
      } catch (err) {
        setError((err as Error).message)
      }
    })()
    return () => {
      alive = false
    }
  }, [loadPreset, send])

  // Back and Forward: the entry's stored result, or, when this tab no longer has it, a fresh load of that URL.
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const entry = loadEntry(event.state?.tt)
      if (entry) restore(entry)
      else location.reload()
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

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

  const removeCondition = (label: string, without: Veto) => run(`Removed: ${label}`, { veto: without })

  // Edited friends or scene: the conditions in force stay, and every taste that was answered
  // before keeps its answer.
  const recompute = (next: Scene, ask = 'Recompute') => {
    if (busy) return null
    setPreset(null)
    return send(ask, { ...sceneOf(next), choices: choicesFor(next), veto, veto_text: '' })
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
    config, preset, runs, current, previous, live, busy, error, scene, veto, pending, editRequest,
    loadPreset, addCondition, vetoPlace, resetExclusions, removeCondition, followSuggestion, recompute, answer, dismissQuestion, openEditor, closeEditor,
  }
}

export type Truce = ReturnType<typeof useTruce>
