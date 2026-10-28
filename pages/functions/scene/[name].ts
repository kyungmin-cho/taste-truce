import { scene, type Env } from '../../src/http.ts'

export const onRequestGet: PagesFunction<Env> = (ctx) => scene(ctx.env, String(ctx.params.name))
