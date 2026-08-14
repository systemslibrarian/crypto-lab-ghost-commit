/**
 * The WCAG A/AA gate for Ghost Commit.
 *
 * Four configurations — {dark, light} x {1280, 380} — each driven through every
 * state the lab can render, with a full scan after every single step. The
 * matrix is not padding: `data-theme` swaps the entire palette (the light theme
 * redefines every ink, including `--ink-on-accent` from near-black to white),
 * and 380px is where `.entropy-table`, `.remedy-table` and `.rules-table` take
 * their `min-width: 34rem` and start panning inside `.table-x`, where the four
 * two-column grids collapse to one, and where the top bar drops its button
 * labels. A single-configuration gate scans one quarter of this page.
 *
 * What the replaced spec did instead, and why none of it could be kept:
 *
 *  - it drove to the END state and scanned once, so the five intermediate
 *    commits, both un-run report columns, the clean-HEAD verdict, the
 *    pre-rotation callout and every reset were built and thrown away unmeasured;
 *  - it injected `*{animation:none;transition:none}` before scanning, which
 *    bypasses this sheet's own reduced-motion handling rather than exercising
 *    it — the suite could not have seen a `.contrib-row` stuck at `opacity: 0`;
 *  - it force-opened every `<details>` and stripped `[hidden]` from script,
 *    scanning a document no visitor can produce while never scanning the closed
 *    state every visitor lands on;
 *  - it asserted `violations` only, so axe's `incomplete` bucket — where
 *    `aria-prohibited-attr` and every gradient-backed contrast result live —
 *    went unread;
 *  - and it had no oracle for reflow beyond `scrollWidth`, no oracle for
 *    keyboard-reachable scrollers, and no arithmetic contrast check at all.
 */
import { test } from '@playwright/test';
import { NARROW, boot, driveAllStates, expectBaselineNotStale, reportCollected } from './gate';

test.describe.configure({ mode: 'default' });

test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(20_000);
});

// A collecting run (`A11Y_COLLECT=1`) records instead of throwing; this is what
// stops one being mistaken for a pass.
test.afterAll(() => {
  reportCollected();
});

for (const theme of ['dark', 'light'] as const) {
  test(`WCAG A/AA — ${theme}, 1280px`, async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 1280, height: 900 });
    await boot(page, theme);
    await driveAllStates(page, `${theme} 1280`);

    // The third ratchet rule — a baselined finding that no longer appears must
    // be deleted, so the list can only shrink toward empty.
    // `expectBaselineNotStale` was exported from `gate.ts` and imported by
    // nothing, so it had never run and the baseline could only grow.
    //
    // Called in all four configurations, which this lab's baseline permits: all
    // four entries are produced by all four drives, confirmed through the
    // gate's own capture path rather than assumed. (Sibling labs do not have
    // that luxury — an accent-bordered control fails in one theme only, and
    // there the check has to be scoped to the drive that sees it.)
    expectBaselineNotStale();
  });

  test(`WCAG A/AA — ${theme}, ${NARROW.width}px`, async ({ page }) => {
    test.slow();
    await page.setViewportSize(NARROW);
    await boot(page, theme);
    await driveAllStates(page, `${theme} ${NARROW.width}`);
    expectBaselineNotStale();
  });
}
