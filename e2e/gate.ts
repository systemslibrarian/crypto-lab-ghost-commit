import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { auditContrast, formatContrastFailures } from './contrast';
import { auditNonText } from './nontext';
import { NONTEXT_BASELINE } from './nontext-baseline';

export const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];

/** A phone-width viewport, for the WCAG 1.4.10 reflow half of the gate. */
export const NARROW = { width: 380, height: 800 };

/**
 * Soft-gate collection mode — strict unless `A11Y_COLLECT` is set.
 *
 * Fixing a page one thrown assertion at a time means one full four-config run
 * per defect. `A11Y_COLLECT=1 npx playwright test` instead records every failed
 * assertion, finishes the drive, and dumps the lot, so a page can be fixed in
 * one pass.
 *
 * The safety property that makes this permanent rather than a temporary hack:
 * `reportCollected()` runs after the suite and THROWS if a collecting run
 * recorded anything. A collection run therefore cannot be mistaken for a
 * passing gate — it fails, loudly, with the whole list attached — and with the
 * env var unset not one line of this behaves differently from a plain `expect`.
 */
const COLLECTING = Boolean(process.env.A11Y_COLLECT);
const collected: string[] = [];

async function soft(label: string, assertion: () => void | Promise<void>): Promise<void> {
  if (!COLLECTING) {
    await assertion();
    return;
  }
  try {
    await assertion();
  } catch (err) {
    collected.push(`[${label}] ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Fail the run if a collecting pass recorded anything. Call from `afterAll`. */
export function reportCollected(): void {
  if (!collected.length) return;
  const dump = collected.join('\n\n');
  const count = collected.length;
  collected.length = 0;
  throw new Error(
    `A11Y_COLLECT run recorded ${count} soft failure(s). This is NOT a pass.\n\n${dump}`
  );
}

/**
 * Shared machinery for the WCAG gate.
 *
 * Three rules govern everything here:
 *
 *  1. NOTHING IS INJECTED INTO THE PAGE BEFORE A SCAN. The spec this file
 *     replaces ended its drive with an `addStyleTag` that froze `animation` and
 *     `transition` to `none`, then walked the DOM stripping `[hidden]` and
 *     force-opening every `<details>`. Both are fatal to the thing a gate is
 *     for. Freezing animation from the outside means the suite never exercises
 *     this sheet's own `@media (prefers-reduced-motion: no-preference)` block —
 *     the block that owns `.contrib-row`'s staggered `opacity: 0 -> 1` entry —
 *     so it is structurally unable to see the defect where a row's only route
 *     to visibility is an animation. And force-opening the five `.disclose`
 *     panels scans a document no visitor can produce, while the *closed* state
 *     every visitor actually lands on goes unmeasured. This gate emulates the
 *     preference for real and clicks the summaries.
 *
 *  2. EVERY SCAN ASSERTS ITS CONTENT IS PRESENT FIRST, and there are scans well
 *     past first paint. Four of this page's five panels are rendered from
 *     TypeScript into empty `<section>` shells, so axe over `#panel-scan` before
 *     `data-app-ready` passes having checked an empty div.
 *
 *  3. `violations` IS NOT THE WHOLE ORACLE. See `scan`.
 */

/**
 * Wait for every running animation and transition to drain.
 *
 * Transitions drain in waves, not in one batch, so a poll for "nothing running
 * right now" can exit through a gap between waves. Require quiescence to hold
 * for several consecutive frames instead.
 */
export async function settle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __quietFrames?: number };
      const running = document.getAnimations().filter((a) => a.playState === 'running');
      w.__quietFrames = running.length === 0 ? (w.__quietFrames ?? 0) + 1 : 0;
      return w.__quietFrames >= 6;
    },
    undefined,
    { timeout: 20_000, polling: 'raf' }
  );
}

/**
 * Assert that reduced motion left the page visible, not merely un-animated.
 *
 * The failure mode this guards against is an element whose only route to its
 * visible state is an animation, in a stylesheet whose reduced-motion handling
 * cancels that animation without restoring its end state — the element then
 * renders at `opacity: 0` for every reader with the preference set.
 *
 * This page is the shape where that goes wrong: `.contrib-row` animates from
 * `opacity: 0`, one row per distinct character of the scored string. It happens
 * to be written the safe way round (the animation lives inside
 * `no-preference`, so `reduce` simply never applies it), but "happens to be"
 * is not a gate. This assertion is what makes it one, and it runs in every
 * driven state — the contribution table is re-rendered on every keystroke.
 */
async function expectNotBlank(page: Page, label: string): Promise<void> {
  const invisible = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? '')
        .join('')
        .trim();
      if (!own) continue;
      // Deliberately hidden subtrees are not "blank", they are closed.
      if (!(el as HTMLElement).checkVisibility?.({ checkVisibilityCSS: true })) continue;
      let effective = 1;
      let node: Element | null = el;
      while (node) {
        effective *= parseFloat(getComputedStyle(node).opacity);
        node = node.parentElement;
      }
      if (effective === 0) {
        out.push(`${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}`);
      }
    }
    return Array.from(new Set(out));
  });
  await soft(label, () =>
    expect(invisible, `no visible text may render at opacity 0 in state: ${label}`).toEqual([])
  );
}

/**
 * Load the page in a known theme with reduced motion actually in effect, and
 * assert the content every scan relies on is really on the page.
 *
 * `test.use({ reducedMotion })` silently does nothing on Playwright 1.61.1, so
 * the emulation is applied imperatively BEFORE the navigation and then
 * *asserted* from inside the page.
 *
 * THE DEFAULTS ARE ASSERTED, NOT ASSUMED. `initialState()` seeds the repository
 * with only the two `kind: 'seed'` commits, leaves `algo` at `sha1`, both scan
 * reports `null`, `rotated` false and `subject` empty. Every one of those is
 * checked here, because a drive that starts from a different place than it
 * thinks measures a different half of the lab than it reports.
 */
export async function boot(page: Page, theme: 'dark' | 'light'): Promise<void> {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript((t) => localStorage.setItem('theme', t), theme);
  await page.goto('.');
  expect(
    await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches),
    'reduced-motion emulation must actually be in effect'
  ).toBe(true);
  // index.html's anti-flash script stamps `data-theme` unconditionally from the
  // same `theme` key the shared bar's toggle writes, so both themes are stamped.
  await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

  // The four interactive panels are rendered from TypeScript into empty shells.
  await page.waitForFunction(() => document.documentElement.dataset.appReady === 'true');
  for (const id of ['panel-repo', 'panel-scan', 'panel-entropy', 'panel-fix']) {
    await expect(page.locator(`#${id}`)).not.toBeEmpty();
  }

  // Shipped defaults, asserted.
  await expect(page.locator('#algo-select')).toHaveValue('sha1');
  await expect(page.locator('.progress-line span').first()).toHaveText('Commit 2 of 6');
  await expect(page.locator('#advance-repo')).toHaveText('Commit the key');
  // Both report columns start un-run, and the reveal is gated behind the walk.
  await expect(page.locator('.report-block .note')).toHaveCount(2);
  await expect(page.locator('.reveal')).toHaveCount(0);
  await expect(page.locator('#rotate-key')).toBeEnabled();
  // `subject` is empty, and `subjectOf` falls back to the leaked key.
  await expect(page.locator('#entropy-input')).toHaveValue(
    'acmepay_live_4eC39HqLyjWDarjtT1zdp7dc'
  );
  // Every disclosure starts closed. Force-opening them was the old gate's bug.
  expect(
    await page.locator('details.disclose[open]').count(),
    'no disclosure may start open'
  ).toBe(0);

  await settle(page);
  await expectNotBlank(page, `${theme} first paint`);
}

/**
 * Assert the page does not require horizontal scrolling.
 *
 * WCAG 1.4.10 (Reflow, AA). axe has no rule for this at all, and this lab is a
 * plausible offender: it prints 40- and 64-hex-character object ids, `white-space:
 * pre` source lines, and three tables that are given `min-width: 34rem` below
 * 640px on the explicit understanding that they pan inside `.table-x` rather
 * than taking the page with them.
 */
export async function expectNoHorizontalOverflow(page: Page, label: string): Promise<void> {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    // `body { overflow-x: hidden }` propagates to the viewport when `html`
    // leaves `overflow` at `visible`, so `scrollWidth` stays equal to
    // `clientWidth` even when content is CUT OFF — a worse 1.4.10 outcome than
    // a scrollbar, and invisible to the standard check. This sheet does not set
    // that rule today; the check is kept because adding it is the single most
    // tempting "fix" for a reflow failure and it would silence this oracle
    // permanently rather than fixing anything.
    const clippedByViewport = ['hidden', 'clip'].includes(
      getComputedStyle(document.body).overflowX,
    );
    if (!clippedByViewport && doc.scrollWidth <= doc.clientWidth) return null;

    // Only elements that actually push the DOCUMENT sideways are culprits. The
    // `min-width: 34rem` tables have huge bounding rects but are clipped by
    // their `.table-x` scroller and contribute nothing to the document's scroll
    // width — naming one sends you off fixing the wrong element.
    const clipped = (el: Element): boolean => {
      let n = el.parentElement;
      // Stop BEFORE <body>. When `body { overflow-x: hidden }` propagates to the
      // viewport, body itself answers "hidden" to this walk — so every element
      // on the page reads as clipped, `escaping` is always empty, and the oracle
      // reports nothing at all. That is the failure this whole check exists to
      // avoid: a viewport-level clip is the DEFECT, not a legitimate scroller.
      // Only a genuine scrolling container INSIDE the page excuses an overflow.
      while (n && n !== doc && n !== document.body) {
        const ox = getComputedStyle(n).overflowX;
        if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true;
        n = n.parentElement;
      }
      return false;
    };

    const over = Array.from(document.querySelectorAll('body *'))
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((x) => x.r.width > 0 && x.r.right > doc.clientWidth + 1)
      .sort((a, b) => b.r.right - a.r.right);
    // Anything inside a real scroller is reachable and is not a finding; only
    // what escapes the viewport with no way back is.
    const escaping = over.filter((x) => !clipped(x.el));
    if (!escaping.length) return null;
    const widest = escaping[0];
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      widest: widest
        ? `${widest.el.tagName.toLowerCase()}${widest.el.id ? '#' + widest.el.id : ''}` +
          `${widest.el.getAttribute('class') ? '.' + widest.el.getAttribute('class')!.trim().split(/\s+/).join('.') : ''}` +
          ` @${Math.round(widest.r.width)}px right=${Math.round(widest.r.right)}`
        : '(none identified)',
    };
  });
  await soft(label, () =>
    expect(overflow, `page must not scroll horizontally in state: ${label}`).toBeNull()
  );
}

/**
 * Every scrolling container must be operable from the keyboard (WCAG 2.1.1).
 * If it holds no focusable content it needs `tabindex="0"`, so it becomes a
 * focus target arrow keys can then scroll.
 *
 * This lab routes most of them through `scrollRegion()`, which sets
 * `tabindex="0"` and a `role`/`aria-label` pair — but `.finding-code` and
 * `.verify-block` set `overflow-x: auto` in CSS directly, and the
 * `min-width: 34rem` tables only start overflowing below 640px. Which is the
 * point of running this in a state the drive has to build, at both widths.
 */
export async function expectScrollersReachable(page: Page, label: string): Promise<void> {
  const unreachable = await page.evaluate(() => {
    const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
    return Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((el) => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (
          ['auto', 'scroll'].includes(cs.overflowX) || ['auto', 'scroll'].includes(cs.overflowY)
        );
      })
      .filter((el) => el.tabIndex < 0 && !el.querySelector(FOCUSABLE))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}.${(el.getAttribute('class') ?? '').trim()}` +
          ` (${el.scrollWidth}x${el.scrollHeight} in ${el.clientWidth}x${el.clientHeight})`
      );
  });
  await soft(label, () =>
    expect(
      Array.from(new Set(unreachable)),
      `scrolling regions with no keyboard route in state: ${label}`
    ).toEqual([])
  );
}

/**
 * Scan the page as it currently stands.
 *
 * Five assertions, because axe's `violations` array alone is not a complete
 * oracle:
 *
 *  - `violations` — the usual WCAG A/AA rule failures.
 *  - `incomplete` — axe's "could not decide" bucket, which never reaches the
 *    violations array. The one rule id allowed to remain incomplete is
 *    `color-contrast`, and only because the next assertion computes those
 *    ratios arithmetically. Everything else in that bucket is a real result
 *    axe simply could not finish — including `aria-prohibited-attr`, which is
 *    where an `aria-label` on a role-less div hides, a defect that never
 *    reaches the violations array at all.
 *  - arithmetic contrast — composite-aware WCAG 1.4.3 over every text node.
 *  - keyboard reachability of scrolling regions — WCAG 2.1.1.
 *  - reflow — WCAG 1.4.10, which axe has no rule for at all.
 *
 * Two whole classes of failure have no oracle here and were measured by hand
 * from screenshot pixels instead: WCAG 1.4.11 non-text contrast (control
 * boundaries, bar fills, the threshold marker) and generated content
 * (`::before`/`::after`), which is neither an element nor a text node and so is
 * invisible to axe and to the arithmetic walk alike.
 */
/**
 * WCAG 1.4.11 and generated content, ratcheted against a per-repo baseline.
 *
 * Neither class has ANY other oracle: axe has no rule for non-text contrast,
 * and the arithmetic text walk cannot reach a control's boundary or a
 * `::before` glyph, because a pseudo-element is not an element and owns no text
 * node. Both were being found by hand-sampling screenshot pixels, which does
 * not regress-test.
 *
 * The backlog is real, so this does not block on it — but a check that merely
 * logs is not a gate, and this sweep has spent its whole length deleting checks
 * that could not fail. So it ratchets instead: anything NOT in the baseline
 * fails, anything in the baseline that got WORSE fails, and anything in the
 * baseline that has been FIXED fails until its entry is deleted. That last rule
 * is what stops the allowlist becoming a permanent exemption.
 */
const nonTextSeen = new Set<string>();

export async function expectNoNewNonTextFailures(page: Page, label: string): Promise<void> {
  const found = await auditNonText(page);
  // Capture mode: emit every finding and assert nothing, so a baseline can be
  // generated by the SAME path that checks it. Opt-in via env, and the run is
  // deliberately left failing at the end by `expectBaselineNotStale` so a
  // capture pass can never be mistaken for a passing gate.
  if (process.env.NT_BASELINE_CAPTURE) {
    for (const f of found) {
      console.log(`NTCAP|${f.kind}|${f.selector}|${f.ratio}|${f.required}|${/POSITIONED/.test(f.detail)}`);
    }
    return;
  }
  const problems: string[] = [];
  for (const f of found) {
    const key = `${f.kind}|${f.selector}`;
    nonTextSeen.add(key);
    const base = NONTEXT_BASELINE[key];
    if (!base) {
      problems.push(`NEW ${f.ratio}:1 (needs ${f.required}:1) [${f.kind}] ${f.selector} — ${f.detail}`);
    } else if (f.ratio < base.ratio - 0.01) {
      problems.push(
        `WORSE ${f.selector}: ${f.ratio}:1, baseline recorded ${base.ratio}:1`
      );
    }
  }
  expect(problems, `new or worsened non-text contrast in state: ${label}`).toEqual([]);
}

/**
 * Fail if a baselined finding never appeared during the whole drive.
 *
 * It has either been fixed — in which case delete the entry, which is the point
 * — or the drive stopped reaching the state that shows it, which is a coverage
 * regression worth knowing about. Call once, after `driveAllStates`.
 */
export function expectBaselineNotStale(): void {
  const unseen = Object.keys(NONTEXT_BASELINE).filter((k) => !nonTextSeen.has(k));
  expect(
    unseen,
    'baselined non-text findings that no longer appear — delete them from nontext-baseline.ts (or restore the drive state that showed them)'
  ).toEqual([]);
}

export async function scan(page: Page, label: string): Promise<void> {
  await settle(page);
  await expectNotBlank(page, label);
  const results = await new AxeBuilder({ page }).withTags(TAGS).analyze();

  const violations = results.violations.map((v) => ({
    state: label,
    id: v.id,
    impact: v.impact,
    help: v.help,
    nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
  }));
  await soft(label, () => expect(violations, `axe violations in state: ${label}`).toEqual([]));

  const unexplainedIncomplete = results.incomplete
    .filter((v) => v.id !== 'color-contrast')
    .map((v) => ({
      state: label,
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(' ')).slice(0, 8),
    }));
  await soft(label, () =>
    expect(unexplainedIncomplete, `axe incomplete results in state: ${label}`).toEqual([])
  );

  const contrast = Array.from(new Set(formatContrastFailures(await auditContrast(page))));
  await soft(label, () =>
    expect(contrast, `measured contrast failures in state: ${label}`).toEqual([])
  );

  await expectNoNewNonTextFailures(page, label);
  await expectScrollersReachable(page, label);
  await expectNoHorizontalOverflow(page, label);
}

/** Open a `<details>` by clicking its summary — never by setting `.open`. */
async function openDisclosure(page: Page, summaryText: string | RegExp): Promise<void> {
  const summary = page.locator('details.disclose > summary', { hasText: summaryText }).first();
  await summary.click();
  await expect(summary.locator('xpath=..')).toHaveAttribute('open', '');
}

/**
 * Drive the lab through every state that renders content, scanning each.
 *
 * The story is a ratchet: the repository advances one commit at a time and each
 * advance invalidates both scan reports, so the empty/prerequisite states are
 * not a one-off at first paint — they come back four times. That is walked
 * deliberately rather than skipped to the end, because the panels the old spec
 * force-revealed (`.reveal`, the object-store disclosure, the finding cards)
 * only exist once a real run has produced them.
 */
export async function driveAllStates(page: Page, theme: string): Promise<void> {
  const at = async (label: string): Promise<void> => scan(page, `${theme} / ${label}`);

  await at('first paint (2 of 6 committed, nothing scanned)');

  // --- Prerequisite states, before anything has been run -------------------
  // Both report columns hold their "Not run yet" note; the fix panel holds its
  // "run the history walk first" note; neither reveal nor object store exists.
  await expect(page.locator('#panel-fix .note')).toHaveCount(1);

  // Scan HEAD with a clean HEAD: the `verdict-clean` branch, which the end of
  // the story reaches too but which no other state on the way there does.
  await page.click('#scan-head');
  await expect(page.locator('.verdict-clean')).toBeVisible();
  await at('scan HEAD at commit 2 — clean verdict, history still unrun');

  // --- The mode fork: both object formats --------------------------------
  // Switching rewrites every id in the panel and resets both reports, so the
  // sha256 branch is scanned in the same un-run state the sha1 branch was.
  await page.selectOption('#algo-select', 'sha256');
  await expect(page.locator('#panel-repo .oid').first()).toBeVisible();
  await expect(page.locator('.report-block .note')).toHaveCount(2);
  await at('sha256 object format');
  await page.selectOption('#algo-select', 'sha1');
  await expect(page.locator('.report-block .note')).toHaveCount(2);
  await at('back to sha1');

  // --- Advance the story one commit at a time -----------------------------
  // Four user-driven steps remain: leak, unrelated, redact, delete. The leak
  // step's button carries `.tone-leak` (the alarm fill), which no other state
  // shows, and only the redact and delete steps produce a HEAD that is clean
  // while the history is not.
  for (let step = 3; step <= 6; step++) {
    const advance = page.locator('#advance-repo');
    await expect(advance).toBeVisible();
    await advance.click();
    await expect(page.locator('.progress-line span').first()).toHaveText(`Commit ${step} of 6`);
    // Advancing invalidates both reports — the un-run notes are back.
    await expect(page.locator('.report-block .note')).toHaveCount(2);
    await at(`commit ${step} of 6 committed, reports invalidated`);

    await page.click('#scan-head');
    await expect(page.locator('.report-block .note')).toHaveCount(1);
    await at(`commit ${step} of 6, HEAD scanned`);
  }

  // The story is finished: the advance button is gone and the `note-done` sits
  // in its place.
  await expect(page.locator('#advance-repo')).toHaveCount(0);
  await expect(page.locator('.note-done')).toBeVisible();

  // --- The history walk, and everything it unlocks ------------------------
  await page.click('#walk-history');
  await expect(page.locator('.finding').first()).toBeVisible();
  // HEAD is clean and the history is not, so the reveal is on screen; the
  // commit rows that still hold the key are now `.is-tainted`.
  await expect(page.locator('.reveal')).toBeVisible();
  await expect(page.locator('.commit-row.is-tainted').first()).toBeVisible();
  await at('history walked — findings, reveal, tainted commit rows');

  // The object-store disclosure only exists after the walk. Open it by click.
  await openDisclosure(page, 'Every object in the store');
  await expect(page.locator('.object-scroll table tbody tr').first()).toBeVisible();
  await at('object store disclosure open');

  // --- Commit selection and the file tabs ---------------------------------
  // Commit 3 is the one that introduced the key, so its config.py renders with
  // the `.secret-mark` highlight; the newest commit omits the path entirely and
  // renders the `note-warn` instead. Both are only reachable by selecting.
  const rows = page.locator('.commit-row');
  await rows.nth(3).click();
  await expect(page.locator('.commit-row.is-selected')).toHaveCount(1);
  await at('older commit selected');

  const tabs = page.locator('.file-tab');
  const tabCount = await tabs.count();
  expect(tabCount, 'the selected commit must list its files').toBeGreaterThan(1);
  for (let i = 0; i < tabCount; i++) {
    await tabs.nth(i).click();
    await expect(tabs.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await at(`older commit, file tab ${i + 1} of ${tabCount}`);
  }

  await rows.first().click();
  await expect(page.locator('.note-warn').first()).toBeVisible();
  await at('HEAD selected — config.py absent from the tree');

  // --- Rotation: the finding must NOT disappear ---------------------------
  await page.click('#rotate-key');
  await expect(page.locator('#rotate-key')).toBeDisabled();
  await expect(page.locator('.finding.is-revoked').first()).toBeVisible();
  await expect(page.locator('.callout-safe')).toBeVisible();
  await at('rotated — revoked findings, safe callout');

  // --- The entropy panel: every reference string, then typed input --------
  const pills = page.locator('.pill');
  const pillCount = await pills.count();
  expect(pillCount, 'the entropy panel must offer reference strings').toBeGreaterThan(0);
  for (let i = 0; i < pillCount; i++) {
    await pills.nth(i).click();
    await expect(pills.nth(i)).toHaveAttribute('aria-pressed', 'true');
    await at(`entropy sample ${i + 1} of ${pillCount}`);
  }

  // A typed string that a real scanner would never hand to the entropy
  // function: this is the only route to the `note-info` explanation.
  await page.fill('#entropy-input', 'the quick brown fox');
  await expect(page.locator('#panel-entropy .note-info')).toBeVisible();
  await at('typed non-candidate string');

  // A long single-character run — zero entropy, and the shortest possible
  // contribution table (one row).
  await page.fill('#entropy-input', 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
  await expect(page.locator('.contrib-table tbody tr')).toHaveCount(1);
  await at('typed zero-entropy string');

  // Emptying the box falls back to the leaked key rather than blanking — the
  // "Type something above" note is unreachable, which is worth a scan proving.
  await page.fill('#entropy-input', '');
  await expect(page.locator('.contrib-table tbody tr').first()).toBeVisible();
  await at('entropy input emptied — falls back to the leaked key');

  // --- The four static disclosures ---------------------------------------
  await openDisclosure(page, 'The format rules');
  await at('format-rule table open');
  await openDisclosure(page, 'Where the thresholds come from');
  await at('threshold provenance open');
  await openDisclosure(page, 'Glossary');
  await at('glossary open');
  await openDisclosure(page, 'Verify the hashes yourself');
  await at('hash verification open');

  // --- The skip link, which is only on screen while focused ---------------
  await page.locator('.cl-skip-link').focus();
  await expect(page.locator('.cl-skip-link')).toBeFocused();
  await at('skip link focused');

  // --- Reset, back to the shipped defaults --------------------------------
  await page.click('#reset-repo');
  await expect(page.locator('.progress-line span').first()).toHaveText('Commit 2 of 6');
  await expect(page.locator('#advance-repo')).toHaveText('Commit the key');
  await expect(page.locator('.reveal')).toHaveCount(0);
  await expect(page.locator('#rotate-key')).toBeEnabled();
  await expect(page.locator('.report-block .note')).toHaveCount(2);
  await at('after reset');
}
