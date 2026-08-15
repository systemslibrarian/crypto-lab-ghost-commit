/**
 * Screenshot helper — not part of the gate. Run with:
 *   npx playwright test e2e/shots.spec.ts
 * Writes full-page captures of the end state in both themes to test-results/.
 */
import { expect, test, type Page } from '@playwright/test'

async function drive(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true')
  for (let i = 0; i < 10; i++) {
    const advance = page.locator('#advance-repo')
    if ((await advance.count()) === 0) break
    await advance.click()
  }
  await page.click('#scan-head')
  await page.click('#walk-history')
  await expect(page.locator('.reveal')).toBeVisible()
}

for (const theme of ['dark'] as const) {
  test(`shots — ${theme}`, async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('.')
    await page.screenshot({ path: `test-results/shot-${theme}-top.png` })
    await drive(page)
    await page.screenshot({ path: `test-results/shot-${theme}-full.png`, fullPage: true })
    for (const panel of ['repo', 'scan', 'entropy', 'fix']) {
      await page
        .locator(`#panel-${panel}`)
        .screenshot({ path: `test-results/panel-${panel}-${theme}.png` })
    }
  })
}

test('shots — mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('.')
  await drive(page)
  await page.screenshot({ path: 'test-results/shot-mobile-full.png', fullPage: true })
})
