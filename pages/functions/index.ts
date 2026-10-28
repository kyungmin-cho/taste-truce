import { page, type Env } from '../src/http.ts'

export const onRequestGet: PagesFunction<Env> = (ctx) => page(ctx.request, ctx.env, ctx.next)
