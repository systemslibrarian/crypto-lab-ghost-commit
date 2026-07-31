import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']

/**
 * Axe only checks what is in the DOM, so an unscanned state is an ungated state.
 * This drives the demo to its *end* state — every commit made, both scans run, the
 * finding cards rendered, the reveal shown, the key rotated, every sample loaded,
 * every disclosure open — before a single assertion runs. The dynamic result
 * regions are exactly where contrast and live-region violations hide.
 */
async function driveDemo(page: Page): Promise<void> {
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true')

  // Exercise the SHA-256 object format, then return to the default.
  await page.selectOption('#algo-select', 'sha256')
  await expect(page.locator('#panel-repo .oid').first()).toBeVisible()
  await page.selectOption('#algo-select', 'sha1')

  // Advance the repository to the end of the story.
  for (let i = 0; i < 10; i++) {
    const advance = page.locator('#advance-repo')
    if ((await advance.count()) === 0) break
    await advance.click()
  }
  await expect(page.locator('#advance-repo')).toHaveCount(0)

  // Select an older commit and page through its files, then return to HEAD.
  const rows = page.locator('.commit-row')
  await rows.nth(3).click()
  const tabs = page.locator('.file-tab')
  for (let i = 0; i < (await tabs.count()); i++) await tabs.nth(i).click()
  await rows.first().click()

  // Both scans, so the compare grid and the reveal are populated.
  await page.click('#scan-head')
  await page.click('#walk-history')
  await expect(page.locator('.reveal')).toBeVisible()
  await expect(page.locator('.finding').first()).toBeVisible()

  // Every reference string through the entropy panel, then a typed value.
  const pills = page.locator('.pill')
  for (let i = 0; i < (await pills.count()); i++) await pills.nth(i).click()
  await page.fill('#entropy-input', 'correct horse battery staple 42')

  // Rotate, so the revoked styling of the finding cards is scanned too.
  await page.click('#rotate-key')
  await expect(page.locator('#rotate-key')).toBeDisabled()

  // Reveal everything still collapsed or animating.
  await page.addStyleTag({
    content: `*,*::before,*::after{animation:none!important;transition:none!important}`,
  })
  await page.evaluate(() => {
    document.querySelectorAll('details').forEach((d) => (d.open = true))
    document.querySelectorAll<HTMLElement>('[hidden]').forEach((node) => {
      node.removeAttribute('hidden')
      node.style.display = ''
    })
  })
  await page.waitForTimeout(300)
}

async function scan(page: Page): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(TAGS).analyze()
  expect(
    violations.map((v) => ({
      id: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 5),
    })),
  ).toEqual([])
}

test('no WCAG A/AA violations — dark theme', async ({ page }) => {
  await page.goto('.')
  await driveDemo(page)
  await scan(page)
})

test('no WCAG A/AA violations — light theme', async ({ page }) => {
  await page.goto('.')
  await page.locator('#cl-theme-toggle').click()
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  await driveDemo(page)
  await scan(page)
})

/**
 * Reflow (WCAG 1.4.10): at 320 CSS px the page must not require two-dimensional
 * scrolling. Wide tables are allowed to pan inside their own scroll box; the
 * document is not. This caught a four-column table setting an 839px scroll width
 * on a 390px viewport, which no desktop-only check would have shown.
 */
test('no horizontal page scroll at mobile widths', async ({ page }) => {
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('.')
    await driveDemo(page)
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      // Content inside a horizontal scroll box is *meant* to extend past the
      // viewport, so walk up and ignore anything with a clipping ancestor.
      culprits: (() => {
        const clipped = (node: Element | null): boolean => {
          while (node && node !== document.documentElement) {
            const ox = getComputedStyle(node).overflowX
            if (ox === 'auto' || ox === 'scroll' || ox === 'hidden') return true
            node = node.parentElement
          }
          return false
        }
        return [...document.querySelectorAll<HTMLElement>('body *')]
          .filter(
            (n) =>
              n.getBoundingClientRect().right > document.documentElement.clientWidth + 1 &&
              !clipped(n.parentElement),
          )
          .slice(0, 5)
          .map((n) => `${n.tagName.toLowerCase()}.${n.className}`)
      })(),
    }))
    expect(overflow, `viewport ${width}px`).toMatchObject({
      scrollWidth: overflow.clientWidth,
      culprits: [],
    })
  }
})
