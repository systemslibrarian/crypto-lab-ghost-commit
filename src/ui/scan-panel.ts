/**
 * Panel 2 — scan HEAD, then walk the history.
 *
 * The two buttons run the *same scanner*. The only difference is the list of
 * commits it is handed. Both results stay on screen side by side, because the
 * comparison is the lesson — a single "scan" button that quietly does the right
 * thing would hide it.
 */

import { CONFIG_PATH, LEAKED_KEY } from '../git/scenario'
import { scanHead, scanHistory } from '../scan/scanner'
import type { Finding, ScanReport } from '../scan/scanner'
import type { Store } from './state'
import { type Child, chip, codeLine, el, fmt, mount, objectId, scrollRegion } from './dom'

function stat(label: string, value: string): HTMLElement {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-value' }, [value]),
    el('span', { class: 'stat-label' }, [label]),
  ])
}

function findingCard(finding: Finding, rotated: boolean): HTMLElement {
  const commits = finding.commits
  const detectedBy = finding.signals.map((s) =>
    s === 'entropy' ? 'Shannon entropy' : 'format rule',
  )

  return el('article', { class: `finding${rotated ? ' is-revoked' : ''}` }, [
    el('header', { class: 'finding-head' }, [
      el('h4', {}, [finding.path, ':', String(finding.line)]),
      rotated ? chip('safe', 'revoked — inert') : chip('alarm', 'live credential'),
      finding.atHead ? chip('alarm', 'present at HEAD') : chip('warn', 'absent from HEAD'),
    ]),
    // The source line scrolls sideways, so it needs a name and keyboard reach.
    scrollRegion(`Source line at ${finding.path}:${finding.line}`, 'finding-code', [
      codeLine(finding.source, finding.value),
    ]),
    el('dl', { class: 'finding-facts' }, [
      el('dt', {}, ['Detected by']),
      el('dd', {}, [detectedBy.join(' + ')]),
      ...(finding.verdict
        ? [
            el('dt', {}, ['Entropy']),
            el('dd', {}, [
              `${fmt(finding.verdict.entropy)} bits/char over ${finding.verdict.length} characters `,
              el('span', { class: 'muted' }, [`(${finding.verdict.reason})`]),
            ]),
          ]
        : []),
      ...(finding.rules.length > 0
        ? [
            el('dt', {}, ['Rules matched']),
            el(
              'dd',
              {},
              finding.rules.map((r) =>
                el('span', { class: 'rule-tag', title: r.source }, [r.name]),
              ),
            ),
          ]
        : []),
      el('dt', {}, ['Blob']),
      el('dd', {}, [
        objectId(finding.blob, 16),
        el('span', { class: 'muted' }, [
          ' — the object that holds it. Nothing you did removed this.',
        ]),
      ]),
      el('dt', {}, [`Reachable from ${commits.length} commit${commits.length === 1 ? '' : 's'}`]),
      el(
        'dd',
        {},
        commits.map((c) =>
          el('span', { class: 'commit-ref' }, [objectId(c.hash, 8), ` ${c.message}`]),
        ),
      ),
    ]),
  ])
}

function reportBlock(
  title: string,
  subtitle: string,
  report: ScanReport | null,
  rotated: boolean,
  emptyHint: string,
): HTMLElement {
  const children: Child[] = [
    el('h3', {}, [title]),
    el('p', { class: 'panel-lede' }, [subtitle]),
  ]

  if (!report) {
    children.push(el('p', { class: 'note' }, [emptyHint]))
  } else {
    children.push(
      el('div', { class: 'stat-row' }, [
        stat('commits scanned', String(report.commitsScanned)),
        stat('blobs scanned', String(report.blobsScanned)),
        stat('lines read', String(report.linesScanned)),
        stat('candidates', String(report.candidatesScored)),
      ]),
    )
    if (report.findings.length === 0) {
      children.push(
        el('div', { class: 'verdict verdict-clean' }, [
          chip('neutral', 'no findings'),
          el('p', {}, [
            'Nothing flagged. Read that carefully: it is a statement about the commits this scan was given, and nothing more.',
          ]),
        ]),
      )
    } else {
      children.push(
        el('div', { class: 'verdict verdict-hit' }, [
          chip('alarm', `${report.findings.length} finding${report.findings.length === 1 ? '' : 's'}`),
        ]),
        ...report.findings.map((f) => findingCard(f, rotated)),
      )
    }
  }

  return el(
    'div',
    { class: 'report-block', role: 'status', 'aria-live': 'polite' },
    children,
  )
}

export function renderScanPanel(store: Store, root: HTMLElement): void {
  const { headReport, historyReport, historyWalked, rotated, repo } = store.state

  const scanHeadBtn = el('button', { type: 'button', class: 'primary', id: 'scan-head' }, [
    'Scan HEAD only',
  ])
  scanHeadBtn.addEventListener('click', () => {
    void store.updateAsync(async (s) => {
      s.headReport = await scanHead(s.repo)
    })
  })

  const walkBtn = el('button', { type: 'button', class: 'primary tone-reveal', id: 'walk-history' }, [
    'Walk the full history',
  ])
  walkBtn.addEventListener('click', () => {
    void store.updateAsync(async (s) => {
      s.historyReport = await scanHistory(s.repo)
      s.historyWalked = true
    })
  })

  const stillThere =
    historyReport?.findings.some((f) => f.value === LEAKED_KEY) ?? false
  const headClean = headReport !== null && headReport.findings.length === 0

  mount(root, [
    el('div', { class: 'panel-head' }, [
      el('h2', { id: 'scan-heading' }, ['2 · Scan it']),
      el('p', { class: 'panel-lede' }, [
        'The same scanner, run twice. The only thing that changes is which commits it is handed: the newest one, or all of them.',
      ]),
    ]),
    el('div', { class: 'actions' }, [scanHeadBtn, walkBtn]),
    el('div', { class: 'compare-grid' }, [
      reportBlock(
        'git scan HEAD',
        'What a scanner sees looking at a fresh checkout — one commit, one tree.',
        headReport,
        rotated,
        'Not run yet. Start here: check whether the file you are looking at is clean.',
      ),
      reportBlock(
        'git rev-list HEAD | scan each',
        'What a scanner sees looking at the repository — every commit on the parent chain.',
        historyReport,
        rotated,
        'Not run yet. Run it after the HEAD scan, and compare the two columns.',
      ),
    ]),
    headClean && stillThere
      ? el('aside', { class: 'reveal', role: 'note' }, [
          el('h3', {}, ['This is the whole demo, in one sentence.']),
          el('p', {}, [
            'HEAD is clean. The repository is not. The credential sits in blob ',
            objectId(
              historyReport?.findings.find((f) => f.value === LEAKED_KEY)?.blob ?? '',
              16,
            ),
            ', reachable from a commit that is still on the branch, and it will stay there in every clone, every fork, and every CI cache that ever pulled this repo.',
          ]),
          el('p', { class: 'muted' }, [
            'Anyone can reproduce it without cloning anything special: ',
            el('code', {}, ['git log -p --all -- ' + CONFIG_PATH]),
            ' or ',
            el('code', {}, ['git rev-list --objects --all']),
            '.',
          ]),
        ])
      : null,
    historyWalked
      ? el('details', { class: 'disclose' }, [
          el('summary', {}, ['Every object in the store, including the ones HEAD cannot reach']),
          scrollRegion(
            'Object store contents',
            'object-scroll',
            [
              el('table', { class: 'data-table' }, [
                el('thead', {}, [
                  el('tr', {}, [
                    el('th', { scope: 'col' }, ['Object id']),
                    el('th', { scope: 'col' }, ['Type']),
                    el('th', { scope: 'col' }, ['Holds the key?']),
                  ]),
                ]),
                el(
                  'tbody',
                  {},
                  repo.store.entries().map(([hash, obj]) =>
                    el('tr', {}, [
                      el('th', { scope: 'row' }, [objectId(hash, 16)]),
                      el('td', {}, [obj.type]),
                      el('td', {}, [
                        obj.type === 'blob' && obj.text.includes(LEAKED_KEY)
                          ? chip('alarm', 'yes')
                          : chip('neutral', 'no'),
                      ]),
                    ]),
                  ),
                ),
              ]),
            ],
          ),
        ])
      : null,
  ])
}
