import { defineConfig } from 'vitest/config'

export default defineConfig({
  base: '/crypto-lab-ghost-commit/',
  build: { target: 'es2022' },
  test: {
    // e2e/ holds Playwright specs — keep them out of the Vitest run.
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: true,
  },
})
