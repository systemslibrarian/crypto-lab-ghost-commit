import { describe, expect, it } from 'vitest'

import { LEAKED_KEY } from '../git/scenario'
import {
  CHARSETS,
  classifyCharset,
  frequencyBins,
  shannonEntropy,
  scoreString,
  totalBits,
} from './entropy'

describe('Shannon entropy — values you can check by hand', () => {
  it('is 0 bits for a string with no uncertainty', () => {
    expect(shannonEntropy('aaaaaaaa')).toBe(0)
    expect(shannonEntropy('')).toBe(0)
  })

  it('is exactly 1 bit for two equally likely symbols', () => {
    expect(shannonEntropy('ab')).toBeCloseTo(1, 12)
    expect(shannonEntropy('abab')).toBeCloseTo(1, 12)
    expect(shannonEntropy('aabb')).toBeCloseTo(1, 12)
  })

  it('is log2(n) for n distinct, equally frequent symbols', () => {
    expect(shannonEntropy('abcd')).toBeCloseTo(2, 12)
    expect(shannonEntropy('0123456789abcdef')).toBeCloseTo(4, 12)
    expect(shannonEntropy('abcdefgh')).toBeCloseTo(3, 12)
  })

  it('matches the textbook worked example for a skewed distribution', () => {
    // "aab": p(a)=2/3, p(b)=1/3 → -(2/3)log2(2/3) - (1/3)log2(1/3) = 0.9182958...
    expect(shannonEntropy('aab')).toBeCloseTo(0.9182958340544896, 12)
  })

  it('never exceeds log2(distinct symbols)', () => {
    for (const s of ['hello world', LEAKED_KEY, 'AAAAB3NzaC1yc2E', 'the quick brown fox']) {
      const distinct = new Set([...s]).size
      expect(shannonEntropy(s)).toBeLessThanOrEqual(Math.log2(distinct) + 1e-12)
    }
  })

  it('is order-independent — entropy sees the distribution, not the arrangement', () => {
    expect(shannonEntropy('secret123')).toBeCloseTo(shannonEntropy('321terces'), 12)
  })

  it('decomposes into per-character contributions that sum to the total', () => {
    const bins = frequencyBins('hello world')
    const sum = bins.reduce((acc, b) => acc + b.contribution, 0)
    expect(sum).toBeCloseTo(shannonEntropy('hello world'), 12)
    expect(bins.reduce((acc, b) => acc + b.p, 0)).toBeCloseTo(1, 12)
    expect(bins[0]!.char).toBe('l') // three of them
    expect(bins[0]!.count).toBe(3)
  })

  it('reports total bits as rate × length', () => {
    expect(totalBits('abcd')).toBeCloseTo(8, 12)
  })
})

describe('charset classification', () => {
  it('tests hex before alphanumeric, so digests are judged against the hex ceiling', () => {
    expect(classifyCharset('deadbeefcafe1234').id).toBe('hex')
    expect(classifyCharset('deadbeefcafeXYZ1').id).toBe('alnum')
  })

  it('treats +/= strings as base64', () => {
    expect(classifyCharset('aGVsbG8gd29ybGQ=+/').id).toBe('base64')
  })

  it('falls back to mixed for prose containing spaces and punctuation', () => {
    expect(classifyCharset('the quick brown fox.').id).toBe('mixed')
  })

  it('caps hex entropy below the base64 threshold — why one threshold cannot serve both', () => {
    const hexMax = Math.log2(CHARSETS.hex.alphabetSize)
    expect(hexMax).toBeLessThan(CHARSETS.base64.threshold)
    expect(CHARSETS.hex.threshold).toBeLessThan(hexMax)
  })
})

describe('scoring a candidate', () => {
  it('flags the leaked vendor key', () => {
    const v = scoreString(LEAKED_KEY)
    expect(v.suspicious).toBe(true)
    expect(v.entropy).toBeGreaterThan(4)
    expect(v.charset.id).toBe('alnum')
    expect(v.reason).toMatch(/over the/)
  })

  it('does not flag ordinary English prose', () => {
    const v = scoreString('Internal billing service for the storefront.')
    expect(v.suspicious).toBe(false)
    expect(v.entropy).toBeLessThan(CHARSETS.mixed.threshold)
  })

  /**
   * The claim entropy scanning is usually sold with — "secrets score ~4.8, prose
   * scores ~2.5" — is false at the character level. The ~1–2 bits/char figure for
   * English is Shannon's *rate* for long text with word and context structure; the
   * empirical per-character entropy of one short sentence is much higher, because a
   * 60-character sentence uses ~25 distinct characters fairly evenly.
   *
   * These two tests pin the real numbers down so the demo cannot drift into the
   * comfortable version of the story.
   */
  it('scores an English sentence far higher than folklore claims — within 0.5 bits of the key', () => {
    const key = scoreString(LEAKED_KEY).entropy
    const prose = scoreString('Configuration lives in src/config.py; ask the payments team.').entropy
    expect(prose).toBeGreaterThan(4) // not the ~2.5 the folklore promises
    expect(key - prose).toBeLessThan(0.5) // and the gap is genuinely narrow
  })

  it('separates them by total bits even less — the sentence carries more', () => {
    // Which is why no scanner scores whole sentences. See scanner.test.ts: the
    // tokenizer, not the threshold, is what keeps prose out of the results.
    const key = scoreString(LEAKED_KEY)
    const prose = scoreString('Configuration lives in src/config.py; ask the payments team.')
    expect(prose.totalBits).toBeGreaterThan(key.totalBits)
    expect(key.suspicious).toBe(true)
    expect(prose.suspicious).toBe(false) // only because "mixed" carries a higher threshold
  })

  it('refuses to flag a short random-looking string — length is part of the test', () => {
    // 12 uniform hex chars: 3.58 bits/char, over the 3.0 hex threshold, still rejected.
    const v = scoreString('0123456789ab')
    expect(v.entropy).toBeGreaterThan(CHARSETS.hex.threshold)
    expect(v.suspicious).toBe(false)
    expect(v.reason).toMatch(/under the 16-character floor/)
  })

  it('flags a long uniform hex digest against the hex threshold', () => {
    const v = scoreString('9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08')
    expect(v.charset.id).toBe('hex')
    expect(v.suspicious).toBe(true)
  })

  it('reports a false positive honestly rather than hiding it — a UUID trips the check', () => {
    // This is the scanner's real-world failure mode, not a bug in this demo.
    const v = scoreString('f47ac10b58cc4372a5670e02b2c3d479')
    expect(v.charset.id).toBe('hex')
    expect(v.suspicious).toBe(true)
  })

  it('reports ratio-to-maximum for the charset', () => {
    const v = scoreString('0123456789abcdef0123456789abcdef')
    expect(v.ratioToMax).toBeCloseTo(1, 6)
  })
})
