// Port of server.py's routes. Static files are served by Pages; these are the dynamic paths.
import { DEFAULT_PEOPLE, run } from './agent.ts'
import { BudgetError, QlooError, ValueError, isDict, pyEq, pyStr, truthy, type Obj } from './py.ts'
import { Qloo, type KV } from './qloo.ts'
import { PRESETS, defaultScene, health as sceneHealth, publicJson, readScene, saveScene, sceneBody, sceneMeta } from './scenes.ts'
import { D1Store, cookieToken, type D1 } from './store.ts'

export type Env = Obj & { CACHE: KV; DB: D1 }

const LIMIT = 20000

function headers(contentType: string, extra: Obj = {}): Headers {
  return new Headers({ 'Content-Type': contentType, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Cache-Control': 'no-store', ...extra })
}
export const json = (status: number, data: unknown) => new Response(JSON.stringify(data), { status, headers: headers('application/json') })

const ip = (request: Request) => request.headers.get('CF-Connecting-IP') || '127.0.0.1'

export function config(env: Env) {
  const presets = Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label, ...sceneBody(k) }]))
  return json(200, { people: DEFAULT_PEOPLE, default_scene: defaultScene(env), presets })
}

export async function health(env: Env) {
  const state = await sceneHealth(env.CACHE, env)
  return json(state.ready ? 200 : 503, state)
}

export async function scene(env: Env, name: string) {
  const text = await readScene(env.CACHE, env, name === 'default' ? defaultScene(env) : name)
  if (text === null) return json(503, { result: null, error: 'The saved scene is still being prepared. Please reload in a minute.' })
  return new Response('{"result": ' + text + ', "error": null}', { status: 200, headers: headers('application/json') })
}

// / and /classic: the page itself comes from Pages; the session cookie is issued with it.
export async function page(request: Request, env: Env, next: () => Promise<Response>) {
  const asset = await next()
  const response = new Response(asset.body, { status: asset.status, headers: headers(asset.headers.get('Content-Type') || 'text/html; charset=utf-8') })
  if (asset.status !== 200) return response
  try {
    const token = await new D1Store(env, env.DB).issue(cookieToken(request.headers.get('Cookie')), ip(request))
    const secure = new URL(request.url).protocol === 'https:' || env.COOKIE_SECURE === '1'
    response.headers.set('Set-Cookie', `taste_session=${token}; HttpOnly; SameSite=Strict; Path=/` + (secure ? '; Secure' : ''))
  } catch (err) {
    console.error('session not issued: ' + (err as Error).message)
  }
  return response
}

async function readBody(request: Request): Promise<Obj | null> {
  try {
    const length = Number(request.headers.get('Content-Length') ?? '0')
    if (!Number.isInteger(length) || !(0 < length && length <= LIMIT)) return null
    const bytes = await request.arrayBuffer()
    if (!(0 < bytes.byteLength && bytes.byteLength <= LIMIT)) return null
    const body = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes))
    return isDict(body) ? body : null
  } catch {
    return null
  }
}

export async function plan(request: Request, env: Env, waitUntil: (p: Promise<unknown>) => void = () => {}) {
  const origin = request.headers.get('Origin')
  if (origin) {
    let host = ''
    try {
      host = new URL(origin).host
    } catch {}
    if (host !== new URL(request.url).host) return json(403, { error: 'Origin not allowed' })
  }
  const body = await readBody(request)
  if (!body) return json(400, { error: 'Invalid plan request' })
  const store = new D1Store(env, env.DB)
  const [session, error] = await store.acquire(cookieToken(request.headers.get('Cookie')), ip(request))
  if (error === 'unknown') return json(403, { error: 'Open the home page to start a valid session.' })
  if (error === 'limit') return json(429, { error: 'Daily new-session limit reached. The saved scene remains available.' })
  if (error === 'plans') return json(429, { error: 'Daily plan limit reached. The saved scene remains available.' })
  if (error === 'busy') return json(409, { error: 'A plan is already running in this session' })
  const stream = new TransformStream<Uint8Array, Uint8Array>()
  const writer = stream.writable.getWriter()
  const encoder = new TextEncoder()
  let disconnected = false
  const send = (line: string) => {
    if (disconnected) return
    writer.write(encoder.encode(line + '\n')).catch(() => { disconnected = true })
  }
  const emit = (event: Obj) => send(JSON.stringify(event))
  const qloo = new Qloo(env, env.CACHE, store)
  const work = (async () => {
    try {
      const result = await run(env, qloo, session!, body, emit)
      // Visitors may fill a missing snapshot, never replace one: choices, text and
      // suggested actions can change the result while the scene inputs look identical.
      if (result.status === 'done' && !Object.values(result.veto).some(truthy) && !truthy(body.choices) && !pyStr(Object.hasOwn(body, 'veto_text') ? body.veto_text : '').trim() && !truthy(body.suggested_action)) {
        for (const name of Object.keys(PRESETS)) {
          const expected = sceneBody(name)
          if (Object.entries(expected).every(([k, v]) => pyEq(result[k], v)) && (await sceneMeta(env.CACHE, env, name)) === null) await saveScene(env.CACHE, name, result)
        }
      }
      send(publicJson({ event: 'result', result }))
    } catch (err) {
      if (err instanceof BudgetError) {
        const saved = await readScene(env.CACHE, env, defaultScene(env))
        if (saved) emit({ event: 'result', result: { ...JSON.parse(saved), notice: err.message + ' Showing the saved default scene; your edits were not applied.' } })
        else emit({ event: 'error', message: err.message + ' No saved default scene is available yet.' })
      } else if (err instanceof QlooError || err instanceof ValueError) emit({ event: 'error', message: err.message })
      else {
        console.error('plan failed: ' + ((err as Error)?.name || 'Error'))
        emit({ event: 'error', message: 'The plan could not be completed. Please try again.' })
      }
    } finally {
      await store.release(session!).catch(() => {})
      await writer.close().catch(() => {})
    }
  })()
  waitUntil(work)
  return new Response(stream.readable, { status: 200, headers: headers('application/x-ndjson; charset=utf-8') })
}
