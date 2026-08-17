import { expect, test, type Page } from '@playwright/test'

/**
 * Installed to the home screen there is no reload button, so the pull gesture
 * is the only way to refetch a day. Driven over CDP: Playwright's touchscreen
 * can tap but not drag.
 */
async function pullDown(page: Page, distance: number) {
  const session = await page.context().newCDPSession(page)
  const x = 180
  const startY = 220

  await session.send('Input.dispatchTouchEvent', {
    type: 'touchStart',
    touchPoints: [{ x, y: startY }]
  })
  // In steps: the gesture only commits once it has declared itself vertical.
  for (let travelled = 10; travelled <= distance; travelled += 20) {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x, y: startY + travelled }]
    })
  }
  await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await session.detach()
}

// The gesture is switched off in the app for now, so these describe behaviour
// nothing currently exposes. Kept rather than deleted: they are what has to pass
// again when it comes back.
test.describe.skip('pull to refresh', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/auth/dev')
    await page.waitForLoadState('networkidle')
  })

  test('pulling down at the top of a day refetches it', async ({ page }) => {
    await page.goto('/log/2030-03-06')
    await expect(page.getByRole('button', { name: 'Hide breakfast' })).toBeVisible()

    const refetched = page.waitForResponse(
      r => r.url().includes('/api/log/2030-03-06') && r.request().method() === 'GET',
      { timeout: 10_000 }
    )

    await pullDown(page, 200)
    await refetched

    // The day stays on screen throughout: a reload of what is already there must
    // not blank the grid out.
    await expect(page.getByRole('button', { name: 'Hide breakfast' })).toBeVisible()
  })

  test('a short pull is not a refresh', async ({ page }) => {
    await page.goto('/log/2030-03-06')
    await expect(page.getByRole('button', { name: 'Hide breakfast' })).toBeVisible()

    let refetches = 0
    page.on('response', (r) => {
      if (r.url().includes('/api/log/2030-03-06') && r.request().method() === 'GET') refetches++
    })

    await pullDown(page, 40)
    await page.waitForTimeout(1500)
    expect(refetches).toBe(0)
  })
})
