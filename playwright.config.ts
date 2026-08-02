import { defineConfig } from '@playwright/test'

// Port 4287: unique to this lab so `reuseExistingServer` can never latch onto a
// sibling lab's preview when several are checked out side by side. Never 4173.
const PORT = 4287
const BASE = `http://localhost:${PORT}/crypto-lab-ghost-commit/`

export default defineConfig({
  testDir: './e2e',
  // shots.spec.ts only writes screenshots for eyeballing a change; it asserts
  // nothing and has no business in the deploy gate. Run it with `npm run shots`.
  testIgnore: process.env.SHOTS ? [] : ['**/shots.spec.ts'],
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: BASE,
    colorScheme: 'dark', // scan the real dark default; the toggle reaches light
  },
  webServer: {
    // Build first: `vite preview` only serves the existing dist/, so without
    // this a broken build leaves the last good bundle in place and the suite
    // passes green against source that no longer compiles.
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: BASE,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
