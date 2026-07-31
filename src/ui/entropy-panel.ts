/**
 * Panel 3 — the entropy scanner, shown as arithmetic rather than asserted.
 *
 * Pick a string (or type your own) and the panel computes −Σ p·log₂p in front of
 * you, one character at a time. The chart below places that number next to labelled
 * reference strings, each judged against its own charset threshold.
 */

import { LEAKED_KEY } from '../git/scenario'
import { CHARSETS, MIN_CANDIDATE_LENGTH, frequencyBins, scoreString } from '../scan/entropy'
import { RULES, matchRules } from '../scan/rules'
import { SAMPLES } from '../scan/samples'
import { extractCandidates } from '../scan/scanner'
import { type EntropyRow, contributionTable, entropyTable } from './charts'
import type { Store } from './state'
import { type Child, chip, el, fmt, mount, tableScroll } from './dom'

function subjectOf(store: Store): string {
  return store.state.subject || LEAKED_KEY
}

function picker(store: Store): HTMLElement {
  const current = subjectOf(store)

  const buttons = SAMPLES.map((sample) => {
    const active = sample.value === current
    const button = el(
      'button',
      {
        type: 'button',
        class: `pill${active ? ' is-active' : ''}`,
        'aria-pressed': active ? 'true' : 'false',
      },
      [sample.label],
    )
    button.addEventListener('click', () => store.update((s) => (s.subject = sample.value)))
    return button
  })

  const input = el('input', {
    type: 'text',
    id: 'entropy-input',
    class: 'text-input',
    value: current,
    spellcheck: 'false',
    autocomplete: 'off',
  })
  input.addEventListener('input', () => store.update((s) => (s.subject = input.value)))

  return el('div', { class: 'picker' }, [
    el('div', { class: 'field' }, [
      el('label', { for: 'entropy-input' }, ['String to score']),
      input,
      el('p', { class: 'field-hint' }, [
        'Type anything — a password you have used, a UUID, a sentence. It is scored here in your browser and never leaves the page.',
      ]),
    ]),
    el('div', { class: 'field' }, [
      el('span', { class: 'field-label', id: 'sample-label' }, ['Or load a reference string']),
      el('div', { class: 'pill-row', role: 'group', 'aria-labelledby': 'sample-label' }, buttons),
    ]),
  ])
}

function verdictBlock(subject: string): HTMLElement {
  const verdict = scoreString(subject)
  const isCandidate = extractCandidates('input', subject).some((c) => c.value === subject)
  const ruleHits = matchRules(subject)

  const children: Child[] = [
    el('div', { class: 'verdict-row' }, [
      verdict.suspicious ? chip('alarm', 'over threshold') : chip('safe', 'under threshold'),
      isCandidate
        ? chip('warn', 'a scanner would score this')
        : chip('neutral', 'a scanner would never score this'),
      ruleHits.length > 0
        ? chip('alarm', `${ruleHits.length} format rule matched`)
        : chip('neutral', 'no format rule matched'),
    ]),
    el('dl', { class: 'finding-facts' }, [
      el('dt', {}, ['Entropy H']),
      el('dd', {}, [`${fmt(verdict.entropy, 3)} bits/char`]),
      el('dt', {}, ['Length']),
      el('dd', {}, [`${verdict.length} characters`]),
      el('dt', {}, ['Total']),
      el('dd', {}, [
        `${fmt(verdict.totalBits, 1)} bits `,
        el('span', { class: 'muted' }, ['(H × length — the figure that bounds guessing effort)']),
      ]),
      el('dt', {}, ['Charset']),
      el('dd', {}, [
        `${verdict.charset.label} — alphabet of ${verdict.charset.alphabetSize}, ceiling ${fmt(
          Math.log2(verdict.charset.alphabetSize),
        )} bits/char, threshold ${fmt(verdict.charset.threshold, 1)}`,
      ]),
      el('dt', {}, ['Share of the ceiling']),
      el('dd', {}, [`${fmt(verdict.ratioToMax * 100, 1)}%`]),
      el('dt', {}, ['Verdict']),
      el('dd', {}, [verdict.reason]),
    ]),
  ]

  if (!isCandidate && subject.length > 0) {
    children.push(
      el('p', { class: 'note note-info' }, [
        'This string never reaches the entropy function in a real scanner: it contains no unbroken run of at least ',
        String(MIN_CANDIDATE_LENGTH),
        ' characters over the credential alphabet. That is the filter doing the work, not the threshold.',
      ]),
    )
  }

  return el('div', { class: 'verdict-block' }, children)
}

function formulaBlock(subject: string): HTMLElement {
  const bins = frequencyBins(subject)
  const verdict = scoreString(subject)

  return el('div', { class: 'formula-block' }, [
    el('p', { class: 'formula' }, [
      el('span', { class: 'formula-math' }, ['H = −Σ p(x) · log₂ p(x)']),
    ]),
    el('p', { class: 'panel-lede' }, [
      'Count each character, turn the counts into probabilities, and add up −p·log₂p. That sum is the entropy. There is nothing else to it.',
    ]),
    bins.length === 0
      ? el('p', { class: 'note' }, ['Type something above to see the sum.'])
      : contributionTable(bins, verdict.entropy),
  ])
}

function chartBlock(store: Store, subject: string): HTMLElement {
  const rows: EntropyRow[] = []

  const push = (label: string, value: string, note: string, isSecret: boolean, fromRepo: boolean) => {
    if (value.length === 0) return
    const v = scoreString(value)
    rows.push({
      label,
      value,
      entropy: v.entropy,
      threshold: v.charset.threshold,
      charset: v.charset.label,
      length: v.length,
      isCandidate: extractCandidates('x', value).some((c) => c.value === value),
      flagged: v.suspicious,
      isSecret,
      note,
      fromRepo,
    })
  }

  // Whatever the learner is currently looking at, first.
  const known = SAMPLES.find((s) => s.value === subject)
  if (!known) push('Your string', subject, 'Typed into the box above.', false, false)
  for (const sample of SAMPLES) push(sample.label, sample.value, sample.note, sample.isSecret, false)

  // Anything the repository itself yielded.
  const report = store.state.historyReport
  if (report) {
    for (const s of report.scored) {
      if (rows.some((r) => r.value === s.value)) continue
      push(
        `${s.path}:${s.line}`,
        s.value,
        'A candidate the scanner pulled out of this repository.',
        true,
        true,
      )
    }
  }

  rows.sort((a, b) => b.entropy - a.entropy)

  return el('div', { class: 'chart-block' }, [
    el('h3', {}, ['Where the threshold actually sits']),
    el('p', { class: 'panel-lede' }, [
      'Every row scored by the same function, each against its own charset threshold — marked on its own bar, because a hex string can never exceed 4 bits/char and judging it against 4.5 would be meaningless.',
    ]),
    entropyTable(rows),
    el('div', { class: 'callout callout-warn' }, [
      el('h4', {}, ['Read the two bottom rows before you trust this chart']),
      el('p', {}, [
        'A git object id and a UUID both score at the top of the hex range and neither is a secret. An English sentence scores ',
        fmt(scoreString('Configuration lives in src/config.py; ask the payments team.').entropy),
        ' bits/char — within half a bit of the leaked API key — and is not flagged only because the tokenizer never hands it over. Entropy is a cheap prior, not a decision.',
      ]),
    ]),
  ])
}

function rulesBlock(): HTMLElement {
  return el('details', { class: 'disclose' }, [
    el('summary', {}, ['The format rules this scanner runs alongside entropy']),
    el('p', { class: 'panel-lede' }, [
      'Real scanners lead with patterns and fall back to entropy. Vendors now deliberately prefix their credentials so a pattern can catch them — the prefix is a safety feature.',
    ]),
    tableScroll('Format rules', el('table', { class: 'data-table rules-table' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { scope: 'col' }, ['Rule']),
          el('th', { scope: 'col' }, ['Why it works']),
          el('th', { scope: 'col' }, ['Modelled on']),
        ]),
      ]),
      el(
        'tbody',
        {},
        RULES.map((rule) =>
          el('tr', {}, [
            el('th', { scope: 'row' }, [rule.name]),
            el('td', {}, [rule.rationale]),
            el('td', {}, [el('span', { class: 'muted' }, [rule.source])]),
          ]),
        ),
      ),
    ])),
  ])
}

export function renderEntropyPanel(store: Store, root: HTMLElement): void {
  const subject = subjectOf(store)

  mount(root, [
    el('div', { class: 'panel-head' }, [
      el('h2', { id: 'entropy-heading' }, ['3 · Why the scanner found it']),
      el('p', { class: 'panel-lede' }, [
        'Shannon entropy measures how evenly a string spreads across its alphabet, in bits per character. High means "drawn from a wide alphabet without favouring anything" — which is what a generated credential looks like, and what a hand-written word does not.',
      ]),
    ]),
    picker(store),
    el('div', { class: 'entropy-grid' }, [
      el('div', {}, [formulaBlock(subject)]),
      el('div', {}, [verdictBlock(subject)]),
    ]),
    chartBlock(store, subject),
    rulesBlock(),
    el('details', { class: 'disclose' }, [
      el('summary', {}, ['Where the thresholds come from, and why they are arguable']),
      el('p', {}, [
        `TruffleHog's classic check scores runs over the base64 and hex alphabets and flags them past ${fmt(CHARSETS.base64.threshold, 1)} and ${fmt(CHARSETS.hex.threshold, 1)} bits/char respectively. Those two numbers are the ones used here. The alphanumeric and mixed thresholds are this demo's own interpolation from the same ratio-to-ceiling, and are a judgement call, not a standard.`,
      ]),
      el('p', {}, [
        'Every such threshold is a false-positive/false-negative trade. Lower it and you drown developers in UUID alerts until they stop reading them; raise it and you miss short keys. This is why the pattern rules exist, and why the industry moved toward vendor-issued prefixes.',
      ]),
      el('p', {}, [
        'One more limit worth naming: Shannon entropy is the wrong measure for guessability. ',
        el('code', {}, ['abcdefghijklmnopqrstuvwx']),
        ' scores the maximum for its length and is trivially guessable. Min-entropy is the measure that bounds an attacker, and no character-frequency count can see structure.',
      ]),
    ]),
  ])
}
