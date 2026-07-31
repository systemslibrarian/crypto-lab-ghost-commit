import './style.css'

import { byId } from './ui/dom'
import { renderEntropyPanel } from './ui/entropy-panel'
import { renderFixPanel } from './ui/fix-panel'
import { renderRepoPanel } from './ui/repo-panel'
import { renderScanPanel } from './ui/scan-panel'
import { Store, initialState } from './ui/state'

/**
 * Panels re-render wholesale on every state change — the app is small enough that
 * diffing would be more code than it saves. The one cost is that a focused control
 * is replaced mid-interaction, so focus and caret position are captured and
 * restored around the render; without this, typing in the entropy box would drop a
 * character every keystroke.
 */
function preservingFocus(render: () => void): void {
  const active = document.activeElement
  const id = active instanceof HTMLElement ? active.id : ''
  const caret =
    active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement
      ? { start: active.selectionStart, end: active.selectionEnd }
      : null

  render()

  if (!id) return
  const restored = document.getElementById(id)
  if (!(restored instanceof HTMLElement)) return
  restored.focus()
  if (caret && (restored instanceof HTMLInputElement || restored instanceof HTMLTextAreaElement)) {
    try {
      restored.setSelectionRange(caret.start, caret.end)
    } catch {
      // Some input types disallow selection ranges; focus alone is enough.
    }
  }
}

async function boot(): Promise<void> {
  const store = new Store(await initialState('sha1'))

  const repoRoot = byId('panel-repo')
  const scanRoot = byId('panel-scan')
  const entropyRoot = byId('panel-entropy')
  const fixRoot = byId('panel-fix')

  const render = (): void => {
    renderRepoPanel(store, repoRoot)
    renderScanPanel(store, scanRoot)
    renderEntropyPanel(store, entropyRoot)
    renderFixPanel(store, fixRoot)
  }

  store.subscribe(() => preservingFocus(render))
  render()
  document.documentElement.setAttribute('data-app-ready', 'true')
}

void boot().catch((err: unknown) => {
  const app = document.getElementById('app')
  if (app) {
    const p = document.createElement('p')
    p.className = 'note note-warn'
    p.setAttribute('role', 'alert')
    p.textContent = `Failed to start: ${String(err)}`
    app.prepend(p)
  }
  throw err
})
