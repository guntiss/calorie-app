import { expect, test, type Locator, type Page } from '@playwright/test'
import { chooseMeal, fillLogModal, logFood, modal, openLogModal, signIn, startDay } from './support'

/**
 * Moving a logged row: up and down inside its meal, and across into another.
 *
 * Both are the one gesture — the row held until it comes up, then dragged — and
 * both are also the row's two hidden move buttons, which is how a keyboard
 * reaches them. Each is exercised the way it is actually done.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** One meal's card, found by the name in its header. */
function card(page: Page, meal: string) {
  return page.locator('[data-meal]').filter({ has: page.getByRole('heading', { name: meal }) })
}

/** The names on a card's rows, top to bottom. */
function names(scope: Locator) {
  return scope.locator('[data-entry] [data-food]').allTextContents()
}

/**
 * The day as it was stored, meal by meal and in order within each.
 *
 * The grid is what says a row moved; this is what says the move was saved. The
 * server hands back a day ordered by position alone, so the meals are put back
 * in their own order here — the order the grid draws them in.
 */
async function stored(page: Page, date: string) {
  interface Row { mealId: string | null, position: number, nameSnapshot: string }
  const day = await (await page.request.get(`/api/log/${date}`)).json()
  const meals = new Map<string, { name: string, position: number }>(
    day.meals.map((m: { id: string, name: string, position: number }) => [m.id, m])
  )

  return (day.entries as Row[])
    .slice()
    .sort((a, b) =>
      (meals.get(a.mealId!)?.position ?? 99) - (meals.get(b.mealId!)?.position ?? 99)
      || a.position - b.position)
    .map(row => `${meals.get(row.mealId!)?.name ?? 'Unsorted'}: ${row.nameSnapshot}`)
}

/**
 * Hold a row until it comes up, then drag it to a point on the page.
 *
 * Pressed on the name, which is the part of the row that is not a control, and
 * held out past the moment the row is picked up. Then in steps with a breath
 * between them: where the row would land is worked out from whatever is under
 * the pointer, one animation frame at a time, and a mouse that teleports gives
 * the drag nothing to read.
 */
async function dragTo(page: Page, row: Locator, y: number) {
  const box = await row.locator('[data-food]').boundingBox()
  if (!box) throw new Error('the row is not on screen')

  const x = box.x + 10
  const from = box.y + box.height / 2

  await page.mouse.move(x, from)
  await page.mouse.down()
  await expect(row).toHaveClass(/ring-primary/, { timeout: 2000 })

  for (const step of [0.3, 0.7, 1]) {
    await page.mouse.move(x, from + (y - from) * step)
    await page.waitForTimeout(40)
  }

  // Let go once the day has said where this would land — the line against a
  // row, or the ring around a meal with no rows to draw one on. Waiting for
  // what the drop is about to do beats waiting for a length of time.
  await expect(page.locator('[data-entry] .bg-primary.h-0\\.5, [data-meal].ring-2').first())
    .toBeVisible({ timeout: 2000 })
  await page.mouse.up()
}

/** The vertical middle of a row, which is the half a drop rounds towards. */
async function middleOf(row: Locator) {
  const box = await row.boundingBox()
  if (!box) throw new Error('the row is not on screen')
  return box.y + box.height / 2
}

test('a row is dragged up and down its meal, and the order is saved', async ({ page }) => {
  const date = '2030-04-02'
  await startDay(page, date)

  await logFood(page, 'breakfast', 'Reorder oats')
  await logFood(page, 'breakfast', 'Reorder eggs')
  await logFood(page, 'breakfast', 'Reorder toast')

  const breakfast = card(page, 'Breakfast')
  await expect(breakfast.locator('[data-entry]')).toHaveCount(3)
  expect(await names(breakfast)).toEqual(['Reorder oats', 'Reorder eggs', 'Reorder toast'])

  // --- the first row, dropped below the last ------------------------------
  const last = breakfast.locator('[data-entry]').nth(2)
  const belowLast = (await middleOf(last)) + 12

  await dragTo(page, breakfast.locator('[data-entry]').first(), belowLast)
  expect(await names(breakfast)).toEqual(['Reorder eggs', 'Reorder toast', 'Reorder oats'])

  await expect.poll(() => stored(page, date)).toEqual([
    'Breakfast: Reorder eggs',
    'Breakfast: Reorder toast',
    'Breakfast: Reorder oats'
  ])

  // --- and back up, above the first ---------------------------------------
  const first = breakfast.locator('[data-entry]').first()
  const aboveFirst = (await middleOf(first)) - 12

  await dragTo(page, breakfast.locator('[data-entry]').nth(2), aboveFirst)
  expect(await names(breakfast)).toEqual(['Reorder oats', 'Reorder eggs', 'Reorder toast'])

  // The order survives the round trip, rather than only the grid believing it.
  await expect.poll(() => stored(page, date)).toEqual([
    'Breakfast: Reorder oats',
    'Breakfast: Reorder eggs',
    'Breakfast: Reorder toast'
  ])

  await page.reload()
  const reloaded = card(page, 'Breakfast')
  await expect(reloaded.locator('[data-entry]')).toHaveCount(3)
  expect(await names(reloaded)).toEqual(['Reorder oats', 'Reorder eggs', 'Reorder toast'])
})

test('a row is dragged into another meal, empty or not', async ({ page }) => {
  const date = '2030-04-03'
  await startDay(page, date)

  await logFood(page, 'breakfast', 'Moving pear')
  await logFood(page, 'dinner', 'Settled rice')

  const breakfast = card(page, 'Breakfast')
  const lunch = card(page, 'Lunch')
  const dinner = card(page, 'Dinner')

  // --- into a meal with nothing in it yet ---------------------------------
  // There is no row to drop against, so the card itself is the target.
  const lunchBox = await lunch.boundingBox()
  await dragTo(page, breakfast.locator('[data-entry]'), lunchBox!.y + lunchBox!.height / 2)

  await expect(breakfast.locator('[data-entry]')).toHaveCount(0)
  expect(await names(lunch)).toEqual(['Moving pear'])

  await expect.poll(() => stored(page, date)).toEqual([
    'Lunch: Moving pear',
    'Dinner: Settled rice'
  ])

  // --- on across, above a row already there -------------------------------
  const above = (await middleOf(dinner.locator('[data-entry]'))) - 12
  await dragTo(page, lunch.locator('[data-entry]'), above)

  await expect(lunch.locator('[data-entry]')).toHaveCount(0)
  expect(await names(dinner)).toEqual(['Moving pear', 'Settled rice'])

  await expect.poll(() => stored(page, date)).toEqual([
    'Dinner: Moving pear',
    'Dinner: Settled rice'
  ])

  await page.reload()
  const reloaded = card(page, 'Dinner')
  await expect(reloaded.locator('[data-entry]')).toHaveCount(2)
  expect(await names(reloaded)).toEqual(['Moving pear', 'Settled rice'])
})

/**
 * What the finger moves is the line, and only the line.
 *
 * The row stays in its place while it is held. It used to travel under the
 * finger, which meant being told every frame where the finger was in the page's
 * terms — and a phone browser is entitled to move the page underneath the
 * gesture, or to take the gesture away and go on scrolling with it. The row
 * ended up somewhere of its own either way. Nothing here asks where the page
 * is: the line is drawn against whatever row the finger is over.
 *
 * Driven by real touches rather than the mouse, because what is being kept out
 * of this is the page scrolling under a finger, and only a touch does that.
 */
test('the day and the row it is holding keep out of each other', async ({ page, context }) => {
  const date = '2030-04-05'
  await startDay(page, date)

  // Long enough to have somewhere to scroll to.
  await openLogModal(page)
  await chooseMeal(page, 'breakfast')
  for (let i = 0; i < 10; i++) await fillLogModal(page, `Held ${i}`, { another: true })
  await page.keyboard.press('Escape')
  await expect(modal(page)).toHaveCount(0)

  const rows = page.locator('[data-entry]')
  await expect(rows).toHaveCount(10)
  // Each save says so from the top of the screen, which is where the rows are.
  await expect(page.getByText('Added Held 9')).toHaveCount(0, { timeout: 10_000 })

  const touch = await context.newCDPSession(page)
  const grip = (await rows.first().locator('[data-food]').boundingBox())!
  const x = grip.x + 10
  const y = grip.y + grip.height / 2
  const home = Math.round((await rows.first().boundingBox())!.y)

  /** Where the drop line is, which is the only thing the finger moves. */
  const line = () => page.evaluate(() => {
    const el = document.querySelector('[data-entry] .bg-primary.h-0\\.5')
    return el ? Math.round(el.getBoundingClientRect().top) : null
  })
  const rowTop = async () => Math.round((await rows.first().boundingBox())!.y)

  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] })
  await expect(rows.first()).toHaveClass(/ring-primary/, { timeout: 2000 })

  // --- the row stays where it is, and the day stays where it is -----------
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + 90 }] })
  await page.waitForTimeout(80)
  expect(await rowTop()).toBe(home)
  expect(await page.evaluate(() => window.scrollY)).toBe(0)
  // The line is against a row the finger is on, wherever exactly that is.
  expect(Math.abs((await line())! - (y + 90))).toBeLessThan(45)

  // --- and if something else moves the day, the line still answers to the
  // --- finger rather than to where the day has got to ---------------------
  await page.evaluate(() => window.scrollBy(0, 120))
  await page.waitForTimeout(80)
  expect(await rowTop()).toBe(home - 120)
  expect(Math.abs((await line())! - (y + 90))).toBeLessThan(45)

  // --- held against the footer, the day comes to the row ------------------
  const low = await page.evaluate(() => window.innerHeight - 60)
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: low }] })
  await page.waitForTimeout(500)
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(120)

  // The bar it is held against is not a place to land: the drag goes on aiming
  // at what passes under the bar, so the row travels the length of the day and
  // arrives in the last meal of it.
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await expect.poll(async () => (await stored(page, date)).at(-1)).toBe('Snacks: Held 0')
})

test('the hidden move buttons do the same without a gesture', async ({ page }) => {
  const date = '2030-04-04'
  await startDay(page, date)

  await logFood(page, 'lunch', 'Keyboard soup')
  await logFood(page, 'lunch', 'Keyboard bread')

  const lunch = card(page, 'Lunch')
  await expect(lunch.locator('[data-entry]')).toHaveCount(2)

  // Up from the second row: past the first, and on out of the meal.
  await lunch.locator('[data-entry]').nth(1).locator('[data-move="up"]').focus()
  await page.keyboard.press('Enter')
  expect(await names(lunch)).toEqual(['Keyboard bread', 'Keyboard soup'])

  // The button keeps the focus, so the row can be walked on with the same key —
  // even across the meal boundary, where the row is drawn by a new component.
  await page.keyboard.press('Enter')
  expect(await names(card(page, 'Breakfast'))).toEqual(['Keyboard bread'])
  expect(await names(lunch)).toEqual(['Keyboard soup'])

  await expect.poll(() => stored(page, date)).toEqual([
    'Breakfast: Keyboard bread',
    'Lunch: Keyboard soup'
  ])
})
