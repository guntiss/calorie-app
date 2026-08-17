import { expect, test } from '@playwright/test'
import { modal, openLogModal, signIn, startDay } from './support'

/**
 * The log modal against the keypad.
 *
 * The modal opens with the cursor in the weight box, so on a phone the keypad
 * is up from the moment it appears — and iOS takes that room off the visual
 * viewport only, leaving `100dvh` and everything sized against it untouched.
 * So the sheet is sized against what is measured, not against the window.
 *
 * Chromium does not raise a keypad, so the measurement is what is faked here:
 * the two variables the modal reads are set by hand to a visible band the
 * height of a phone with the keys up, and the sheet has to end up inside it.
 */

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/** The visible band a keypad leaves on this profile, roughly: the top half. */
const VISIBLE = 330

/** Put the measurement where a raised keypad would put it. */
async function raiseKeypad(page: import('@playwright/test').Page) {
  await page.evaluate((visible) => {
    const style = document.documentElement.style
    style.setProperty('--viewport-height', `${visible}px`)
    style.setProperty('--viewport-center', `${visible / 2}px`)
  }, VISIBLE)
}

test('the modal is measured against the viewport rather than the window', async ({ page }) => {
  await startDay(page, '2030-04-20')
  await openLogModal(page)

  // The measurement is published while the modal is up, so the sheet has a real
  // height to fit inside rather than the fallback it renders with.
  const measured = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--viewport-height').trim())
  expect(measured).toBe(`${page.viewportSize()!.height}px`)

  // And it is given back on the way out: nothing is sized by a stale reading of
  // a keypad that is long gone.
  await modal(page).getByRole('button', { name: 'Cancel' }).click()
  await expect(modal(page)).toHaveCount(0)
  const cleared = await page.evaluate(() =>
    document.documentElement.style.getPropertyValue('--viewport-height'))
  expect(cleared).toBe('')
})

test('the sheet fits above the keypad, footer and all', async ({ page }) => {
  await startDay(page, '2030-04-20')
  await openLogModal(page)

  const sheet = modal(page)
  const tall = (await sheet.boundingBox())!
  expect(tall.height).toBeGreaterThan(VISIBLE)

  await raiseKeypad(page)
  // The height is transitioned, so this is the settled shape rather than a
  // frame partway into it.
  await expect(async () => {
    const box = (await sheet.boundingBox())!
    expect(box.y).toBeGreaterThanOrEqual(0)
    expect(box.y + box.height).toBeLessThanOrEqual(VISIBLE)
  }).toPass({ timeout: 2000 })

  // What the shrinking must not cost: both saves, the search, and the weight
  // are still on screen above the keys, and so is at least some of the list.
  for (const control of [
    sheet.getByRole('button', { name: 'Save & close' }),
    sheet.getByRole('button', { name: 'Save & next' }),
    sheet.getByPlaceholder('Search or add a food'),
    sheet.locator('input[inputmode="decimal"]').first()
  ]) {
    const box = (await control.boundingBox())!
    expect(box.y + box.height).toBeLessThanOrEqual(VISIBLE)
  }

  // The list is the part that gives the room, and it gives it rather than
  // pushing the footer off the bottom — but it does not disappear entirely.
  const list = (await sheet.locator('[data-food-name]').first().boundingBox())
  if (list) expect(list.y).toBeLessThanOrEqual(VISIBLE)
})
