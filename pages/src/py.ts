// Small pieces of Python behavior the port relies on, so both servers give the same answers.

// Python's exception kinds that reach the visitor: ValueError and QlooError messages are shown,
// anything else becomes the generic message, exactly as server.py does.
export class ValueError extends Error {}
export class QlooError extends Error {}
export class BudgetError extends QlooError {}
export class PlannerError extends ValueError {
  planner: string
  constructor(message: string, planner: string) {
    super(message)
    this.planner = planner
  }
}
// Stands in for TypeError, AttributeError and KeyError on malformed input.
export class InternalError extends Error {}

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Obj = { [key: string]: any }

export const isDict = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
export const hashable = (v: unknown) => typeof v !== 'object' || v === null

// Python truthiness of JSON values.
export function truthy(v: unknown): boolean {
  if (Array.isArray(v)) return v.length > 0
  if (isDict(v)) return Object.keys(v).length > 0
  return !!v
}

// len() counts code points, not UTF-16 units.
export function pyLen(v: unknown): number {
  if (typeof v === 'string') return [...v].length
  if (Array.isArray(v)) return v.length
  if (isDict(v)) return Object.keys(v).length
  throw new InternalError('object has no len()')
}

const SPACE = '\\t\\n\\v\\f\\r\\x1c-\\x1f \\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000'
const STRIP = new RegExp(`^[${SPACE}]+|[${SPACE}]+$`, 'gu')
STRIP.test('warm up')
export const strip = (s: string) => s.replace(STRIP, '')
export const casefold = (s: string) => s.toLowerCase().replace(/ß/g, 'ss').replace(/ς/g, 'σ')
export const slice = (s: string, n: number) => [...s].slice(0, n).join('')

// str() of a JSON value, as used on veto_text.
export function pyStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === null || v === undefined) return 'None'
  if (v === true) return 'True'
  if (v === false) return 'False'
  if (typeof v === 'number') return String(v)
  return JSON.stringify(v)
}

// Python's == on JSON values (dict key order does not matter).
export function pyEq(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEq(x, b[i]))
  }
  if (isDict(a) || isDict(b)) {
    if (!isDict(a) || !isDict(b)) return false
    const ka = Object.keys(a)
    return ka.length === Object.keys(b).length && ka.every((k) => Object.hasOwn(b, k) && pyEq(a[k], b[k]))
  }
  return a === b
}

// Ordering of Python tuples of numbers and strings.
export function cmp(a: (number | string)[], b: (number | string)[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1
    if (a[i] > b[i]) return 1
  }
  return a.length - b.length
}
export const sorted = (xs: Iterable<string>) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

// Python's re treats \b and \d as Unicode-aware; JavaScript's \b only knows ASCII letters.
const W = '[\\p{L}\\p{N}_]'
const BOUNDARY = `(?:(?<=${W})(?!${W})|(?<!${W})(?=${W}))`
// Each pattern runs once when the module loads: compiling the Unicode classes costs about a
// millisecond per pattern, and the Workers runtime counts global scope as startup, not request time.
export function re(source: string, flags = '') {
  const pattern = new RegExp(source.replace(/\\b/g, BOUNDARY).replace(/\\d/g, '\\p{Nd}'), flags + 'u')
  pattern.test('warm up')
  pattern.lastIndex = 0
  return pattern
}

// json.dumps(value, sort_keys=True) for the cache key: ', ' and ': ' separators, non-ASCII escaped.
export function dumps(value: Json): string {
  if (typeof value === 'string') return JSON.stringify(value).replace(/[\u0080-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'))
  if (Array.isArray(value)) return '[' + value.map(dumps).join(', ') + ']'
  if (isDict(value)) return '{' + sorted(Object.keys(value)).map((k) => dumps(k) + ': ' + dumps(value[k])).join(', ') + '}'
  return JSON.stringify(value)
}

export async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// The same cache key as qloo.Qloo.signature: every parameter value as str().
export function signature(path: string, params: Obj): Promise<string> {
  const values: { [key: string]: Json } = {}
  for (const [k, v] of Object.entries(params)) values[k] = pyStr(v)
  return sha256(dumps([path, values]))
}

// f'{x:g}' for the radius labels.
export const g = (x: number) => String(Number(x.toPrecision(6)))
