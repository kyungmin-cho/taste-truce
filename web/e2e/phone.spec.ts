import { conditions, expect, expectScene, openFriends, options, question, shot, test, addJoesPizza } from './support'

test.afterEach(({ plans }) => {
  for (const p of plans) expect(p.misses, 'a Qloo step missed the cache').toBe(0)
})

// 390 px wide: the scene sheet holds the pick, the conditions and the Friends button.
test('390 px: Try it 1 to 4, conditions on view, and a reload keeps the scene', async ({ page, plans }) => {
  await page.goto('/')
  await expectScene(page, 'Maison Premiere', 44)
  await shot(page, 'phone-try1-default')

  await page.getByRole('button', { name: 'No bars please', exact: true }).tap()
  await expectScene(page, 'Lilia', 17)
  await expect(page.locator('[data-tt="agent-strip"]')).toContainText('Observe → replan')
  await expect(conditions(page)).toHaveText(['No bars'])
  await conditions(page).first().scrollIntoViewIfNeeded()
  await shot(page, 'phone-try2-no-bars')

  await openFriends(page)
  await expect(page.locator('[data-tt="kept-conditions"]')).toBeVisible()
  await page.getByRole('button', { name: 'Hip-hop + sneakers', exact: true }).tap()
  await expectScene(page, 'Lilia', 31)
  await expect(conditions(page)).toHaveText(['No bars'])

  const sent = plans.length
  await page.reload()
  await expectScene(page, 'Lilia', 31)
  await expect(conditions(page)).toHaveText(['No bars'])
  expect(plans.length).toBe(sent)
  await shot(page, 'phone-try3-after-reload')

  await addJoesPizza(page)
  await expect(question(page)).toBeVisible()
  await expect(options(page)).toHaveCount(4)
  await shot(page, 'phone-try4-question')
})
