/**
 * The WCAG A/AA gate for Ghost Commit.
 *
 * The published dark theme is tested at desktop and narrow widths. The narrow
 * tables require horizontal scrolling, the grids collapse to one column, and
 * the top bar loses its visible button labels. Both layouts get a full drive.
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
import { expect, test } from '@playwright/test';
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

for (const theme of ['dark'] as const) {
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
    // Called in both layouts, which this lab's baseline permits: all
    // four entries are produced by both drives, confirmed through the
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


test('the response table identifies what credential revocation changes', async ({ page }) => {
  await boot(page, 'dark');
  const table = page.locator('#panel-fix table');
  await expect(table.getByRole('columnheader', { name: 'Does it revoke the old credential?' })).toBeVisible();
  await expect(table.getByRole('row', { name: /Force-push over the branch/i })).toContainText('can eventually be pruned');
  await expect(table.getByRole('row', { name: /Rotate the credential/i })).toContainText('does not undo earlier use');
});
