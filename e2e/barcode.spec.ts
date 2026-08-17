import { resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { writeBarcodeVideo } from './fixtures/barcodeVideo'
import { chooseMeal, modal, openLogModal, signIn, startDay } from './support'

/**
 * Scanning a barcode, through a camera Chromium is pretending to have.
 *
 * The fake device plays a file, so what the scanner opens is a real camera as
 * far as the page is concerned: frames arrive, the reader decodes them, and
 * what these tests assert is what came out the far end. Nothing about the
 * detector is stubbed — the point is that the reading itself works.
 */

/** The code on the packet. A real EAN-13, check digit and all. */
const CODE = '4750001010107'

// Written before the browser starts, because the flag below names the file.
const VIDEO = writeBarcodeVideo(CODE, resolve('node_modules/.cache/calorie-e2e/barcode.y4m'))

test.use({
  permissions: ['camera'],
  launchOptions: {
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${VIDEO}`
    ]
  }
})

/** Open the camera dialog and wait for it to read what it is pointed at. */
async function scan(page: Page) {
  await page.getByRole('button', { name: 'Scan a barcode' }).click()
  await expect(page.getByRole('dialog').filter({ hasText: 'Scan barcode' })).toBeVisible()
  // The reading dialog closes itself the moment a code comes off a frame.
  await expect(page.getByRole('dialog').filter({ hasText: 'Scan barcode' }))
    .toHaveCount(0, { timeout: 30_000 })
}

/** The barcode box on the food dialog. */
function barcodeField(page: Page) {
  return modal(page).locator('input[name="barcode"]')
}

/**
 * Open a food from the library screen.
 *
 * Clicked until it takes, like everywhere else in these tests: the
 * server-rendered list is clickable before Vue has hydrated, so an early tap
 * lands on nothing at all.
 */
async function openFromLibrary(page: Page, name: string) {
  await page.goto('/foods')
  const row = page.getByRole('button', { name, exact: false }).first()
  await expect(row).toBeVisible()

  await expect(async () => {
    await row.click({ timeout: 2000 })
    await expect(barcodeField(page)).toBeVisible({ timeout: 2000 })
  }).toPass({ timeout: 20_000 })
}

test.beforeEach(async ({ page }) => {
  await signIn(page)
})

/**
 * The reader that ships with the app, rather than the browser's own.
 *
 * Chromium here has a `BarcodeDetector` of its own and takes that path, which
 * is not the path the phone this app is used on takes: Safari has no such
 * thing, so iOS falls through to the WebAssembly reader in the bundle. Taking
 * the platform's away is how that half gets exercised — including the wasm
 * being served from this app rather than from a CDN.
 */
test('the bundled reader works where the browser has none of its own', async ({ page, context }) => {
  await context.addInitScript(() => {
    Reflect.deleteProperty(window, 'BarcodeDetector')
  })

  // Nothing may leave for a CDN: the reader is part of this deployment, and a
  // household on a bad connection — or a private server that reaches nothing —
  // still gets to scan.
  await context.route(/^https?:\/\/(?!localhost|127\.0\.0\.1)/, route => route.abort())

  const served: string[] = []
  page.on('requestfinished', (request) => {
    if (request.url().endsWith('.wasm')) served.push(request.url())
  })

  const food = `Wasm ${Date.now()}`
  await page.request.post('/api/foods', { data: { name: food, barcode: CODE, kcal: 100 } })

  await startDay(page, '2030-07-03')
  await openLogModal(page)
  // Nothing else is different: same camera, same dialog, same answer.
  await scan(page)

  // Generous: the code goes to the server when the copy on the device does not
  // know it, and on a cold dev server that route is compiled on the way past.
  await expect(modal(page).locator(`[data-food-name="${food}"]`))
    .toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

  // And it was this app that served the reader.
  expect(served.length).toBeGreaterThan(0)
  for (const url of served) expect(url).toContain('localhost')
})

test('a food takes the code off the packet, and keeps it', async ({ page }) => {
  const food = `Beans ${Date.now()}`
  await page.request.post('/api/foods', {
    data: { name: food, kcal: 79, protein: 4.7, fat: 0.4, carbs: 12.5 }
  })

  await openFromLibrary(page, food)
  await expect(barcodeField(page)).toHaveValue('')

  await scan(page)
  await expect(barcodeField(page)).toHaveValue(CODE)

  // Nothing is written until the dialog is saved, like every other field here.
  await modal(page).getByRole('button', { name: 'Save' }).click()
  await expect(modal(page)).toHaveCount(0)

  await openFromLibrary(page, food)
  await expect(barcodeField(page)).toHaveValue(CODE)
})

test('scanning a known packet picks the food it belongs to', async ({ page }) => {
  const food = `Scanned ${Date.now()}`
  await page.request.post('/api/foods', {
    data: { name: food, barcode: CODE, kcal: 200, protein: 10, fat: 5, carbs: 30 }
  })

  await startDay(page, '2030-07-01')
  await openLogModal(page)
  await chooseMeal(page, 'lunch')
  await scan(page)

  // The food is chosen, with only the weight left to type — which is the whole
  // point of holding a phone over a packet.
  // Generous: the code goes to the server when the copy on the device does not
  // know it, and on a cold dev server that route is compiled on the way past.
  await expect(modal(page).locator(`[data-food-name="${food}"]`))
    .toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })

  await modal(page).locator('input[inputmode="decimal"]').first().fill('150')
  await modal(page).getByRole('button', { name: 'Save & close' }).click()
  await expect(modal(page)).toHaveCount(0)

  await expect(page.locator('[data-entry]').filter({ hasText: food })).toHaveCount(1)
  // 150 g of a food at 200 kcal per 100 g.
  await expect(page.locator('.sticky.bottom-0')).toContainText('300')
})

test('a code nothing answers to goes onto the food logged next', async ({ page }) => {
  const food = `Fresh ${Date.now()}`

  await startDay(page, '2030-07-02')
  await openLogModal(page)
  await chooseMeal(page, 'dinner')
  await scan(page)

  // Said plainly, because what happens next is not obvious from the form.
  await expect(modal(page)).toContainText(CODE)
  await expect(modal(page)).toContainText('goes on the food you log next')

  await modal(page).locator('input[inputmode="decimal"]').first().fill('100')
  await modal(page).getByPlaceholder('Search or add a food').fill(food)
  await modal(page).getByRole('button', { name: 'Save & close' }).click()
  await expect(modal(page)).toHaveCount(0)

  // The food the library gained carries the code, so the next scan of that
  // packet finds it.
  await expect.poll(async () => {
    const found = await (await page.request.get(`/api/foods?barcode=${CODE}`)).json()
    return found.map((f: { name: string }) => f.name)
  }, { timeout: 10_000 }).toContain(food)
})

test('a code already on another food is pointed out rather than refused', async ({ page }) => {
  const stamp = Date.now()
  const first = `Original ${stamp}`
  const second = `Other ${stamp}`

  await page.request.post('/api/foods', { data: { name: first, barcode: CODE, kcal: 100 } })
  await page.request.post('/api/foods', { data: { name: second, kcal: 100 } })

  await openFromLibrary(page, second)
  await scan(page)

  await expect(modal(page)).toContainText(`${first} already carries this code`)
  // A warning, not a block: two packets really can share a code.
  await expect(modal(page).getByRole('button', { name: 'Save' })).toBeEnabled()
})

test.afterEach(async ({ page }) => {
  await clearScanned(page)
})

/** Take the code back off whatever this run put it on, so runs stay independent. */
async function clearScanned(page: Page) {
  const found = await (await page.request.get(`/api/foods?barcode=${CODE}`)).json()
  for (const food of found as Array<{ id: string }>) {
    await page.request.patch(`/api/foods/${food.id}`, { data: { barcode: null } })
  }
}
