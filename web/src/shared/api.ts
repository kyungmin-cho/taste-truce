import type { Answer, Config, Result, Step } from './types'

// The server issues its session cookie with the page itself. Only the dev server, which serves
// the page from Vite, has to fetch it separately; its proxy maps this path to the server's /.
export async function openSession() {
  if (import.meta.env.DEV) await fetch('/__session', { credentials: 'same-origin' })
}

export async function getConfig(): Promise<Config> {
  const response = await fetch('/api/config')
  if (!response.ok) throw new Error('Could not load the scenes.')
  return response.json()
}

export async function getScene(name: string): Promise<Result> {
  const response = await fetch('/scene/' + name)
  const data = await response.json()
  if (!response.ok || !data.result) throw new Error(data.error || 'The saved scene is not ready yet.')
  return data.result
}

export type PlanBody = {
  people: Result['people']
  choices: Record<string, string>
  start_radius: number
  area: string
  occasion: string
  veto: Result['veto']
  veto_text: string
  current_pick?: string
  suggested_action?: { name: string; arguments: Record<string, unknown> }
}

// The request carries the inputs only. Callers often build the body from a whole Result, and the
// server refuses bodies over 20 KB, so every field is copied by name here.
export function planPayload(body: PlanBody): PlanBody {
  return {
    people: body.people.map((p) => ({ name: p.name, seeds: p.seeds.map((s) => ({ query: s.query, type: s.type })) })),
    choices: body.choices,
    start_radius: body.start_radius,
    area: body.area,
    occasion: body.occasion,
    veto: body.veto,
    veto_text: body.veto_text,
    ...(body.current_pick ? { current_pick: body.current_pick } : {}),
    ...(body.suggested_action ? { suggested_action: { name: body.suggested_action.name, arguments: body.suggested_action.arguments } } : {}),
  }
}

// /api/plan streams NDJSON: step events while the agent works, then one result or error.
export async function plan(body: PlanBody, onStep: (step: Step) => void): Promise<Answer> {
  const response = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(planPayload(body)),
  })
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || 'Could not start a plan.')
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim()) continue
      const event = JSON.parse(line)
      if (event.event === 'step') onStep(event.step)
      if (event.event === 'error') throw new Error(event.message)
      if (event.event === 'result') return event.result
    }
    if (done) break
  }
  throw new Error('The connection ended before a plan was ready. Please retry.')
}
