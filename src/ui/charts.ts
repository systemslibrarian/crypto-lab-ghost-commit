/**
 * Charts, built as real HTML tables with proportional bars in one cell.
 *
 * The bar is the visual; the table is the structure. That means the "view as a
 * table" affordance is not a separate mode to maintain — a screen reader gets rows
 * and headers from the same markup a sighted reader sees as a chart, and the
 * numbers are always present rather than hidden behind a hover tooltip.
 *
 * Form: single-hue magnitude bars (per the sequential rule — these compare one
 * quantity, they do not distinguish series). The entropy chart adds an emphasis
 * treatment: flagged rows in the alarm hue, everything else recessive gray, with
 * an icon and a text verdict so the state never rests on color alone.
 */

import type { FrequencyBin } from '../scan/entropy'
import { type Child, chip, el, fmt, scrollRegion, tableScroll } from './dom'

/** Whitespace has to be visible to be counted. */
export function displayChar(char: string): { glyph: string; name: string } {
  if (char === ' ') return { glyph: '␣', name: 'space' }
  if (char === '\n') return { glyph: '↵', name: 'newline' }
  if (char === '\t') return { glyph: '⇥', name: 'tab' }
  return { glyph: char, name: `“${char}”` }
}

function bar(fraction: number, tone: 'accent' | 'alarm' | 'muted', markerAt?: number): HTMLElement {
  const width = `${Math.max(0, Math.min(1, fraction)) * 100}%`
  const children: Child[] = [el('span', { class: `bar-fill bar-${tone}`, style: `width:${width}` })]
  if (markerAt !== undefined) {
    children.push(
      el('span', {
        class: 'bar-threshold',
        style: `left:${Math.max(0, Math.min(1, markerAt)) * 100}%`,
        'aria-hidden': 'true',
      }),
    )
  }
  return el('span', { class: 'bar-track', 'aria-hidden': 'true' }, children)
}

/**
 * The entropy formula, shown as a sum rather than asserted as a number.
 * Each row is one character's −p·log₂p; the footer is their total, which *is* H.
 */
export function contributionTable(bins: readonly FrequencyBin[], total: number): HTMLElement {
  const max = bins.reduce((m, b) => Math.max(m, b.contribution), 0) || 1

  const rows = bins.map((bin, i) => {
    const { glyph, name } = displayChar(bin.char)
    return el('tr', { class: 'contrib-row', style: `--row-index:${i}` }, [
      el('th', { scope: 'row' }, [
        el('code', { class: 'char-cell' }, [glyph]),
        el('span', { class: 'visually-hidden' }, [name]),
      ]),
      el('td', { class: 'num' }, [String(bin.count)]),
      el('td', { class: 'num' }, [fmt(bin.p, 4)]),
      el('td', { class: 'bar-cell' }, [
        bar(bin.contribution / max, 'accent'),
        el('span', { class: 'bar-value' }, [fmt(bin.contribution, 4)]),
      ]),
    ])
  })

  const table = el('table', { class: 'data-table contrib-table' }, [
    el('caption', {}, [
      'Per-character contribution to Shannon entropy. Each row is −p·log₂p; the total is H.',
    ]),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['Char']),
        el('th', { scope: 'col', class: 'num' }, ['Count']),
        el('th', { scope: 'col', class: 'num' }, ['p']),
        el('th', { scope: 'col' }, ['−p·log₂p (bits)']),
      ]),
    ]),
    el('tbody', {}, rows),
    el('tfoot', {}, [
      el('tr', {}, [
        el('th', { scope: 'row', colspan: '3' }, ['Total H']),
        el('td', { class: 'total-cell' }, [`${fmt(total, 4)} bits/char`]),
      ]),
    ]),
  ])

  // A long string produces a long table. Cap it and let the header and the total
  // stick, so the sum being accumulated stays on screen while the rows scroll.
  return scrollRegion('Per-character entropy contributions', 'contrib-scroll', [table])
}

export interface EntropyRow {
  readonly label: string
  readonly value: string
  readonly entropy: number
  readonly threshold: number
  readonly charset: string
  readonly length: number
  /** Would a scanner even hand this to the entropy function? */
  readonly isCandidate: boolean
  readonly flagged: boolean
  /** The ground truth, which the detector does not have access to. */
  readonly isSecret: boolean
  readonly note: string
  readonly fromRepo: boolean
}

/** Where the x-axis ends. Fixed so rows stay comparable as the set changes. */
const SCALE_MAX = 6

/**
 * Entropy per candidate, with each row's own threshold marked on its own bar.
 *
 * Drawing one shared threshold line would be a lie: the hex threshold (3.0) and the
 * base64 threshold (4.5) are different numbers, and a hex string cannot exceed 4
 * bits/char at all. Per-row markers keep the picture honest.
 */
export function entropyTable(rows: readonly EntropyRow[]): HTMLElement {
  const body = rows.map((row) => {
    const tone = row.flagged ? 'alarm' : 'muted'
    const verdict = !row.isCandidate
      ? chip('neutral', 'not a candidate')
      : row.flagged
        ? chip('alarm', 'flagged')
        : chip('safe', 'under threshold')
    const truth = row.isSecret
      ? chip('warn', 'yes — a credential')
      : chip('info', 'no — harmless')

    return el('tr', { class: row.fromRepo ? 'is-repo-row' : '' }, [
      el('th', { scope: 'row' }, [
        el('span', { class: 'row-label' }, [row.label]),
        row.fromRepo && el('span', { class: 'row-tag' }, ['from this repo']),
        el('span', { class: 'row-note' }, [row.note]),
      ]),
      el('td', { class: 'bar-cell wide' }, [
        bar(row.entropy / SCALE_MAX, tone, row.threshold / SCALE_MAX),
        el('span', { class: 'bar-value' }, [`${fmt(row.entropy)} bits/char`]),
        el('span', { class: 'bar-sub' }, [
          `${row.length} chars · ${row.charset} · threshold ${fmt(row.threshold, 1)}`,
        ]),
      ]),
      el('td', {}, [verdict]),
      el('td', {}, [truth]),
    ])
  })

  const table = el('table', { class: 'data-table entropy-table' }, [
    el('caption', {}, [
      `Shannon entropy per candidate, against each one's own charset threshold (marked on its bar). Scale 0–${SCALE_MAX} bits/char.`,
    ]),
    el('thead', {}, [
      el('tr', {}, [
        el('th', { scope: 'col' }, ['String']),
        el('th', { scope: 'col' }, ['Entropy']),
        // "Entropy says", not "the detector says" — the format rules are a separate
        // signal and are not represented in this table.
        el('th', { scope: 'col' }, ['Entropy says']),
        el('th', { scope: 'col' }, ['Actually a secret?']),
      ]),
    ]),
    el('tbody', {}, body),
  ])
  return tableScroll('Entropy per candidate string', table)
}
