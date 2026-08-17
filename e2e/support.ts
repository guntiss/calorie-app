import { expect, type Page } from '@playwright/test'

/**
 * The moves every end-to-end test starts from.
 *
 * Logging is the one path all of them go through — a day, a meal, an amount of
 * a food — so it lives here rather than being retyped in each spec.
 */

export async function signIn(page: Page) {
  await page.goto('/auth/dev')
  await page.waitForLoadState('networkidle')
}

/**
 * Each test owns its day outright: a known goal, and no rows left over from a
 * previous run. Otherwise the totals asserted depend on history.
 */
export async function startDay(page: Page, date: string) {
  await page.request.put('/api/goals', {
    data: {
      effectiveFrom: '2030-01-01',
      kcal: 2000,
      protein: 150,
      fat: 67,
      carbs: 200,
      inputMode: 'grams'
    }
  })

  await clearDay(page, date)
  await page.goto(`/log/${date}`)
}

/** Empty a day through the API, without going anywhere near the grid. */
export async function clearDay(page: Page, date: string) {
  const day = await (await page.request.get(`/api/log/${date}`)).json()
  if (!day.entries.length) return

  await page.request.put(`/api/log/${date}`, {
    data: { upserts: [], deletes: day.entries.map((e: { id: string }) => e.id) }
  })
}

/**
 * Clicks retry until the page reacts.
 *
 * The server-rendered markup is clickable before Vue has hydrated, so a single
 * early click can land on nothing at all.
 */
export async function clickUntil(page: Page, name: string | RegExp, expected: () => Promise<void>) {
  await expect(async () => {
    await page.getByRole('button', { name }).first().click({ timeout: 2000 })
    await expected()
  }).toPass({ timeout: 20_000 })
}

export function modal(page: Page) {
  return page.getByRole('dialog')
}

/** Open the log modal from the plus button in the day's footer. */
export async function openLogModal(page: Page) {
  await clickUntil(page, 'Log food', async () => {
    await expect(modal(page).getByPlaceholder('Search or add a food'))
      .toBeVisible({ timeout: 2000 })
  })
}

/**
 * Pick the meal on the open modal.
 *
 * The modal opens on whatever was logged into last, which is remembered across
 * tests in the same browser, so a test that cares which meal it lands in has to
 * say so rather than trust the default.
 */
export async function chooseMeal(page: Page, meal: string) {
  // Clicked where a finger would land — on the segment — rather than on the
  // radio itself, which the row keeps for screen readers and the keyboard and
  // hides from view.
  await modal(page).locator('fieldset').getByText(meal, { exact: false }).first().click()
  await expect(modal(page).getByRole('radio', { name: meal })).toBeChecked()
}

interface LogOptions {
  /**
   * What the row weighs. Filled in either way — the modal opens with the
   * weight empty — so this is only the tests that care which number it is.
   */
  grams?: string
  /** Take the food off the list rather than typing its name. */
  pick?: boolean
  /** Save without closing, so the next food can be logged straight after. */
  another?: boolean
}

/** Fill in an already-open modal and save it. */
export async function fillLogModal(page: Page, food: string, options: LogOptions = {}) {
  const dialog = modal(page)

  await dialog.locator('input[inputmode="decimal"]').first().fill(options.grams ?? '100')

  // Typed either way — a library of any size is narrowed before it is tapped.
  // The difference is what happens next: `pick` takes the food off the list,
  // where anything else leaves the typed name for the save to turn into one.
  await dialog.getByPlaceholder('Search or add a food').fill(food)
  if (options.pick) await dialog.locator(`[data-food-name="${food}"]`).click()

  await dialog.getByRole('button', { name: options.another ? 'Save & next' : 'Save & close' })
    .click()
}

/**
 * Log an amount of a food into a meal, which is the only way a row comes to be.
 *
 * A food the library has never heard of is typed and gains an entry there; one
 * it already has is taken off the list with `pick`.
 */
export async function logFood(page: Page, meal: string, food: string, options: LogOptions = {}) {
  await openLogModal(page)
  await chooseMeal(page, meal)
  await fillLogModal(page, food, options)
  if (!options.another) await expect(modal(page)).toHaveCount(0)
}
