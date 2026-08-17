import { expect, test, type Page } from '@playwright/test'
import { fillLogModal, logFood, modal, openLogModal, signIn, startDay } from './support'

/**
 * Logging a food.
 *
 * A row is an amount of a food, and both halves are settled in one place before
 * anything lands on the day: the weight first, because that is the part only
 * this row knows, then the food — off a list that runs to the bottom of the
 * modal, so the usual thing is a tap rather than a search.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** How this run's foods are told apart. Letters, because the tag is a number
 * and the search takes each word of a query on its own — a food numbered "2"
 * is also a food whose tag has a 2 in it. */
const SUFFIXES = ['one', 'two', 'three', 'four', 'five']

/** A library of foods that only this run will match, so the list is known. */
async function stockLibrary(page: Page, tag: string, count: number) {
  for (let i = 0; i < count; i++) {
    await page.request.post('/api/foods', {
      data: { name: `${tag} ${SUFFIXES[i]}`, kcal: 100 + i, protein: 1, fat: 1, carbs: 1 }
    })
  }
}

test('the library is on the list before anything is typed, and a tap picks from it', async ({ page }) => {
  const tag = `Listed${Date.now()}`

  await stockLibrary(page, tag, 3)
  await startDay(page, '2030-04-01')
  await openLogModal(page)

  // Nothing typed, and the library is already on the list: that is the point of
  // it — the usual food is a tap rather than a search.
  await expect(modal(page).locator('[data-food-name]').first()).toBeVisible()

  // Narrowed to this run's foods, all three of them are there.
  await modal(page).getByPlaceholder('Search or add a food').fill(tag)
  for (const suffix of SUFFIXES.slice(0, 3)) {
    await expect(modal(page).locator(`[data-food-name="${tag} ${suffix}"]`)).toBeVisible()
  }

  // Weight first, then the food off the list — and the row carries both.
  await fillLogModal(page, `${tag} two`, { grams: '250', pick: true })
  await expect(modal(page)).toHaveCount(0)

  const row = page.locator('[data-entry]').first()
  await expect(row.locator('[data-food]')).toHaveText(`${tag} two`)
  await expect(row.locator('input[inputmode="decimal"]')).toHaveValue('250')

  // 250 g of a food at 101 kcal per 100 g.
  await expect(page.locator('.sticky.bottom-0')).toContainText('253 / 2,000 kcal')
})

test('accents are something the library has, not something you have to type', async ({ page }) => {
  // Nothing of the query in the tag itself, so what is marked in the row is
  // only ever the part of the name the query actually reached.
  const tag = `Accented${Date.now()}`

  await page.request.post('/api/foods', {
    data: { name: `${tag} Tumšā šokolāde`, kcal: 550, protein: 7, fat: 35, carbs: 45 }
  })
  await startDay(page, '2030-04-06')
  await openLogModal(page)

  const search = modal(page).getByPlaceholder('Search or add a food')
  const row = modal(page).locator(`[data-food-name="${tag} Tumšā šokolāde"]`)

  // Typed flat, the way it comes out of a phone keypad with a scale in the
  // other hand — and the accented name answers to it.
  await search.fill('tumsa sokolade')
  await expect(row).toBeVisible()

  // And the row says which letters answered, so it is clear why it is on the
  // list at all.
  await expect(row.locator('mark')).toHaveText(['Tumšā', 'šokolāde'])

  // Typed with the accents, it is the same food.
  await search.fill('šokolāde')
  await expect(row).toBeVisible()

  // A word the food does not have takes it off the list, however the rest of
  // the query matches.
  await search.fill('sokolade piens')
  await expect(row).toHaveCount(0)
})

test('the library is on the list on the first frame, without asking for it again', async ({ page }) => {
  const tag = `Cached${Date.now()}`

  await stockLibrary(page, tag, 2)
  await startDay(page, '2030-04-07')

  // Once through the modal, so the library is on the device.
  await openLogModal(page)
  await expect(modal(page).locator(`[data-food-name="${tag} one"]`)).toBeVisible()
  await modal(page).getByRole('button', { name: 'Cancel' }).click()

  // Now hold the library request open. The list is a copy on the device, so it
  // is there regardless of what the network is doing — and typing still
  // narrows it, because the search happens here too.
  await page.route('**/api/foods?*', () => { /* never answered */ })
  await page.reload()

  await openLogModal(page)
  await expect(modal(page).locator(`[data-food-name="${tag} two"]`)).toBeVisible()

  await modal(page).getByPlaceholder('Search or add a food').fill(`${tag} two`)
  await expect(modal(page).locator(`[data-food-name="${tag} one"]`)).toHaveCount(0)
  await expect(modal(page).locator(`[data-food-name="${tag} two"]`)).toBeVisible()
})

test('typing narrows the list, and what is not on it can be added from the box', async ({ page }) => {
  const tag = `Narrow${Date.now()}`

  await stockLibrary(page, tag, 3)
  await startDay(page, '2030-04-02')
  await openLogModal(page)

  await modal(page).getByPlaceholder('Search or add a food').fill(`${tag} three`)
  await expect(modal(page).locator(`[data-food-name="${tag} three"]`)).toBeVisible()
  await expect(modal(page).locator(`[data-food-name="${tag} one"]`)).toHaveCount(0)

  // A name the library does not have is offered as a food to add, and saving
  // takes it — there is no separate step for putting it in the library.
  const invented = `${tag} invented`
  await modal(page).getByPlaceholder('Search or add a food').fill(invented)
  await expect(modal(page).getByText('as a new food')).toBeVisible()

  // Not saveable yet: a food with no weight against it is a blank in the day.
  await expect(modal(page).getByRole('button', { name: 'Save & close' })).toBeDisabled()
  await expect(modal(page).getByRole('button', { name: 'Save & next' })).toBeDisabled()

  await modal(page).locator('input[inputmode="decimal"]').first().fill('150')
  await modal(page).getByRole('button', { name: 'Save & close' }).click()
  await expect(modal(page)).toHaveCount(0)

  await expect(page.locator('[data-entry]').first().locator('[data-food]')).toHaveText(invented)

  const library = await (await page.request.get(`/api/foods?q=${encodeURIComponent(invented)}`)).json()
  expect(library).toHaveLength(1)
})

test('save and add another logs a meal of several foods without leaving the modal', async ({ page }) => {
  const tag = `Several${Date.now()}`

  await startDay(page, '2030-04-03')
  await openLogModal(page)

  await fillLogModal(page, `${tag} oats`, { grams: '80', another: true })

  // The modal stays put, ready for the next food: the amount is empty again
  // rather than carrying the last one, the search is empty, and what was just
  // logged is said once.
  // The confirmation is a toast, so it lives outside the dialog — and it is
  // checked first, because it is the one thing here that expires on its own.
  const confirmation = page.getByText(`Added ${tag} oats`).first()
  await expect(confirmation).toBeVisible()

  // Up at the top, where the keypad this modal opens with is not covering it.
  await expect.poll(async () => {
    const box = await confirmation.boundingBox()
    return (box?.y ?? Infinity) < (page.viewportSize()?.height ?? 0) / 2
  }).toBe(true)
  await expect(modal(page)).toBeVisible()
  await expect(modal(page).getByPlaceholder('Search or add a food')).toHaveValue('')
  await expect(modal(page).locator('input[inputmode="decimal"]').first()).toHaveValue('')
  await expect(page.locator('[data-entry]')).toHaveCount(1)

  // And the food it just created is there to be picked for the next one.
  await modal(page).getByPlaceholder('Search or add a food').fill(`${tag} oats`)
  await expect(modal(page).locator(`[data-food-name="${tag} oats"]`)).toBeVisible()
  await modal(page).getByPlaceholder('Search or add a food').fill('')

  await fillLogModal(page, `${tag} banana`, { grams: '120' })
  await expect(modal(page)).toHaveCount(0)

  const rows = page.locator('[data-entry]')
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).locator('[data-food]')).toHaveText(`${tag} oats`)
  await expect(rows.nth(0).locator('input[inputmode="decimal"]')).toHaveValue('80')
  await expect(rows.nth(1).locator('[data-food]')).toHaveText(`${tag} banana`)
  await expect(rows.nth(1).locator('input[inputmode="decimal"]')).toHaveValue('120')
})

test('cancelling leaves the day exactly as it was', async ({ page }) => {
  const name = `Abandoned ${Date.now()}`

  await startDay(page, '2030-04-04')
  await openLogModal(page)

  await modal(page).locator('input[inputmode="decimal"]').first().fill('300')
  await modal(page).getByPlaceholder('Search or add a food').fill(name)
  await modal(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(modal(page)).toHaveCount(0)

  // No row, and no food either: the library is written by logging, and nothing
  // was logged.
  await expect(page.locator('[data-entry]')).toHaveCount(0)
  const library = await (await page.request.get(`/api/foods?q=${encodeURIComponent(name)}`)).json()
  expect(library).toHaveLength(0)

  // The next open starts clean rather than showing what was left in it.
  await openLogModal(page)
  await expect(modal(page).getByPlaceholder('Search or add a food')).toHaveValue('')
  await expect(modal(page).locator('input[inputmode="decimal"]').first()).toHaveValue('')
})

test('a food already in the library is logged again rather than duplicated', async ({ page }) => {
  const name = `Reused ${Date.now()}`

  await startDay(page, '2030-04-05')
  await logFood(page, 'breakfast', name)
  await logFood(page, 'dinner', name, { pick: true })

  await expect(page.locator('[data-entry]')).toHaveCount(2)

  // One food, named by both rows — and the tally is what says so. Polled
  // because the rows are saved on a debounce, so the count catches up a moment
  // after the grid shows them.
  await expect.poll(async () => {
    const library = await (await page.request.get(`/api/foods?q=${encodeURIComponent(name)}`)).json()
    return library.length === 1 ? library[0].logCount : library.length
  }, { timeout: 20_000 }).toBe(2)
})
