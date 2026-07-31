/**
 * The scanner: walk every object in the store, extract candidate strings, and judge
 * each one by entropy and by rule. This is the two-signal design gitleaks and
 * TruffleHog use, at a scale you can read in one sitting.
 *
 * A correction worth internalising, because it is the most misunderstood thing about
 * entropy scanning: the threshold is *not* what separates secrets from prose. Measure
 * an ordinary English sentence and you get ~4.3 bits/char — barely under a 32-character
 * API key's ~4.75. What actually separates them is the tokenizer. A scanner never
 * hands a sentence to the entropy function; it only ever scores an unbroken run over a
 * credential alphabet, and English prose does not contain one. `entropy.test.ts` pins
 * that fact down rather than pretending otherwise.
 *
 * The other thing worth watching: `scanHistory` and `scanHead` differ only in which
 * commits they are handed. Everything else — extraction, scoring, reporting — is
 * identical. The gap between their results is the entire lesson of this demo.
 */

import { hashBlob } from '../git/objects'
import type { Commit, Repo } from '../git/repo'
import { type EntropyVerdict, MIN_CANDIDATE_LENGTH, scoreString } from './entropy'
import { type Rule, matchRules } from './rules'

/**
 * The credential alphabet: what a base64, base64url, hex, or vendor-prefixed key is
 * built from. A candidate is a *maximal unbroken run* over this set — TruffleHog's
 * `get_strings_of_set`, near enough. Whitespace, quotes, and punctuation outside the
 * set all terminate a run, which is exactly why a sentence is never a candidate.
 */
const CANDIDATE_RE = new RegExp(`[A-Za-z0-9+/=_-]{${MIN_CANDIDATE_LENGTH},}`, 'g')

export interface Candidate {
  readonly value: string
  readonly path: string
  /** 1-based line number within the file. */
  readonly line: number
  /** The full source line, for display and for rule matching. */
  readonly source: string
}

/**
 * Pull scannable tokens out of a file. Note what this does *not* return: prose,
 * comments, and identifiers shorter than the floor never reach the entropy function
 * at all.
 */
export function extractCandidates(path: string, content: string): Candidate[] {
  const out: Candidate[] = []
  content.split('\n').forEach((source, i) => {
    for (const m of source.matchAll(CANDIDATE_RE)) {
      out.push({ value: m[0], path, line: i + 1, source })
    }
  })
  return out
}

export type Signal = 'entropy' | 'rule'

export interface Finding {
  /** The suspicious string itself. */
  readonly value: string
  readonly path: string
  readonly line: number
  readonly source: string
  /** Present when entropy scored this token; absent for rule-only hits like a PEM header. */
  readonly verdict: EntropyVerdict | undefined
  /** Format rules that matched on this line and cover this value. */
  readonly rules: readonly Rule[]
  readonly signals: readonly Signal[]
  /** Real object id of the blob holding it — the thing that never goes away. */
  readonly blob: string
  /** Every commit whose tree still reaches that blob at that path. */
  readonly commits: readonly Commit[]
  /** True if the value is still in the newest commit scanned. */
  readonly atHead: boolean
}

export interface ScoredCandidate extends EntropyVerdict {
  readonly path: string
  readonly line: number
}

export interface ScanReport {
  readonly findings: readonly Finding[]
  /** Every candidate scored, including the clean ones — the histogram's data. */
  readonly scored: readonly ScoredCandidate[]
  readonly commitsScanned: number
  readonly blobsScanned: number
  readonly candidatesScored: number
  /** Lines examined across all scanned blobs — the denominator behind the yield. */
  readonly linesScanned: number
}

interface Draft {
  value: string
  candidate: Candidate
  verdict: EntropyVerdict | undefined
  rules: Rule[]
  blob: string
  commits: Commit[]
  atHead: boolean
}

interface ScanOptions {
  /** Which commits to look at. Everything else about the scan is identical. */
  readonly commits: readonly Commit[]
  readonly headHash: string | undefined
}

async function scan(repo: Repo, { commits, headHash }: ScanOptions): Promise<ScanReport> {
  const drafts = new Map<string, Draft>()
  const scored: ScoredCandidate[] = []
  const blobs = new Set<string>()
  let linesScanned = 0

  const record = (
    key: string,
    make: () => Omit<Draft, 'commits' | 'atHead'>,
    commit: Commit,
  ): void => {
    const existing = drafts.get(key)
    if (existing) {
      existing.commits.push(commit)
      existing.atHead ||= commit.hash === headHash
      return
    }
    drafts.set(key, { ...make(), commits: [commit], atHead: commit.hash === headHash })
  }

  for (const commit of commits) {
    for (const [path, content] of Object.entries(commit.snapshot)) {
      const blob = await hashBlob(content, repo.algo)
      // Score each distinct blob once, so a file that merely survived several
      // commits untouched does not stack the histogram.
      const firstSightOfBlob = !blobs.has(blob)
      blobs.add(blob)
      if (firstSightOfBlob) linesScanned += content.split('\n').length

      const candidates = extractCandidates(path, content)
      for (const candidate of candidates) {
        const verdict = scoreString(candidate.value)
        if (firstSightOfBlob) scored.push({ ...verdict, path, line: candidate.line })

        const rules = matchRules(candidate.source)
          .filter((m) => m.match.includes(candidate.value))
          .map((m) => m.rule)
        if (!verdict.suspicious && rules.length === 0) continue

        record(
          `${path}:${candidate.value}`,
          () => ({ value: candidate.value, candidate, verdict, rules, blob }),
          commit,
        )
      }

      // A rule can match something the tokenizer never produces — a PEM armour
      // header, say. Report those too rather than letting the tokenizer's floor
      // silently drop a certain hit.
      content.split('\n').forEach((source, i) => {
        for (const m of matchRules(source)) {
          if (candidates.some((c) => c.line === i + 1 && m.match.includes(c.value))) continue
          record(
            `${path}:rule:${m.rule.id}:${m.match}`,
            () => ({
              value: m.match,
              candidate: { value: m.match, path, line: i + 1, source },
              verdict: undefined,
              rules: [m.rule],
              blob,
            }),
            commit,
          )
        }
      })
    }
  }

  const findings: Finding[] = [...drafts.values()].map((d) => {
    const signals: Signal[] = []
    if (d.verdict?.suspicious) signals.push('entropy')
    if (d.rules.length > 0) signals.push('rule')
    return {
      value: d.value,
      path: d.candidate.path,
      line: d.candidate.line,
      source: d.candidate.source,
      verdict: d.verdict,
      rules: d.rules,
      signals,
      blob: d.blob,
      commits: d.commits,
      atHead: d.atHead,
    }
  })
  // Worst first: hits confirmed by both signals, then by total entropy.
  findings.sort(
    (a, b) =>
      b.signals.length - a.signals.length ||
      (b.verdict?.totalBits ?? 0) - (a.verdict?.totalBits ?? 0),
  )

  return {
    findings,
    scored,
    commitsScanned: commits.length,
    blobsScanned: blobs.size,
    candidatesScored: scored.length,
    linesScanned,
  }
}

/** Scan only the newest commit — what a scanner sees looking at a checkout. */
export async function scanHead(repo: Repo): Promise<ScanReport> {
  const head = repo.head
  return scan(repo, { commits: head ? [head] : [], headHash: head?.hash })
}

/** Scan every commit reachable from HEAD — what a scanner sees looking at the repo. */
export async function scanHistory(repo: Repo): Promise<ScanReport> {
  return scan(repo, { commits: repo.walkHistory(), headHash: repo.head?.hash })
}
