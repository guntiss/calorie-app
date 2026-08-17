import { defineConfig, devices } from '@playwright/test'

const PORT = 3111
const baseURL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  reporter: 'list',
  use: {
    baseURL,
    // The app is built mobile-first, so that is what the E2E path exercises —
    // the iPhone profile for viewport and touch, but driven by Chromium.
    ...devices['iPhone 13'],
    defaultBrowserType: 'chromium'
  },
  webServer: {
    command: `npx nuxt dev --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000
  }
})
