/**
 * Panel 4 — the fix that isn't, and the one that is.
 *
 * The critical design choice here: rotating does *not* change the scan. The
 * findings, the blob id, and the commit list are byte-for-byte what they were.
 * Only the real-world consequence changes. A demo that made the finding disappear
 * on rotation would teach the opposite of the truth.
 */

import { LEAKED_KEY } from '../git/scenario'
import { scanHistory } from '../scan/scanner'
import type { Store } from './state'
import { type Child, chip, el, mount, objectId, tableScroll } from './dom'

interface Remedy {
  readonly title: string
  readonly command: string
  readonly effect: string
  readonly verdict: 'no' | 'partial' | 'yes'
  readonly detail: string
}

const REMEDIES: readonly Remedy[] = [
  {
    title: 'Edit the file and commit',
    command: 'git commit -am "remove key"',
    effect: 'Adds a commit. Removes nothing.',
    verdict: 'no',
    detail:
      'The old blob is still named by its own hash and still reachable from the older commit. You have documented the secret’s location in the diff.',
  },
  {
    title: 'Delete the file',
    command: 'git rm src/config.py && git commit',
    effect: 'Adds a commit. Removes nothing.',
    verdict: 'no',
    detail: 'Identical to the above from the object store’s point of view — a new tree that omits a path.',
  },
  {
    title: 'Force-push over the branch',
    command: 'git reset --hard HEAD~3 && git push --force',
    effect: 'Moves your branch. Does not reach anyone else’s copy.',
    verdict: 'no',
    detail:
      'Every existing clone, fork, CI cache, and the platform’s own dangling-object storage keeps the commit. On GitHub, an unreferenced commit stays fetchable by its SHA — and forks make it permanent.',
  },
  {
    title: 'Rewrite history',
    command: 'git filter-repo --replace-text …',
    effect: 'Genuinely rewrites the objects — and every downstream id.',
    verdict: 'partial',
    detail:
      'Necessary hygiene, not a remedy. It changes every commit id from the rewrite point forward, breaking every clone and every reference to those SHAs — and it still cannot recall what was already fetched, scraped, or indexed.',
  },
  {
    title: 'Rotate the credential',
    command: '(at the provider) revoke, issue a new key',
    effect: 'Makes the leaked value worthless.',
    verdict: 'yes',
    detail:
      'This is the only action that changes the attacker’s position. The string stays in history forever; it simply stops opening anything.',
  },
]

const VERDICT_CHIP: Record<Remedy['verdict'], () => HTMLElement> = {
  no: () => chip('alarm', 'does not fix it'),
  partial: () => chip('warn', 'helps, not enough'),
  yes: () => chip('safe', 'this is the fix'),
}

function remedyTable(): HTMLElement {
  const table = el('table', { class: 'data-table remedy-table' }, [
    el('caption', {}, ['What each response actually does to the leaked value.']),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Response']),
        el('th', { scope: 'col' }, ['Effect on the repository']),
        el('th', { scope: 'col' }, ['Does it undo the exposure?']),
      ]),
    ]),
    el(
      'tbody',
      {},
      REMEDIES.map((r) =>
        el('tr', {}, [
          el('th', { scope: 'row' }, [
            el('span', { class: 'row-label' }, [r.title]),
            el('code', { class: 'row-cmd' }, [r.command]),
          ]),
          el('td', {}, [
            el('span', {}, [r.effect]),
            el('span', { class: 'row-note' }, [r.detail]),
          ]),
          el('td', {}, [VERDICT_CHIP[r.verdict]()]),
        ]),
      ),
    ),
  ])
  return tableScroll('What each response does', table)
}

export function renderFixPanel(store: Store, root: HTMLElement): void {
  const { rotated, historyReport } = store.state
  const leak = historyReport?.findings.find((f) => f.value === LEAKED_KEY)

  const rotate = el(
    'button',
    { type: 'button', class: 'primary tone-fix', id: 'rotate-key', disabled: rotated },
    [rotated ? 'Key already rotated' : 'Rotate the key at the provider'],
  )
  rotate.addEventListener('click', () => {
    void store.updateAsync(async (s) => {
      s.rotated = true
      // Re-run the identical scan so the learner can see for themselves that
      // nothing about the repository changed.
      if (s.historyReport) s.historyReport = await scanHistory(s.repo)
    })
  })

  const statusChildren: Child[] = [
    el('h3', {}, ['Credential status']),
    el('div', { class: 'status-row' }, [
      rotated ? chip('safe', 'revoked — inert') : chip('alarm', 'live — still works'),
    ]),
  ]

  if (leak) {
    statusChildren.push(
      el('dl', { class: 'finding-facts' }, [
        el('dt', {}, ['Blob still in history']),
        el('dd', {}, [objectId(leak.blob, 16)]),
        el('dt', {}, ['Commits still reaching it']),
        el('dd', {}, [String(leak.commits.length)]),
        el('dt', {}, ['Scanner output after rotation']),
        el('dd', {}, [
          rotated
            ? 'Identical. Same blob, same commits, same finding.'
            : 'Rotate and compare — the point is that this line will not change.',
        ]),
      ]),
    )
  } else {
    statusChildren.push(
      el('p', { class: 'note' }, [
        'Run the history walk in panel 2 first, so there is a finding to watch stay put.',
      ]),
    )
  }

  mount(root, [
    el('div', { class: 'panel-head' }, [
      el('h2', { id: 'fix-heading' }, ['4 · The fix, and the four things that are not']),
      el('p', { class: 'panel-lede' }, [
        'You have already tried the two responses most people reach for: edit the value out, then delete the file. Both added a commit. Neither removed an object.',
      ]),
    ]),
    el('div', { class: 'fix-grid' }, [
      el('div', { class: 'status-card', role: 'status', 'aria-live': 'polite' }, statusChildren),
      el('div', {}, [
        el('div', { class: 'actions' }, [rotate]),
        rotated
          ? el('div', { class: 'callout callout-safe' }, [
              el('h4', {}, ['Notice what did not change.']),
              el('p', {}, [
                'The blob id is the same. The commits are the same. The scanner still finds the string, and it always will. What changed is outside git entirely: the value no longer authenticates. ',
                el('strong', {}, ['Deletion addresses the file; rotation addresses the exposure.']),
              ]),
            ])
          : el('div', { class: 'callout callout-warn' }, [
              el('h4', {}, ['Before you click.']),
              el('p', {}, [
                'Predict what the scan will say afterwards. Most people expect the finding to clear. It will not — and that is the lesson.',
              ]),
            ]),
      ]),
    ]),
    remedyTable(),
    el('div', { class: 'callout' }, [
      el('h4', {}, ['The operational order, when it happens to you']),
      el('ol', { class: 'ordered' }, [
        el('li', {}, ['Rotate first. Assume the value is compromised from the moment it was pushed.']),
        el('li', {}, ['Check the provider’s access logs for use of the old credential.']),
        el('li', {}, ['Then, if you must, rewrite history — knowing it breaks every clone.']),
        el('li', {}, [
          'Add a pre-commit hook and a CI scan so the next one is caught before it is pushed, not after.',
        ]),
      ]),
    ]),
  ])
}
