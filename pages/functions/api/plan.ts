import { plan, type Env } from '../../src/http.ts'

export const onRequestPost: PagesFunction<Env> = (ctx) => plan(ctx.request, ctx.env, (p) => ctx.waitUntil(p))
