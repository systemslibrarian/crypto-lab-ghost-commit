/**
 * Shannon entropy, hand-rolled so every step is inspectable.
 *
 * This is the measurement behind the entropy checks in gitleaks and TruffleHog. It
 * is not cryptography and it is not magic: it is a count of how evenly a string's
 * characters are distributed, in bits per character.
 *
 *     H(X) = -Σ p(x) · log₂ p(x)
 *
 * English prose reuses `e`, `t`, space; its distribution is lopsided, so H is low
 * (~3–4 bits/char). A randomly generated credential draws near-uniformly from its
 * alphabet, so H climbs toward log₂(alphabet size) — the maximum possible value.
 *
 * The honest limitation, stated everywhere this is used: entropy measures *how a
 * string looks*, never *what it is*. A high score is a reason to look, not proof of
 * a secret; a low score is not proof of safety.
 */

/** One character's contribution to the sum — the rows of the demo's histogram. */
export interface FrequencyBin {
  readonly char: string
  readonly count: number
  /** count / length */
  readonly p: number
  /** −p·log₂ p, this character's share of the total in bits/char. */
  readonly contribution: number
}

/**
 * Shannon entropy in bits per character. Empty string is 0 bits by convention
 * (no symbols, no uncertainty).
 */
export function shannonEntropy(input: string): number {
  if (input.length === 0) return 0
  let total = 0
  for (const { contribution } of frequencyBins(input)) total += contribution
  return total
}

/** The per-character breakdown, ordered most frequent first. */
export function frequencyBins(input: string): FrequencyBin[] {
  const counts = new Map<string, number>()
  for (const char of input) counts.set(char, (counts.get(char) ?? 0) + 1)

  const length = [...input].length
  const bins: FrequencyBin[] = []
  for (const [char, count] of counts) {
    const p = count / length
    bins.push({ char, count, p, contribution: -p * Math.log2(p) })
  }
  bins.sort((a, b) => b.count - a.count || a.char.localeCompare(b.char))
  return bins
}

/**
 * Total entropy of the string in bits: H × length. This is the figure that matters
 * for guessability — `abc` at 1.58 bits/char is only 4.75 bits of material, while a
 * 32-character key at the same rate would be 50. Short strings cannot be secrets no
 * matter how random they look, which is why scanners gate on length as well as rate.
 */
export function totalBits(input: string): number {
  return shannonEntropy(input) * [...input].length
}

// ---------------------------------------------------------------------------
// Charsets and thresholds
// ---------------------------------------------------------------------------

export type Charset = 'hex' | 'base64' | 'alnum' | 'mixed'

export interface CharsetInfo {
  readonly id: Charset
  readonly label: string
  /** Size of the alphabet — the ceiling on entropy, log₂(size) bits/char. */
  readonly alphabetSize: number
  /**
   * Bits/char above which a string of this charset is treated as suspicious.
   * These are TruffleHog's classic defaults (3.0 for hex, 4.5 for base64); the
   * others are interpolated from the same ratio-to-maximum, and are stated as a
   * choice, not a law.
   */
  readonly threshold: number
}

export const CHARSETS: Readonly<Record<Charset, CharsetInfo>> = {
  hex: { id: 'hex', label: 'hex', alphabetSize: 16, threshold: 3.0 },
  base64: { id: 'base64', label: 'base64', alphabetSize: 64, threshold: 4.5 },
  alnum: { id: 'alnum', label: 'alphanumeric', alphabetSize: 62, threshold: 4.5 },
  mixed: { id: 'mixed', label: 'mixed / prose', alphabetSize: 95, threshold: 4.8 },
}

const HEX_RE = /^[0-9a-fA-F]+$/
const BASE64_RE = /^[A-Za-z0-9+/=_-]+$/
const ALNUM_RE = /^[A-Za-z0-9_-]+$/

/**
 * Which alphabet a candidate is drawn from. Order matters: hex is a subset of
 * alphanumeric, so it must be tested first — exactly the ordering the real
 * scanners use, and the reason a 64-char hex digest is judged against 3.0 and not
 * 4.5 (it can never exceed 4 bits/char).
 */
export function classifyCharset(input: string): CharsetInfo {
  if (input.length === 0) return CHARSETS.mixed
  if (HEX_RE.test(input)) return CHARSETS.hex
  if (ALNUM_RE.test(input)) return CHARSETS.alnum
  if (BASE64_RE.test(input)) return CHARSETS.base64
  return CHARSETS.mixed
}

export interface EntropyVerdict {
  readonly value: string
  readonly entropy: number
  readonly totalBits: number
  readonly length: number
  readonly charset: CharsetInfo
  /** entropy ÷ log₂(alphabet size): 1.0 means maximally random for this alphabet. */
  readonly ratioToMax: number
  /** Over the charset's threshold *and* long enough to hold a secret. */
  readonly suspicious: boolean
  readonly reason: string
}

/** Below this length a string is too short to be a credential, whatever it scores. */
export const MIN_CANDIDATE_LENGTH = 16

export function scoreString(input: string): EntropyVerdict {
  const charset = classifyCharset(input)
  const entropy = shannonEntropy(input)
  const length = [...input].length
  const max = Math.log2(charset.alphabetSize)
  const overThreshold = entropy >= charset.threshold
  const longEnough = length >= MIN_CANDIDATE_LENGTH
  const suspicious = overThreshold && longEnough

  let reason: string
  if (suspicious) {
    reason = `${entropy.toFixed(2)} bits/char over the ${charset.threshold.toFixed(1)} ${charset.label} threshold, across ${length} characters`
  } else if (overThreshold) {
    reason = `random-looking, but only ${length} characters — under the ${MIN_CANDIDATE_LENGTH}-character floor`
  } else {
    reason = `${entropy.toFixed(2)} bits/char is below the ${charset.threshold.toFixed(1)} ${charset.label} threshold`
  }

  return {
    value: input,
    entropy,
    totalBits: entropy * length,
    length,
    charset,
    ratioToMax: max === 0 ? 0 : entropy / max,
    suspicious,
    reason,
  }
}
