import type { Page } from '@playwright/test'
import { addJoesPizza, conditions, record, type Plan, expect, expectScene, openFriends, options, question, shot, test } from './support'

// Every plan in these flows is answered from the local response cache, unless a test says otherwise.
test.afterEach(({ plans }) => {
  for (const p of plans) expect(p.misses, 'a Qloo step missed the cache').toBe(0)
  for (const p of plans) expect(p.fallback, 'a rescore failed and the plan fell back to rank-sum').toBeNull()
})

test('Try it 1 to 4 in sequence: No bars stays on at step 3', async ({ page, plans }) => {
  // 1. Opening scene.
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await expect(page.getByText('Williamsburg NYC · Dinner · within 2 km · 44 candidates')).toBeVisible()
  await expect(page.locator('[data-tt="friends"]')).toContainText('3')
  await shot(page, 'desktop-try1-default')

  // 2. Typed condition and Replan.
  await page.getByRole('textbox', { name: 'One more condition' }).fill('No bars please')
  await page.getByRole('button', { name: 'Replan' }).click()
  await expectScene(page, 'Lilia', 17)
  await expect(page.locator('[data-tt="agent-strip"]')).toContainText('Observe → replan')
  await expect(page.locator('[data-tt="change"]')).toContainText('44 → 17 places')
  await expect(conditions(page)).toHaveText(['No bars'])
  await shot(page, 'desktop-try2-no-bars')

  // 3. Replace friend 2. The condition stays: Lilia over 18 places, and the chip says why.
  await openFriends(page)
  await expect(page.locator('[data-tt="kept-conditions"]')).toContainText('Keeps No bars')
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expectScene(page, 'Lilia', 18)
  expect(plans.at(-1)!.body.veto).toMatchObject({ categories: ['bar', 'nightclub', 'pub'] })
  await expect(conditions(page)).toHaveText(['No bars'])
  await expect(page.getByRole('button', { name: 'No bars please', exact: true })).toHaveCount(0)
  await shot(page, 'desktop-try3-replace-keeps-no-bars')

  // 4. Add a friend whose taste is a place: the agent asks which Joe's Pizza, each branch once.
  await addJoesPizza(page)
  await expect(question(page)).toBeVisible()
  const addresses = (await options(page).allInnerTexts()).map((t) => t.split(' · ').at(-1)!.trim())
  expect(addresses).toHaveLength(4)
  expect(new Set(addresses).size).toBe(4)
  expect(plans.at(-1)!.body.veto).toMatchObject({ categories: ['bar', 'nightclub', 'pub'] })
  await shot(page, 'desktop-try4-question')
})

test('Try it 3 from the opening scene moves the fair pick to Five Leaves', async ({ page }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await openFriends(page)
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expectScene(page, 'Five Leaves', 47)
  await expect(page.getByRole('list', { name: 'Active conditions' })).toHaveCount(0)
})

test('P1: conditions stay through friend edits, show as chips and can be removed one by one', async ({ page, plans }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await page.getByRole('button', { name: 'No bars please', exact: true }).click()
  await expectScene(page, 'Lilia', 17)
  await page.getByRole('button', { name: 'Somewhere quieter', exact: true }).click()
  await expectScene(page, 'Aska', 3)
  await expect(conditions(page)).toHaveText(['No bars', 'Somewhere quieter'])
  await expect(page.getByRole('button', { name: 'Reset exclusions' })).toBeVisible()
  await shot(page, 'desktop-p1-two-conditions')

  await page.getByRole('button', { name: 'Remove condition: Somewhere quieter' }).click()
  await expectScene(page, 'Lilia', 17)
  await expect(conditions(page)).toHaveText(['No bars'])
  expect(plans.at(-1)!.body.veto_text).toBe('')

  // A friend edit keeps the condition; removing it afterwards gives the scene without it.
  await openFriends(page)
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expectScene(page, 'Lilia', 18)
  await expect(conditions(page)).toHaveText(['No bars'])
  await page.getByRole('button', { name: 'Remove condition: No bars' }).click()
  await expectScene(page, 'Five Leaves', 47)
  await expect(page.getByRole('list', { name: 'Active conditions' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'No bars please', exact: true })).toBeVisible()
  await shot(page, 'desktop-p1-removed')
})

test('P1: quieter and cheaper stay through a taste edit, and the agent widens the radius again', async ({ page, plans }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  // Typed, so the local parser reads both conditions; only 2 places remain, found at 3.5 km.
  await page.getByRole('textbox', { name: 'One more condition' }).fill('Somewhere quieter and cheaper')
  await page.getByRole('button', { name: 'Replan' }).click()
  await expectScene(page, 'The Brooklyn Star', 2)
  await expect(page.getByText('Williamsburg NYC · Dinner · within 3.5 km · 2 candidates')).toBeVisible()
  await expect(conditions(page)).toHaveText(['Somewhere quieter', 'Cheaper places'])

  // Indie + jazz leaves and is typed back in last. The scene starts at 2 km again, so 3.5 km means the
  // conditions came back and the agent widened again; without them it is 44 places at 2 km.
  await openFriends(page)
  await expect(page.locator('[data-tt="kept-conditions"]')).toContainText('Keeps Somewhere quieter · Cheaper places')
  await moveLast(page, 'Indie + jazz', [['movie', 'Moonrise Kingdom'], ['artist', 'Miles Davis']])
  await expectScene(page, 'The Brooklyn Star', 2)
  const last = plans.at(-1)!.body as Plan['body'] & { start_radius: number }
  expect(last.people.map((p) => p.name)).toEqual(['K-pop + streetwear', 'Pop + athleisure', 'Indie + jazz'])
  expect(last).toMatchObject({ veto_text: '', start_radius: 2000, veto: { tags: ['Busy', 'Lively', 'Loud'], max_price_level: 2 } })
  await expect(page.getByText('Williamsburg NYC · Dinner · within 3.5 km · 2 candidates')).toBeVisible()
  await expect(conditions(page)).toHaveText(['Somewhere quieter', 'Cheaper places'])
  await shot(page, 'desktop-p1-quieter-cheaper-after-edit')
})

test('P2: reload, Back and Forward show each finished scene again without a new plan', async ({ page, plans }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await page.getByRole('button', { name: 'No bars please', exact: true }).click()
  await expectScene(page, 'Lilia', 17)
  await openFriends(page)
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expectScene(page, 'Lilia', 18)
  expect(page.url()).toContain('#scene=')
  const sent = plans.length

  await page.reload()
  await expectScene(page, 'Lilia', 18)
  await expect(conditions(page)).toHaveText(['No bars'])
  await expect(page.locator('[data-tt="friends"]')).toContainText('3')
  await openFriends(page)
  await expect(page.getByLabel('Friend 2 name')).toHaveValue('Hip-hop + sneakers')
  await page.keyboard.press('Escape')
  await shot(page, 'desktop-p2-after-reload')

  await page.goBack()
  await expectScene(page, 'Lilia', 17)
  await expect(conditions(page)).toHaveText(['No bars'])
  await page.goBack()
  await expectScene(page, 'Maison Premiere', 44)
  await expect(page.getByRole('list', { name: 'Active conditions' })).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('')
  await page.goForward()
  await expectScene(page, 'Lilia', 17)
  await page.goForward()
  await expectScene(page, 'Lilia', 18)
  expect(plans.length, 'reload, Back and Forward sent plans').toBe(sent)

  // The editor carries on from the restored scene with its conditions.
  await openFriends(page)
  await page.getByRole('button', { name: 'K-pop + streetwear', exact: true }).click()
  await expectScene(page, 'Lilia', 17)
  expect(plans.at(-1)!.body.veto).toMatchObject({ categories: ['bar', 'nightclub', 'pub'] })
})

test('P2: a reload while a plan runs shows the last finished scene and sends no new plan', async ({ page }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await page.getByRole('button', { name: 'No bars please', exact: true }).click()
  await expectScene(page, 'Lilia', 17)
  // Hold the next plan so the reload lands while the agent works.
  await page.route('**/api/plan', async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 3000))
    await route.fallback().catch(() => {})
  })
  await openFriends(page)
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expect(page.locator('[data-tt-busy="true"]')).toHaveCount(1)
  let after = 0
  page.on('request', (r) => {
    if (r.url().endsWith('/api/plan')) after++
  })
  await page.reload()
  await expectScene(page, 'Lilia', 17)
  await expect(conditions(page)).toHaveText(['No bars'])
  await page.waitForTimeout(3500)
  await expect(page.locator('[data-sonner-toast][data-type="error"]')).toHaveCount(0)
  expect(after).toBe(0)
  await shot(page, 'desktop-p2-reload-during-plan')
})

test('P2: the copied scene link is the address bar link and replays the conditions in a new tab', async ({ page, plans, browser, baseURL }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL })
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await page.getByRole('button', { name: 'No bars please', exact: true }).click()
  await expectScene(page, 'Lilia', 17)
  await page.getByRole('button', { name: 'Copy scene link' }).click()
  await expect(page.getByText('Scene link copied')).toBeVisible()
  const link = await page.evaluate(() => navigator.clipboard.readText())
  expect(link).toBe(page.url())

  const fresh = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const replay: Plan[] = []
  await record(fresh, replay)
  const tab = await fresh.newPage()
  await tab.goto(link)
  await expectScene(tab, 'Lilia', 17)
  await expect(conditions(tab)).toHaveText(['No bars'])
  expect(replay).toHaveLength(1)
  expect(replay[0].body).toMatchObject({ veto_text: '', veto: { categories: ['bar', 'nightclub', 'pub'] } })
  expect(replay[0].misses).toBe(0)
  expect(replay[0].qloo).toBeGreaterThan(0)
  await fresh.close()
  expect(plans.every((p) => p.misses === 0)).toBe(true)
})

// Removes a friend in the open editor and adds them back last with the same tastes, so every friend
// after them moves up one place while the scene's Qloo requests stay the same.
async function moveLast(page: Page, name: string, seeds: [string, string][]) {
  await page.getByRole('button', { name: `Remove ${name}`, exact: true }).click()
  await page.getByRole('button', { name: 'Add friend', exact: true }).click()
  const n = await page.locator('li[aria-label^="Friend "]').count()
  const friend = page.locator(`li[aria-label="Friend ${n}"]`)
  await page.getByLabel(`Friend ${n} name`).fill(name)
  for (const [k, [type, query]] of seeds.entries()) {
    if (k) await friend.getByRole('button', { name: 'Add taste' }).click()
    await friend.locator('select').nth(k).selectOption(type)
    await page.locator(`#seed-${n - 1}-${k}`).fill(query)
  }
  await page.getByRole('button', { name: 'Recompute ranks', exact: true }).click()
}

test("P2b: a resolved Joe's Pizza is not asked again when another friend changes", async ({ page, plans }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await openFriends(page)
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).click()
  await expectScene(page, 'Five Leaves', 47)
  await addJoesPizza(page)
  await expect(question(page)).toBeVisible()
  // The first branch is outside the Brooklyn pool, so the plan stays a full maximin ranking.
  await options(page).first().getByRole('button').click()
  await expectScene(page, 'Five Leaves', 50)
  const asked = () => plans.filter((p) => p.status === 'clarification').length
  expect(asked()).toBe(1)
  const joe = plans.at(-1)!.body.choices['3:0']
  expect(joe).toBeTruthy()

  // Friend 1 leaves and comes back last: Joe's Pizza moves from friend 4 to friend 3.
  await openFriends(page)
  await moveLast(page, 'Indie + jazz', [['movie', 'Moonrise Kingdom'], ['artist', 'Miles Davis']])
  await expectScene(page, 'Five Leaves', 50)
  await expect(question(page)).toHaveCount(0)
  expect(asked()).toBe(1)
  let last = plans.at(-1)!
  expect(last.body.people.map((p) => p.name)).toEqual(['Hip-hop + sneakers', 'Pop + athleisure', 'Friend 4', 'Indie + jazz'])
  expect(last.body.choices['2:0']).toBe(joe)
  await shot(page, 'desktop-p2b-no-second-question')

  // After a reload the answer is still known.
  await page.reload()
  await expectScene(page, 'Five Leaves', 50)
  await openFriends(page)
  await moveLast(page, 'Hip-hop + sneakers', [['artist', 'Kendrick Lamar'], ['brand', 'Nike']])
  await expectScene(page, 'Five Leaves', 50)
  await expect(question(page)).toHaveCount(0)
  expect(asked()).toBe(1)
  last = plans.at(-1)!
  expect(last.body.people.map((p) => p.name)).toEqual(['Pop + athleisure', 'Friend 4', 'Indie + jazz', 'Hip-hop + sneakers'])
  expect(last.body.choices['1:0']).toBe(joe)
})

test('/classic plans No bars and keeps the result through reload and Back', async ({ page, plans }) => {
  await page.goto('/classic')
  await expect(page.locator('#pick-name')).toHaveText('Maison Premiere')
  await page.locator('#veto').fill('No bars please')
  await page.locator('#veto-form').getByRole('button', { name: 'Replan' }).click()
  await expect(page.locator('#pick-name')).toHaveText('Lilia', { timeout: 60_000 })
  const sent = plans.length
  await page.reload()
  await expect(page.locator('#pick-name')).toHaveText('Lilia')
  await page.getByRole('link', { name: 'taste truce' }).click()
  await expectScene(page, 'Maison Premiere', 44)
  await page.goBack()
  await expect(page).toHaveURL(/\/classic$/)
  await expect(page.locator('#pick-name')).toHaveText('Lilia')
  expect(plans.length).toBe(sent)
  await shot(page, 'desktop-classic-after-back')
})
