// Port of planner.py: translate requests into bounded tools; ranking remains in logic.ts.
import { InternalError, PlannerError, ValueError, g, hashable, isDict, pyLen, re, sorted, strip, casefold, truthy, type Obj } from './py.ts'

export type Env = { [key: string]: any }
export type Action = { name: string; arguments: Obj }

// At 5 km a Williamsburg search reaches Midtown Manhattan; stop at 3.5 km there and keep Brooklyn addresses (agent.inArea).
const MAX_RADIUS: { [area: string]: number } = { Seongsu: 5000, 'Williamsburg NYC': 3500 }
export const maxRadius = (area: string) => MAX_RADIUS[area] ?? 5000

type Spec = { type: string; items?: { type: string; enum: string[] }; enum?: unknown[]; maxLength?: number; minItems?: number }
export const TOOL_PARAMS: { [name: string]: { [arg: string]: Spec } } = {
  plan: {},
  exclude_categories: { categories: { type: 'array', items: { type: 'string', enum: ['bar', 'pub', 'nightclub'] }, minItems: 1 } },
  exclude_tags: { tags: { type: 'array', items: { type: 'string', enum: ['Loud', 'Busy', 'Lively', 'Expensive', 'Moderately expensive'] }, minItems: 1 } },
  exclude_place: { target: { type: 'string', enum: ['current'] } },
  widen_radius: { radius: { type: 'integer', enum: [3500, 5000] } },
  change_occasion: { occasion: { type: 'string', enum: ['Dinner', 'Cafe', 'Drinks'] } },
  change_area: { area: { type: 'string', enum: ['Seongsu', 'Williamsburg NYC'] } },
  prefer_budget: { max_price_level: { type: 'integer', enum: [1, 2] } },
  add_friend: { name: { type: 'string', maxLength: 60 }, vegetarian: { type: 'boolean' } },
}
const DESCRIPTIONS: { [name: string]: string } = {
  plan: 'Retrieve and deterministically rank the current scene.',
  exclude_categories: 'Exclude bars, pubs or nightclubs, including politely phrased vetoes.',
  exclude_tags: 'Exclude recorded ambience or cost tags; quieter means Loud, Busy and Lively.',
  exclude_place: 'Veto the current shared pick. Only use for a request to reject that place.',
  widen_radius: 'Search farther away, at 3500 or 5000 metres.',
  change_occasion: 'Change the meeting purpose.', change_area: 'Change to a supported neighborhood.',
  prefer_budget: 'Require a recorded price level at or below the limit. Cheaper defaults to 2.',
  add_friend: 'Add a friend and ask for their cultural taste. Vegetarian also requires recorded vegetarian offerings; never infer allergies.',
}
const TOOLS = Object.entries(TOOL_PARAMS).map(([name, props]) => ({
  type: 'function', function: { name, description: DESCRIPTIONS[name], parameters: { type: 'object', properties: props, required: Object.keys(props), additionalProperties: false } },
}))

const PATTERNS = {
  bars: re(String.raw`\b(no|not|without|avoid|skip|exclude|remove|don.t want|anything but)\b.{0,25}\b(bars?|pubs?|clubs?|nightclubs?)\b|술집.*(빼|싫|말고)|술.*없이`),
  quiet: re(String.raw`quiet|less noisy|not so loud|not too loud|hear each other|actually talk|조용`),
  other: re(String.raw`not (that|this|the same) (place|one|restaurant)|somewhere else|another (place|one)|different (place|restaurant)|그\s*(집|곳).*말고|여기.*말고`),
  cheap: re(String.raw`cheap|less expensive|affordable|budget|저렴|싼`),
  wide: re(String.raw`further|farther|widen|larger radius|expand|broaden|넓혀|멀리`),
  friend: re(String.raw`\b(add|bring|join|include|invite)\b.*\b(friend|person|vegetarian)\b|친구.*추가`),
  nyc: re(String.raw`\bnyc\b|new york`),
}
const OCCASION_PATTERNS: [RegExp, string][] = [[re(String.raw`\b(caf[eé]|coffee)\b|카페`), 'Cafe'], [re(String.raw`\b(dinner|dining|meal)\b|저녁`), 'Dinner'], [re(String.raw`\bdrinks\b|술모임`), 'Drinks']]

export function localTools(text: string): Action[] {
  const t = strip(casefold(text))
  const actions: Action[] = []
  const add = (name: string, args: Obj = {}) => actions.push({ name, arguments: args })
  if (!t) return [{ name: 'plan', arguments: {} }]
  if (PATTERNS.bars.test(t)) add('exclude_categories', { categories: ['bar', 'pub', 'nightclub'] })
  if (PATTERNS.quiet.test(t)) add('exclude_tags', { tags: ['Loud', 'Busy', 'Lively'] })
  if (PATTERNS.other.test(t)) add('exclude_place', { target: 'current' })
  if (PATTERNS.cheap.test(t)) add('prefer_budget', { max_price_level: 2 })
  if (PATTERNS.wide.test(t)) add('widen_radius', { radius: 3500 })
  if (PATTERNS.friend.test(t)) {
    const veg = t.includes('vegetarian') || t.includes('채식')
    add('add_friend', { name: veg ? 'Vegetarian friend' : 'New friend', vegetarian: veg })
  }
  if (t.includes('williamsburg') || PATTERNS.nyc.test(t)) add('change_area', { area: 'Williamsburg NYC' })
  else if (t.includes('seongsu') || t.includes('성수')) add('change_area', { area: 'Seongsu' })
  for (const [pattern, occasion] of OCCASION_PATTERNS) if (pattern.test(t)) add('change_occasion', { occasion })
  if (!actions.length) throw new ValueError('Please name a condition: no bars, somewhere quieter, not that place, cheaper, search farther, a neighborhood, or add a friend.')
  return actions
}

const joinWords = (words: string[]) => (words.length === 1 ? words[0] : words.slice(0, -1).join(', ') + ' and ' + words[words.length - 1])

// A short button label; arguments never appear as raw data.
export function labelFor(action: Action): string {
  const { name, arguments: args } = action
  if (name === 'exclude_categories') return 'Exclude ' + joinWords(args.categories.map((x: string) => x + 's'))
  if (name === 'exclude_tags') {
    const quiet = args.tags.some((t: string) => ['Loud', 'Busy', 'Lively'].includes(t))
    const pricey = args.tags.some((t: string) => t.includes('xpensive'))
    return quiet && pricey ? 'Quieter and cheaper places' : quiet ? 'Somewhere quieter' : 'Skip expensive places'
  }
  if (name === 'exclude_place') return 'Try a different shared pick'
  if (name === 'widen_radius') return `Search farther · ${g(args.radius / 1000)} km`
  if (name === 'change_occasion') return 'Switch to ' + args.occasion.toLowerCase()
  if (name === 'change_area') return 'Move to ' + args.area
  if (name === 'prefer_budget') return args.max_price_level === 1 ? 'Cheapest places only' : 'Cheaper places'
  if (name === 'add_friend') return 'Add ' + args.name
  return 'Plan this scene'
}

export function validate(actions: unknown): Action[] {
  if (!Array.isArray(actions) || !(1 <= actions.length && actions.length <= 8)) throw new ValueError('Invalid tools')
  for (const a of actions) {
    if (!isDict(a)) throw new InternalError('not a dict')
    const name = a.name
    const args = a.arguments
    if (!hashable(name)) throw new InternalError('unhashable')
    const props = typeof name === 'string' && Object.hasOwn(TOOL_PARAMS, name) ? TOOL_PARAMS[name] : null
    if (props === null || !isDict(args) || !sameKeys(args, props)) throw new ValueError('Invalid tool arguments')
    for (const [key, spec] of Object.entries(props)) {
      const value = args[key]
      if (spec.type === 'array') {
        if (!Array.isArray(value) || !(1 <= value.length && value.length <= 8) || value.some((x) => !spec.items!.enum.includes(x))) throw new ValueError('Invalid list')
      } else if (spec.type === 'string') {
        if (typeof value !== 'string' || !strip(value) || pyLen(value) > (spec.maxLength ?? 120)) throw new ValueError('Invalid text')
      } else if (spec.type === 'integer' && !Number.isInteger(value)) throw new ValueError('Invalid number')
      else if (spec.type === 'boolean' && typeof value !== 'boolean') throw new ValueError('Invalid boolean')
      if (spec.enum && !spec.enum.includes(value)) throw new ValueError('Unsupported value')
    }
  }
  return actions as Action[]
}

const sameKeys = (a: Obj, b: Obj) => {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k))
}

function parseLocal(text: string, marker: string): [string, Action[]] {
  try {
    return [marker, validate(localTools(text))]
  } catch (err) {
    if (err instanceof ValueError) throw new PlannerError(err.message, marker)
    throw err
  }
}

const configured = (env: Env) => ['LLM_BASE_URL', 'LLM_MODEL', 'LLM_API_KEY'].every((k) => env[k])

async function postChat(env: Env, payload: Obj): Promise<Obj> {
  // An explicit agent: Cloudflare-fronted providers such as Groq answer some default agents with 403 (error 1010).
  const response = await fetch(String(env.LLM_BASE_URL).replace(/\/+$/, '') + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + env.LLM_API_KEY, 'User-Agent': 'TasteTruce/1.0' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(Number(env.LLM_TIMEOUT_SECONDS || '8') * 1000),
  })
  if (!response.ok) throw Object.assign(new Error('HTTP error'), { code: response.status })
  return response.json()
}

// Status code or error type only; requests, responses and keys stay out of the log.
const llmFailed = (step: string, err: unknown) => console.error(`${step}: LLM unavailable (${(err as Obj)?.code || (err as Error)?.name || 'Error'})`)

export async function chooseTools(env: Env, text: string, scene: Obj): Promise<[string, Action[]]> {
  if (!strip(text)) return ['Direct plan · no condition', [{ name: 'plan', arguments: {} }]]
  if (configured(env)) {
    try {
      const payload = {
        model: env.LLM_MODEL, messages: [
          { role: 'system', content: 'Choose only the tools needed for the user request. Use plan for an initial scene. Do not rank places, invent tastes, or add unrelated tools. Multiple conditions may require multiple tools. Only supported neighborhoods and occasions are allowed. A request to add a vegetarian friend requires add_friend with vegetarian true, even before their taste is known.' },
          { role: 'user', content: JSON.stringify({ request: text || 'Plan this scene', scene }) }],
        tools: TOOLS, tool_choice: 'required', max_tokens: 600,
      }
      const data = await postChat(env, payload)
      const calls = data.choices[0].message.tool_calls
      const actions = validate(calls.map((c: Obj) => ({ name: c.function.name, arguments: JSON.parse(c.function.arguments) })))
      if (text && actions.every((a) => a.name === 'plan')) throw new ValueError('Request needs a condition tool')
      return ['LLM planner', actions]
    } catch (err) {
      llmFailed('planner', err)
      return parseLocal(text, 'Local planner')
    }
  }
  return parseLocal(text, 'Local planner')
}

export function applyTools(scene: Obj, veto: Obj, actions: Action[], currentPick: unknown): [Obj, Obj, boolean] {
  scene = structuredClone(scene)
  veto = structuredClone(veto)
  let needsTaste = false
  for (const { name, arguments: args } of actions) {
    if (name === 'exclude_categories') veto.categories = sorted(new Set([...(veto.categories ?? []), ...args.categories]))
    else if (name === 'exclude_tags') veto.tags = sorted(new Set([...(veto.tags ?? []), ...args.tags]))
    else if (name === 'exclude_place') {
      if (!truthy(currentPick)) throw new ValueError('Choose a plan before vetoing its shared pick.')
      if (typeof currentPick !== 'string') throw new InternalError('unsupported pick')
      veto.excluded = sorted(new Set([...(veto.excluded ?? []), currentPick]))
    } else if (name === 'widen_radius') scene.start_radius = args.radius
    else if (name === 'change_area') scene.area = args.area
    else if (name === 'change_occasion') scene.occasion = args.occasion
    else if (name === 'prefer_budget') veto.max_price_level = args.max_price_level
    else if (name === 'add_friend') {
      if (scene.people.length >= 5) throw new ValueError('Up to five friends can share a plan.')
      scene.people.push({ name: args.name, seeds: [{ query: '', type: 'artist' }] })
      if (args.vegetarian) veto.vegetarian = true
      needsTaste = true
    }
  }
  return [scene, veto, needsTaste]
}

const FOLLOW_UPS = ['exclude_tags', 'widen_radius', 'exclude_place', 'prefer_budget', 'change_occasion']

// One observation turn proposes tools; the user chooses before new execution.
export async function observeReplan(env: Env, text: string, scene: Obj, actions: Action[], observation: Obj): Promise<[string, Obj[]]> {
  const limit = maxRadius(scene.area)
  let local: Action[]
  if (observation.remaining_count < 10 && observation.radius < limit) local = [{ name: 'widen_radius', arguments: { radius: limit } }]
  else if (observation.nothing_matched) local = [{ name: 'exclude_tags', arguments: { tags: ['Loud', 'Busy', 'Lively'] } }]
  else local = [{ name: 'exclude_place', arguments: { target: 'current' } }]
  const labelled = local.map((a) => ({ label: labelFor(a), ...a }))
  if (configured(env)) {
    try {
      const calls = actions.map((a, i) => ({ id: 'executed_' + i, type: 'function', function: { name: a.name, arguments: JSON.stringify(a.arguments) } }))
      const messages: Obj[] = [
        { role: 'system', content: 'Observe the executed tool results and propose ONE sensible alternative tool. Nothing matched means propose a different condition; fewer than ten candidates means suggest widening if possible. Do not change scores or execute anything. The user will choose.' },
        { role: 'user', content: JSON.stringify({ request: text, scene }) },
        { role: 'assistant', content: null, tool_calls: calls },
        ...calls.map((c) => ({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(observation) })),
      ]
      const payload = { model: env.LLM_MODEL, messages, tools: TOOLS.filter((t) => FOLLOW_UPS.includes(t.function.name)), tool_choice: 'required', max_tokens: 400 }
      const data = await postChat(env, payload)
      const c = data.choices[0].message.tool_calls[0].function
      const a = validate([{ name: c.name, arguments: JSON.parse(c.arguments) }])[0]
      if (a.name === 'widen_radius') a.arguments.radius = Math.min(a.arguments.radius, limit)
      if (a.name === 'widen_radius' && a.arguments.radius <= observation.radius) return ['Local planner', labelled]
      if (!FOLLOW_UPS.includes(a.name)) throw new ValueError('Unsupported follow-up')
      return ['LLM planner', [{ label: labelFor(a), ...a }]]
    } catch (err) {
      llmFailed('observe', err)
      return ['Local planner', labelled]
    }
  }
  return ['Local planner', labelled]
}
