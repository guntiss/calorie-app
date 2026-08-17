import { expect, test, type Locator, type Page } from '@playwright/test'
import { clickUntil, fillLogModal, logFood, modal, openLogModal, signIn, startDay } from './support'

/**
 * The path that has to work before anything else matters: sign in, define a
 * food, log an amount of it, and watch the day's remaining macros respond.
 */

const FOOD = `E2E Chicken ${Date.now()}`

/**
 * Give a row its macros where they now live — on the food behind it, reached
 * through the row's edit button. Values are kcal, protein, fat, carbs in order;
 * an empty string leaves that one alone.
 */
async function editFood(page: Page, row: Locator, macros: string[]) {
  await row.getByRole('button', { name: 'Edit food' }).click()

  const numbers = modal(page).locator('[data-macros] input')
  for (const [index, value] of macros.entries()) {
    if (value) await numbers.nth(index).fill(value)
  }

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(modal(page)).toHaveCount(0)
}

/**
 * Drag a row to the left, which is how a row is removed.
 *
 * `distance` is how far it travels before the button is released — short of the
 * row's threshold it springs back, and the row survives.
 */
async function swipeLeft(page: Page, row: Locator, distance = 160) {
  await swipe(page, row, -distance)
}

/** Drag a row to the right, which is how it is counted or left out. */
async function swipeRight(page: Page, row: Locator, distance = 160) {
  await swipe(page, row, distance)
}

async function swipe(page: Page, row: Locator, distance: number) {
  const box = await row.boundingBox()
  if (!box) throw new Error('the row is not on screen')

  // Started in the row's padding on the side it is dragged from, clear of its
  // controls.
  const x = distance < 0 ? box.x + box.width - 5 : box.x + 5
  const y = box.y + box.height / 2

  await page.mouse.move(x, y)
  await page.mouse.down()
  // In steps: the gesture only takes hold once the drag declares itself.
  for (const step of [0.25, 0.6, 1]) await page.mouse.move(x + distance * step, y)
  await page.mouse.up()
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('log a food into being, give it macros, and see the totals respond', async ({ page }) => {
  // --- define the food, which is done by logging it -----------------------
  // There is no other way in: the library is written by the days, so a name
  // typed into a row is how a food comes to exist at all.
  await startDay(page, '2030-03-03')
  await logFood(page, 'dinner', FOOD)

  const row = page.locator('[data-entry]').first()
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect(row.locator('[data-food]')).toHaveText(FOOD)
  await expect(row.getByRole('button', { name: 'Edit food' })).toBeEnabled()

  // The numbers belong to the food, and are given to it through the row.
  await editFood(page, row, ['120', '23', '2.6', '0'])

  // Logging a food defaults the row to 100 g. Quantity is the only number the
  // row itself carries — macros live on the food.
  const quantity = row.locator('input[inputmode="decimal"]').first()
  await expect(quantity).toHaveValue('100')

  const remainingBar = page.locator('.sticky.bottom-0')
  await expect(remainingBar).toContainText('120 / 2,000 kcal')

  // --- change the amount --------------------------------------------------
  // Edits are flushed on a debounce, so the reload check below waits for the
  // save that actually carries the new weight rather than for a fixed delay.
  const saved = page.waitForResponse(async (response) => {
    if (!response.url().includes('/api/log/') || response.request().method() !== 'PUT') return false
    const body = await response.json().catch(() => null)
    return Boolean(body?.entries?.some((e: { kcal: number | null }) => e.kcal === 240))
  })

  // The quantity takes a comma for its point too — the row is typed into on the
  // same keypad the macros are.
  await quantity.fill('')
  await quantity.pressSequentially('12,5')
  await expect(quantity).toHaveValue('12.5')
  await expect(remainingBar).toContainText('15 / 2,000 kcal')

  await quantity.fill('200')

  // 200 g at 120 kcal per 100 g: 240 kcal and 46 g of protein.
  await expect(remainingBar).toContainText('240 / 2,000 kcal')
  await expect(remainingBar).toContainText('46 / 150g')

  // --- and it survives a reload -------------------------------------------
  await saved
  await page.reload()
  await expect(page.locator('[data-entry]').first()
    .locator('input[inputmode="decimal"]')).toHaveValue('200')
  await expect(remainingBar).toContainText('240 / 2,000 kcal')

  // --- and the library kept it, with the one day that names it counted -----
  await page.goto('/foods')
  await expect(page.locator('ul > li').filter({ hasText: FOOD })).toContainText('1×')
})

test('an uncounted row stays on the list but leaves the total', async ({ page }) => {
  await startDay(page, '2030-03-04')

  // Logging something the library has never seen puts it in the library there
  // and then, so the row is backed by a food from the moment it exists — which
  // is what the edit button, disabled until there is a food to edit, reports.
  await logFood(page, 'breakfast', 'Ad-hoc pastry')

  const row = page.locator('[data-entry]').first()
  await expect(row.getByRole('button', { name: 'Edit food' })).toBeEnabled()
  await expect(row.locator('[data-food]')).toHaveText('Ad-hoc pastry')

  // The edit button writes to that new food — 400 kcal per 100 g, logged at 100 g.
  await expect(row.locator('input[inputmode="decimal"]')).toHaveValue('100')
  await editFood(page, row, ['400', '5'])

  const remainingBar = page.locator('.sticky.bottom-0')
  await expect(remainingBar).toContainText('400 / 2,000 kcal')

  // Swiping it aside the other way leaves it on the list but out of the total,
  // and the same swipe again puts it back.
  await swipeRight(page, row)
  await expect(row.getByTitle('Not counted')).toBeVisible()
  await expect(row.locator('[data-food]')).toHaveText('Ad-hoc pastry')
  await expect(remainingBar).toContainText('0 / 2,000 kcal')

  await swipeRight(page, row)
  await expect(row.getByTitle('Counted in the total')).toBeVisible()
  await expect(remainingBar).toContainText('400 / 2,000 kcal')

  // A drag that stops short of the threshold changes nothing.
  await swipeRight(page, row, 30)
  await expect(row.getByTitle('Counted in the total')).toBeVisible()
  await expect(remainingBar).toContainText('400 / 2,000 kcal')
})

test('the food on a logged row is fixed, and a swipe right stops it counting', async ({ page }) => {
  await startDay(page, '2030-03-09')
  await logFood(page, 'breakfast', 'Settled muesli')

  const row = page.locator('[data-entry]').first()
  await expect(page.locator('[data-entry]')).toHaveCount(1)

  // The row carries no search of its own: the food was settled in the modal
  // that logged it, and a row that names the wrong one is removed and logged
  // again rather than renamed in place.
  await expect(row.getByPlaceholder('Search or add a food')).toHaveCount(0)
  await expect(row.locator('[data-food]')).toHaveText('Settled muesli')

  // Dragging it the other way is what the row is for instead: it stays put,
  // and stops counting.
  await swipeRight(page, row)
  await expect(row.getByTitle('Not counted')).toBeVisible()
  await expect(page.locator('[data-entry]')).toHaveCount(1)
})

test('removing a row can be undone, and otherwise sticks', async ({ page }) => {
  await startDay(page, '2030-03-06')
  await logFood(page, 'lunch', 'Regrettable snack')

  const row = page.locator('[data-entry]').first()
  await editFood(page, row, ['250'])

  const remainingBar = page.locator('.sticky.bottom-0')
  await expect(remainingBar).toContainText('250 / 2,000 kcal')

  // A drag that stops short of the threshold leaves the row where it was.
  await swipeLeft(page, row, 30)
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect(remainingBar).toContainText('250 / 2,000 kcal')

  // --- remove, then take it back -----------------------------------------
  await swipeLeft(page, row)
  await expect(page.locator('[data-entry]')).toHaveCount(0)
  await expect(remainingBar).toContainText('0 / 2,000 kcal')

  // Saving is debounced, so the reload below waits for the write that actually
  // carries the restored row rather than for a fixed delay.
  const restored = page.waitForResponse(async (response) => {
    if (!response.url().includes('/api/log/') || response.request().method() !== 'PUT') return false
    const body = await response.json().catch(() => null)
    return Boolean(body?.entries?.some((e: { id: string }) => e.id))
  })

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('[data-entry]')).toHaveCount(1)
  await expect(page.locator('[data-food]')).toHaveText('Regrettable snack')
  await expect(remainingBar).toContainText('250 / 2,000 kcal')

  // The restored row is saved, not just redrawn.
  await restored
  await page.reload()
  await expect(page.locator('[data-entry]')).toHaveCount(1)

  // --- remove for good ----------------------------------------------------
  const deleted = page.waitForResponse(response =>
    response.url().includes('/api/log/') && response.request().method() === 'PUT'
  )
  await swipeLeft(page, page.locator('[data-entry]').first())
  await expect(page.locator('[data-entry]')).toHaveCount(0)

  await deleted
  await page.reload()
  await expect(page.locator('[data-entry]')).toHaveCount(0)
})

/**
 * The library's whole lifecycle, from the other end.
 *
 * A food is in My foods because some day names it, so the tally on its row is
 * not decoration — it is the number of things holding the food in existence,
 * and the last of them to go takes the food with it. There is nothing to press
 * to remove one, which is the point: the days are the record, and the library
 * only ever agrees with them.
 */
test('a food is counted by its logged rows, and goes when the last one does', async ({ page }) => {
  const name = `E2E Fleeting ${Date.now()}`
  const date = '2030-03-12'

  await startDay(page, date)
  await logFood(page, 'breakfast', name)
  await expect(page.locator('[data-entry]')).toHaveCount(1)

  // Wait for the row to be stored: its id is what gets deleted below.
  let entries: Array<{ id: string, foodId: string }> = []
  await expect.poll(async () => {
    const day = await (await page.request.get(`/api/log/${date}`)).json()
    entries = day.entries
    return entries.length
  }, { timeout: 20_000 }).toBe(1)

  // A second day names the same food, so the tally has something to count down.
  const second = crypto.randomUUID()
  await page.request.put('/api/log/2030-03-13', {
    data: {
      upserts: [{ id: second, foodId: entries[0]!.foodId, position: 0, quantity: 100, counted: true }],
      deletes: []
    }
  })

  await page.goto('/foods')
  const libraryRow = page.locator('ul > li').filter({ hasText: name })
  await expect(libraryRow).toContainText('2×')

  // Nothing on the page adds or removes a food any more.
  await expect(page.getByRole('button', { name: 'New' })).toHaveCount(0)
  await expect(libraryRow.getByRole('button', { name: 'Delete' })).toHaveCount(0)
  await expect(libraryRow).not.toContainText('logged')

  // One day lets go, and the food stays: the other still names it.
  await page.request.put('/api/log/2030-03-13', { data: { upserts: [], deletes: [second] } })
  await page.reload()
  await expect(page.locator('ul > li').filter({ hasText: name })).toContainText('1×')

  // The last one lets go, and there is nothing left for the food to be.
  await page.request.put(`/api/log/${date}`, {
    data: { upserts: [], deletes: [entries[0]!.id] }
  })
  await page.reload()
  await expect(page.locator('ul > li').filter({ hasText: name })).toHaveCount(0)

  const remaining = await (await page.request.get(`/api/foods?q=${encodeURIComponent(name)}`)).json()
  expect(remaining).toHaveLength(0)
})

test('a kcal that disagrees with the macros is queried, not corrected', async ({ page }) => {
  await openLibraryFood(page, `E2E Mismatch ${Date.now()}`)

  // Nothing is claimed about an empty form, so nothing is said about it either.
  const implied = page.getByText('These macros come to')
  await expect(implied).toHaveCount(0)

  const numbers = page.locator('[role=dialog] [data-macros] input')
  await numbers.nth(0).fill('125')   // kcal
  await numbers.nth(1).fill('10')    // protein → 40
  await numbers.nth(2).fill('5')     // fat     → 45
  await numbers.nth(3).fill('10')    // carbs   → 40

  // Adding up is just a note while the two sides agree.
  await expect(implied).toContainText('125')
  await expect(page.getByRole('button', { name: /^Use / })).toHaveCount(0)

  // A kcal the macros cannot account for is called out, and a fix offered.
  await numbers.nth(0).fill('500')
  await expect(implied).toContainText('125')
  await expect(numbers.nth(0)).toHaveValue('500')

  // Offered, never applied behind the user's back.
  await page.getByRole('button', { name: 'Use 125' }).click()
  await expect(numbers.nth(0)).toHaveValue('125')
  await expect(page.getByRole('button', { name: /^Use / })).toHaveCount(0)

  // And a mismatch never stands between the user and their own numbers.
  await numbers.nth(0).fill('500')
  await expect(page.getByRole('button', { name: 'Use 125' })).toBeVisible()
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('[role=dialog]')).toHaveCount(0)
})

/**
 * A phone set to a European region draws its decimal keypad with a comma, and a
 * `type="number"` field discards the very character its own keyboard offers —
 * on those phones there was no way to type 2.6 at all. Both separators are
 * taken, and both mean a decimal point.
 */
test('a comma typed into a macro means a decimal point', async ({ page }) => {
  const name = `E2E Comma ${Date.now()}`
  await openLibraryFood(page, name)

  const numbers = page.locator('[role=dialog] [data-macros] input')
  await numbers.nth(2).pressSequentially('2,6')
  await expect(numbers.nth(2)).toHaveValue('2.6')

  // kcal asks for the whole-number keypad, which has no separator on it at all,
  // but a comma from a hardware keyboard still means what it says rather than
  // multiplying the number by ten.
  await numbers.nth(0).pressSequentially('12,5')
  await expect(numbers.nth(0)).toHaveValue('12.5')

  // It is the number that gets read, not the text: 2.6 g of fat is 23 kcal.
  await numbers.nth(1).fill('0')
  await numbers.nth(3).fill('0')
  await expect(page.getByText('These macros come to')).toContainText('23')

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.locator('[role=dialog]')).toHaveCount(0)

  // And the decimal survives the round trip.
  await page.getByRole('button', { name: new RegExp(`^${name}\\b`) }).click()
  await expect(page.locator('[role=dialog] [data-macros] input').nth(2)).toHaveValue('2.6')
})

/** Put a food in the library the short way, for tests that are not about that. */
async function createFood(page: Page, name: string, macros = { kcal: 100, protein: 5, fat: 2, carbs: 10 }) {
  const response = await page.request.post('/api/foods', { data: { name, ...macros } })
  return await response.json() as { id: string, name: string }
}

/**
 * Open the edit dialog on a food of this test's own, from My foods.
 *
 * Its macros start at zero — the state a food quick added while logging is in —
 * so the form opens blank, which is what the tests below are about.
 */
async function openLibraryFood(page: Page, name: string) {
  await createFood(page, name, { kcal: 0, protein: 0, fat: 0, carbs: 0 })
  await page.goto('/foods')
  await clickUntil(page, new RegExp(`^${name}\\b`), async () => {
    await expect(page.getByPlaceholder('Chicken breast')).toBeVisible({ timeout: 2000 })
  })
}

/**
 * Two saves in flight at once used to be settled by whichever response landed
 * last, and the older one carries exactly the values the newer was sent to
 * replace — so a slow save would put an old weight back on a row that had
 * already moved on. Editing several weights in a row is the ordinary way to hit
 * that, which is why it showed up as rows flicking back and forth.
 */
test('a slow save does not put back a weight typed while it was in flight', async ({ page }) => {
  await startDay(page, '2030-03-11')

  // Two logged rows, so one can be edited while the other's save is in the air.
  // Both are logged without leaving the modal, which is what it is for.
  await openLogModal(page)
  await fillLogModal(page, 'Race oats', { another: true })
  await fillLogModal(page, 'Race milk')
  await expect(modal(page)).toHaveCount(0)

  const rows = page.locator('[data-entry]')
  await expect(rows).toHaveCount(2)

  const first = rows.nth(0).locator('input[inputmode="decimal"]')
  const second = rows.nth(1).locator('input[inputmode="decimal"]')
  await expect(first).toHaveValue('100')
  await expect(second).toHaveValue('100')

  // Let the saves for those two rows finish before the next one is held open.
  await page.waitForLoadState('networkidle')

  let saves = 0
  await page.route('**/api/log/**', async (route) => {
    if (route.request().method() !== 'PUT') return route.continue()
    // Only the first: the second has to be able to overtake it on the wire.
    if (saves++ === 0) await new Promise(resolve => setTimeout(resolve, 2500))
    await route.continue()
  })

  let settled = 0
  page.on('response', (r) => {
    if (r.url().includes('/api/log/') && r.request().method() === 'PUT') settled++
  })

  // Edits are flushed 600ms after the last keystroke, so the wait between the
  // two is what puts the second one inside the first one's request.
  await first.fill('150')
  await page.waitForTimeout(1200)
  await second.fill('250')

  // Watched from here rather than checked at the end: the wrong value is put
  // back for only as long as it takes the next save to correct it, so what has
  // to be asserted is that the rows never showed anything but what was typed.
  const shown = { first: new Set<string>(), second: new Set<string>() }
  let watching = true
  const watcher = (async () => {
    while (watching) {
      shown.first.add(await first.inputValue())
      shown.second.add(await second.inputValue())
    }
  })()

  // Both responses are back, and neither row ever moved.
  await expect.poll(() => settled, { timeout: 20_000 }).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(500)
  watching = false
  await watcher

  expect([...shown.first]).toEqual(['150'])
  expect([...shown.second]).toEqual(['250'])

  // And what is on screen is what was stored.
  await page.unroute('**/api/log/**')
  await page.reload()
  await expect(page.locator('[data-entry]').nth(0).locator('input[inputmode="decimal"]')).toHaveValue('150')
  await expect(page.locator('[data-entry]').nth(1).locator('input[inputmode="decimal"]')).toHaveValue('250')
})
