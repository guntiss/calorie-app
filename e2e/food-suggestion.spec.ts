import { expect, test, type Page } from '@playwright/test'
import { logFood, modal, signIn, startDay } from './support'

/**
 * Suggested macros for a food with none.
 *
 * A food logged by name joins the library with nothing on it, and the dialog
 * that opens on it offers typical numbers for a food of that name rather than
 * leaving a blank form. The suggestion is answered here rather than fetched:
 * what is being tested is the dialog, not what a model happens to say today.
 */

interface Suggested {
  kcal: number
  protein: number
  fat: number
  carbs: number
  note: string
}

const BEANS: Suggested = { kcal: 79, protein: 4.7, fat: 0.4, carbs: 12.5, note: 'canned in tomato sauce' }

/**
 * Answer the lookup with fixed numbers, and count how often it was asked —
 * a suggestion offered where it should not be is as much a bug as one missing.
 */
async function stubSuggestions(page: Page, answer: Suggested | null) {
  const asked: string[] = []

  await page.route('**/api/foods/suggest', async (route) => {
    asked.push(route.request().postDataJSON()?.name ?? '')
    await route.fulfill({
      json: answer ? { known: true, ...answer } : { known: false }
    })
  })

  return asked
}

/** The row's edit button, which is where a food's numbers are corrected. */
async function openFood(page: Page, name: string) {
  await page.locator('[data-entry]').filter({ hasText: name }).first()
    .getByRole('button', { name: 'Edit food' }).click()
  await expect(modal(page)).toBeVisible()
}

/** The four macro boxes. Named by the row they sit in: the dialog has other
 *  number fields above them, and counting from the top would find those. */
function macroFields(page: Page) {
  return modal(page).locator('[data-macros] input')
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

test('a food with no calories is offered typical ones, and Use fills them in', async ({ page }) => {
  const food = `Beans ${Date.now()}`
  const asked = await stubSuggestions(page, BEANS)

  await startDay(page, '2030-06-01')
  await logFood(page, 'dinner', food, { grams: '200' })
  await openFood(page, food)

  // The name it was asked about is the food's own, brand and all.
  await expect.poll(() => asked).toEqual([food])

  const suggestion = modal(page).getByText(`${BEANS.kcal} kcal`)
  await expect(suggestion).toBeVisible()
  await expect(modal(page)).toContainText(BEANS.note)

  // Nothing is in the fields until it is accepted: the numbers are typical for
  // the name, not a reading off the packet in front of the user.
  await expect(macroFields(page).first()).toHaveValue('')

  await modal(page).getByRole('button', { name: 'Use', exact: true }).click()

  // All four together — the calories alone would leave the food stating a
  // mismatch it was handed.
  await expect(macroFields(page).nth(0)).toHaveValue(String(BEANS.kcal))
  await expect(macroFields(page).nth(1)).toHaveValue(String(BEANS.protein))
  await expect(macroFields(page).nth(2)).toHaveValue(String(BEANS.fat))
  await expect(macroFields(page).nth(3)).toHaveValue(String(BEANS.carbs))

  // Having been used, it is gone: the numbers are the user's now.
  await expect(suggestion).toHaveCount(0)

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(modal(page)).toHaveCount(0)

  // 200 g of a food at 79 kcal per 100 g, priced through the row.
  await expect(page.locator('.sticky.bottom-0')).toContainText('158 / 2,000 kcal')
})

test('a food that already has calories is left alone', async ({ page }) => {
  const food = `Priced ${Date.now()}`
  const asked = await stubSuggestions(page, BEANS)

  await page.request.post('/api/foods', {
    data: { name: food, kcal: 250, protein: 10, fat: 5, carbs: 40 }
  })

  await startDay(page, '2030-06-02')
  await logFood(page, 'lunch', food, { grams: '100', pick: true })
  await openFood(page, food)

  await expect(macroFields(page).first()).toHaveValue('250')
  // Not asked about at all: someone has already answered for this food.
  await expect(modal(page).getByRole('button', { name: 'Use', exact: true })).toHaveCount(0)
  expect(asked).toEqual([])
})

test('a food the lookup cannot place says nothing at all', async ({ page }) => {
  const food = `Zzqx ${Date.now()}`
  await stubSuggestions(page, null)

  await startDay(page, '2030-06-03')
  await logFood(page, 'breakfast', food, { grams: '100' })
  await openFood(page, food)

  // The lookup has been and gone; the dialog is the plain form it always was.
  await expect(modal(page).getByText('Looking up typical values')).toHaveCount(0)
  await expect(modal(page).getByRole('button', { name: 'Use', exact: true })).toHaveCount(0)
  await expect(macroFields(page).first()).toHaveValue('')
})
