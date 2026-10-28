import { health, type Env } from '../src/http.ts'

export const onRequestGet: PagesFunction<Env> = (ctx) => health(ctx.env)
