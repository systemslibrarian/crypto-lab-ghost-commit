/** Tiny DOM helpers. No framework — the point is that every element is inspectable. */

type Attrs = Record<string, string | number | boolean | undefined>
export type Child = Node | string | null | undefined | false

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  applyAttrs(node, attrs)
  append(node, children)
  return node
}

const SVG_NS = 'http://www.w3.org/2000/svg'

export function svgEl(tag: string, attrs: Attrs = {}, children: Child[] = []): SVGElement {
  const node = document.createElementNS(SVG_NS, tag)
  applyAttrs(node, attrs)
  append(node, children)
  return node
}

function applyAttrs(node: Element, attrs: Attrs): void {
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue
    if (key === 'class') node.setAttribute('class', String(value))
    else if (key === 'text') node.textContent = String(value)
    else node.setAttribute(key, String(value))
  }
}

function append(node: Element, children: Child[]): void {
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue
    node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child)
  }
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild)
}

export function mount(node: Element, children: Child[]): void {
  clear(node)
  append(node, children)
}

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id)
  if (!node) throw new Error(`missing #${id} — index.html and the UI code disagree`)
  return node as T
}

/** A monospace object id, abbreviated but with the full value available. */
export function objectId(hash: string, chars = 10): HTMLElement {
  return el('code', { class: 'oid', title: hash }, [hash.slice(0, chars)])
}

/** Status chip: icon + text + color, never color alone (WCAG 1.4.1). */
export type Tone = 'alarm' | 'safe' | 'warn' | 'neutral' | 'info'

// Glyphs, not letters: a lowercase "i" sitting immediately before lowercase label
// text reads as part of the word.
const TONE_ICON: Record<Tone, string> = {
  alarm: '✕',
  safe: '✓',
  warn: '!',
  neutral: '·',
  info: '○',
}

export function chip(tone: Tone, label: string): HTMLElement {
  return el('span', { class: `chip chip-${tone}` }, [
    el('span', { class: 'chip-icon', 'aria-hidden': 'true' }, [TONE_ICON[tone]]),
    el('span', {}, [label]),
  ])
}

/** A scrollable region needs a name and keyboard reach (WCAG 2.1.1 / 4.1.2). */
export function scrollRegion(label: string, className: string, children: Child[]): HTMLElement {
  return el('div', { class: className, tabindex: '0', role: 'group', 'aria-label': label }, children)
}

/**
 * Wrap a wide table so *it* scrolls sideways instead of the page body. Without
 * this a four-column table sets the document's scroll width on a phone, and the
 * whole page pans — the layout bug that hides behind a desktop-only check.
 */
export function tableScroll(label: string, table: HTMLElement): HTMLElement {
  return scrollRegion(label, 'table-x', [table])
}

export function fmt(value: number, digits = 2): string {
  return value.toFixed(digits)
}

/** Render a source line, wrapping `highlight` so the eye lands on it. */
export function codeLine(source: string, highlight?: string): HTMLElement {
  const line = el('code', { class: 'code-line' })
  if (!highlight || !source.includes(highlight)) {
    line.textContent = source
    return line
  }
  const at = source.indexOf(highlight)
  line.appendChild(document.createTextNode(source.slice(0, at)))
  line.appendChild(el('mark', { class: 'secret-mark' }, [highlight]))
  line.appendChild(document.createTextNode(source.slice(at + highlight.length)))
  return line
}
