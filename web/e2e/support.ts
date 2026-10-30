import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { test as base, expect, type BrowserContext, type Page } from '@playwright/test'

// One /api/plan exchange as the page saw it: what was sent and how the agent answered.
export type Plan = { body: { people: { name: string; seeds: { query: string; type: string }[] }[]; choices: Record<string, string>; veto: Record<string, unknown>; veto_text: string }; qloo: number; misses: number; fallback: string | null; error: string | null; status: string | null }

// Records every /api/plan exchange of a browser context. The route reads the whole answer before the page
// gets it, so the page sees the result at once instead of step by step. `misses` counts Qloo steps the
// cache did not answer; the local server has no Qloo key, so such a request ends in an error instead.
// `fallback` says why a finished plan did not rescore every friend: a rescore the cache could not answer
// fails without a step, and the agent falls back to rank-sum, so `misses` alone would still read 0.
export async function record(context: BrowserContext, plans: Plan[]) {
  await context.route('**/api/plan', async (route) => {
    const plan: Plan = { body: route.request().postDataJSON(), qloo: 0, misses: 0, fallback: null, error: null, status: null }
    plans.push(plan)
    let response, text
    try {
      response = await route.fetch()
      text = await response.text()
    } catch {
      // The page went away (a reload) while the plan was held; nothing is left to answer.
      plan.error = 'page left before the answer'
      return
    }
    const events = response.ok() ? text.split('\n').filter(Boolean).map((line) => JSON.parse(line)) : []
    const steps = events.filter((e) => e.event === 'step').map((e) => e.step)
    const last = events.at(-1)
    plan.qloo = steps.filter((x) => 'cache' in x).length
    plan.misses = steps.filter((x) => x.cache === false).length
    plan.error = last?.event === 'error' ? last.message : response.ok() ? null : `HTTP ${response.status()}`
    plan.status = last?.event === 'result' ? last.result.status : null
    if (plan.status === 'done') plan.fallback = fallback(last.result, steps)
    await route.fulfill({ response, body: text }).catch(() => {})
  })
}

// Why a finished plan is not a full rescore of every friend, or null when it is.
export function fallback(result: { method?: string; people?: unknown[] }, steps: { tool: string }[]) {
  const rescored = steps.filter((x) => x.tool === '/v2/insights · rescore').length
  if (result.method !== 'maximin-rank' || steps.some((x) => x.tool.includes('rank-sum'))) return `method ${result.method}`
  if (rescored !== (result.people?.length ?? -1)) return `${rescored} rescore steps for ${result.people?.length} friends`
  return null
}

export const test = base.extend<{ plans: Plan[] }>({
  plans: [async ({ page }, use, info) => {
    const plans: Plan[] = []
    await record(page.context(), plans)
    await use(plans)
    const tally = { test: info.title, project: info.project.name, plans: plans.length, qlooSteps: plans.reduce((n, p) => n + p.qloo, 0), misses: plans.reduce((n, p) => n + p.misses, 0), fallbacks: plans.filter((p) => p.fallback).map((p) => p.fallback), errors: plans.filter((p) => p.error).map((p) => p.error) }
    mkdirSync(process.env.TT_SHOTS!, { recursive: true })
    appendFileSync(join(process.env.TT_SHOTS!, '..', 'qloo-tally.jsonl'), JSON.stringify(tally) + '\n')
    await info.attach('qloo-tally', { body: JSON.stringify(tally, null, 1), contentType: 'application/json' })
  }, { auto: true }],
})
export { expect }

export const shot = (page: Page, name: string) => page.screenshot({ path: join(process.env.TT_SHOTS!, name + '.png') })

const idle = (page: Page) => page.evaluate(() => document.querySelector('[data-tt-busy]')?.getAttribute('data-tt-busy') === 'false')

// The fair pick and the candidate count the hero shows ("… of 17", "Lowest rank sum of 84").
export async function shown(page: Page) {
  const pick = page.locator('[data-tt="pick"]')
  if (!(await pick.count())) return null
  const hero = await pick.locator('xpath=..').innerText()
  return { pick: (await pick.innerText()).trim(), pool: Number(/of (\d+)/.exec(hero)?.[1]) }
}

// Waits until no plan runs and the hero shows this pick and count.
export async function expectScene(page: Page, pick: string, pool: number) {
  await expect.poll(async () => ((await idle(page)) ? await shown(page) : null), { timeout: 60_000 }).toEqual({ pick, pool })
}

export const conditions = (page: Page) => page.getByRole('list', { name: 'Active conditions' }).getByRole('button')

export async function openFriends(page: Page) {
  await page.locator('[data-tt="friends"]').click()
  await page.getByRole('heading', { name: 'Friends and scene' }).waitFor()
}

export async function addJoesPizza(page: Page) {
  await openFriends(page)
  await page.getByRole('button', { name: 'Add friend', exact: true }).click()
  const n = await page.locator('li[aria-label^="Friend "]').count()
  await page.locator(`li[aria-label="Friend ${n}"] select`).selectOption('place')
  await page.locator(`#seed-${n - 1}-0`).fill("Joe's Pizza")
  await page.getByRole('button', { name: 'Recompute ranks', exact: true }).click()
}

export const question = (page: Page) => page.getByRole('heading', { name: 'Which “Joe\'s Pizza”?', exact: true })
export const options = (page: Page) => page.getByRole('list', { name: 'Matches', exact: true }).getByRole('listitem')
