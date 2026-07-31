/**
 * Panel 1 — the repository.
 *
 * A commit graph on the left, the selected commit's working tree on the right, and
 * one button that advances the story. Everything shown here (object ids, tree ids,
 * blob ids) is computed, never stored: the same values `git` prints.
 */

import { CONFIG_PATH, LEAKED_KEY, SCENARIO } from '../git/scenario'
import { type Store, buildRepo, nextStep } from './state'
import { type Child, chip, codeLine, el, mount, objectId, scrollRegion } from './dom'

function commitList(store: Store): HTMLElement {
  const { repo, selectedCommit, historyWalked } = store.state
  const commits = [...repo.log].reverse() // newest first, the way `git log` reads

  const items = commits.map((commit, i) => {
    const isHead = i === 0
    const holdsSecret = (commit.snapshot[CONFIG_PATH] ?? '').includes(LEAKED_KEY)
    const selected = commit.hash === selectedCommit

    const button = el(
      'button',
      {
        type: 'button',
        class: `commit-row${selected ? ' is-selected' : ''}${historyWalked && holdsSecret ? ' is-tainted' : ''}`,
        'aria-pressed': selected ? 'true' : 'false',
      },
      [
        el('span', { class: 'commit-dot', 'aria-hidden': 'true' }),
        el('span', { class: 'commit-body' }, [
          el('span', { class: 'commit-line' }, [
            objectId(commit.hash, 8),
            isHead && el('span', { class: 'head-tag' }, ['HEAD']),
          ]),
          el('span', { class: 'commit-msg' }, [commit.message]),
          historyWalked &&
            holdsSecret &&
            el('span', { class: 'commit-flag' }, [chip('alarm', 'contains the key')]),
        ]),
      ],
    )
    button.addEventListener('click', () => {
      store.update((s) => {
        s.selectedCommit = commit.hash
        s.selectedFile = null
      })
    })
    return el('li', {}, [button])
  })

  return el('ol', { class: 'commit-list', 'aria-label': 'Commits, newest first' }, items)
}

function fileView(store: Store): HTMLElement {
  const { repo, selectedCommit, selectedFile } = store.state
  const commit = selectedCommit ? repo.get(selectedCommit) : repo.head
  if (!commit) return el('p', {}, ['No commits yet.'])

  const paths = Object.keys(commit.snapshot).sort()
  const active = selectedFile && paths.includes(selectedFile) ? selectedFile : (paths[0] as string)

  const tabs = paths.map((path) => {
    const button = el(
      'button',
      {
        type: 'button',
        class: `file-tab${path === active ? ' is-active' : ''}`,
        'aria-pressed': path === active ? 'true' : 'false',
      },
      [path],
    )
    button.addEventListener('click', () => store.update((s) => (s.selectedFile = path)))
    return button
  })

  const content = commit.snapshot[active] ?? ''
  const lines = content.replace(/\n$/, '').split('\n')
  const gone = !paths.includes(CONFIG_PATH)

  return el('div', { class: 'file-view' }, [
    el('div', { class: 'meta-grid' }, [
      metaRow('commit', commit.hash),
      metaRow('tree', commit.tree),
      metaRow('parent', commit.parents[0] ?? '(root commit — no parent)'),
    ]),
    el('div', { class: 'file-tabs', role: 'group', 'aria-label': 'Files in this commit' }, tabs),
    scrollRegion(
      `Contents of ${active}`,
      'code-block',
      lines.map((line, i) =>
        el('div', { class: 'code-row' }, [
          el('span', { class: 'line-no', 'aria-hidden': 'true' }, [String(i + 1)]),
          codeLine(line, LEAKED_KEY),
        ]),
      ),
    ),
    gone &&
      el('p', { class: 'note note-warn' }, [
        'src/config.py is not in this commit at all — the tree simply omits the path.',
      ]),
  ])
}

function metaRow(label: string, value: string): HTMLElement {
  const isHash = /^[0-9a-f]{40,}$/.test(value)
  return el('div', { class: 'meta-row' }, [
    el('span', { class: 'meta-label' }, [label]),
    isHash ? objectId(value, 16) : el('span', { class: 'meta-value' }, [value]),
  ])
}

function actions(store: Store): HTMLElement {
  const step = nextStep(store.state)
  const children: Child[] = []

  if (step) {
    children.push(
      el('div', { class: 'next-step' }, [
        el('p', { class: 'next-expect' }, [
          el('strong', {}, ['What to expect: ']),
          step.expectation,
        ]),
      ]),
    )
    const button = el(
      'button',
      { type: 'button', class: `primary tone-${step.kind}`, id: 'advance-repo' },
      [step.action],
    )
    button.addEventListener('click', () => {
      void store.updateAsync(async (s) => {
        s.committed += 1
        s.repo = await buildRepo(s.algo, s.committed)
        s.selectedCommit = s.repo.head?.hash ?? null
        s.selectedFile = null
        // A new commit invalidates any earlier scan — force the learner to re-run it.
        s.headReport = null
        s.historyReport = null
        s.historyWalked = false
      })
    })
    children.push(button)
  } else {
    children.push(
      el('p', { class: 'note note-done' }, [
        'The story is complete: the key was committed, shipped past, redacted, and finally the whole file was deleted. HEAD is spotless.',
      ]),
    )
  }

  const reset = el('button', { type: 'button', class: 'ghost', id: 'reset-repo' }, [
    'Reset the repository',
  ])
  reset.addEventListener('click', () => {
    void store.updateAsync(async (s) => {
      s.committed = SCENARIO.filter((x) => x.kind === 'seed').length
      s.repo = await buildRepo(s.algo, s.committed)
      s.selectedCommit = s.repo.head?.hash ?? null
      s.selectedFile = null
      s.headReport = null
      s.historyReport = null
      s.historyWalked = false
      s.rotated = false
    })
  })
  children.push(reset)

  return el('div', { class: 'actions' }, children)
}

function algoToggle(store: Store): HTMLElement {
  const select = el('select', { id: 'algo-select', class: 'select' }, [
    el('option', { value: 'sha1', selected: store.state.algo === 'sha1' }, [
      'SHA-1 (git’s default object format)',
    ]),
    el('option', { value: 'sha256', selected: store.state.algo === 'sha256' }, [
      'SHA-256 (git’s newer object format)',
    ]),
  ])
  select.addEventListener('change', () => {
    const algo = select.value === 'sha256' ? 'sha256' : 'sha1'
    void store.updateAsync(async (s) => {
      s.algo = algo
      s.repo = await buildRepo(algo, s.committed)
      s.selectedCommit = s.repo.head?.hash ?? null
      s.headReport = null
      s.historyReport = null
      s.historyWalked = false
    })
  })

  return el('div', { class: 'field' }, [
    el('label', { for: 'algo-select' }, ['Object format']),
    select,
    el('p', { class: 'field-hint' }, [
      'Switching rewrites every id in the panel. The bytes being hashed are identical; only the digest changes — which is why a repository cannot mix the two.',
    ]),
  ])
}

export function renderRepoPanel(store: Store, root: HTMLElement): void {
  const { repo, committed } = store.state
  mount(root, [
    el('div', { class: 'panel-head' }, [
      el('h2', { id: 'repo-heading' }, ['1 · The repository']),
      el('p', { class: 'panel-lede' }, [
        'A small billing service. Advance it one commit at a time and watch the object ids — they are the real ones, computed here in your browser from git’s own byte formats.',
      ]),
    ]),
    el('div', { class: 'progress-line' }, [
      el('span', {}, [`Commit ${committed} of ${SCENARIO.length}`]),
      el('span', { class: 'progress-track', 'aria-hidden': 'true' }, [
        el('span', {
          class: 'progress-fill',
          style: `width:${(committed / SCENARIO.length) * 100}%`,
        }),
      ]),
      el('span', { class: 'muted' }, [`${repo.store.size} objects in the store`]),
    ]),
    el('div', { class: 'repo-grid' }, [
      el('div', { class: 'repo-col' }, [
        el('h3', {}, ['Commit graph']),
        scrollRegion('Commit graph', 'commit-scroll', [commitList(store)]),
      ]),
      el('div', { class: 'repo-col' }, [
        el('h3', {}, ['Working tree at the selected commit']),
        fileView(store),
      ]),
    ]),
    actions(store),
    algoToggle(store),
  ])
}
