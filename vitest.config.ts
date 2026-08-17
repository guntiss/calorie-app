import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Unit tests only — `e2e/` is Playwright's, and it needs a real browser.
    include: ['shared/**/*.test.ts', 'server/**/*.test.ts', 'app/**/*.test.ts'],
    exclude: ['node_modules/**', '.nuxt/**', '.output/**', 'e2e/**']
  }
})
