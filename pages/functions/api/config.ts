import { config, type Env } from '../../src/http.ts'

export const onRequestGet: PagesFunction<Env> = (ctx) => config(ctx.env)
