import { page, type Env } from '../src/http.ts'

// The previous interface, kept reachable; it shares the API and the session.
export const onRequestGet: PagesFunction<Env> = (ctx) => page(ctx.request, ctx.env, ctx.next)
