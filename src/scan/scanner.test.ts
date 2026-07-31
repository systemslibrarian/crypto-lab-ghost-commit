import { describe, expect, it } from 'vitest'

import { hashBlob } from '../git/objects'
import { Repo } from '../git/repo'
import { CONFIG_PATH, LEAKED_KEY, SCENARIO, identityFor } from '../git/scenario'
import { scoreString } from './entropy'
import { matchRules } from './rules'
import { extractCandidates, scanHead, scanHistory } from './scanner'

async function buildRepo(steps = SCENARIO.length): Promise<Repo> {
  const repo = new Repo('sha1')
  for (const [index, step] of SCENARIO.slice(0, steps).entries()) {
    await repo.commit({ message: step.message, snapshot: step.snapshot, author: identityFor(index) })
  }
  return repo
}

describe('candidate extraction — the tokenizer does most of the work', () => {
  it('pulls the key out of a quoted assignment', () => {
    const found = extractCandidates('a.py', `KEY = "${LEAKED_KEY}"\n`)
    expect(found.map((c) => c.value)).toContain(LEAKED_KEY)
    expect(found[0]!.line).toBe(1)
  })

  it('catches an unquoted run — a key pasted into YAML or a comment still gets found', () => {
    const found = extractCandidates('notes.md', `# leftover: ${LEAKED_KEY}\n`)
    expect(found.map((c) => c.value)).toContain(LEAKED_KEY)
  })

  it('never produces a candidate from English prose, whatever it would score', () => {
    const prose = 'Configuration lives in src/config.py; ask the payments team before changing it.'
    expect(extractCandidates('README.md', prose)).toEqual([])
    // ...and that is the only reason it is not flagged: on rate alone it is close.
    expect(scoreString(prose).entropy).toBeGreaterThan(4)
  })

  it('ignores strings too short to be a credential', () => {
    expect(extractCandidates('a.py', 'x = "short"\n')).toEqual([])
    expect(extractCandidates('a.py', 'ACMEPAY_API_KEY = 30\n')).toEqual([])
  })

  it('reports the real line number for a later line', () => {
    const found = extractCandidates('a.py', `import os\n\nKEY = "${LEAKED_KEY}"\n`)
    expect(found[0]!.line).toBe(3)
  })
})

describe('pattern rules', () => {
  it('matches the demo vendor prefix on the leaked key', () => {
    expect(matchRules(`k = "${LEAKED_KEY}"`).map((m) => m.rule.id)).toContain('acmepay-secret-key')
  })

  it('still carries a working rule for the real Stripe format', () => {
    // Built from parts so this file does not itself ship a string shaped like a
    // live vendor credential — the rule is what is under test, not the literal.
    const stripeShaped = ['sk', 'test', 'BQokikJOvBiI2HlWgH4olfQ2'].join('_')
    expect(matchRules(`k = "${stripeShaped}"`).map((m) => m.rule.id)).toContain(
      'stripe-secret-key',
    )
  })

  it('matches the generic hardcoded-assignment shape the Semgrep rule encodes', () => {
    const ids = matchRules('ACMEPAY_API_KEY = "some-very-long-literal-value"').map((m) => m.rule.id)
    expect(ids).toContain('hardcoded-secret-assignment')
  })

  it('does not fire on a variable read from the environment', () => {
    expect(matchRules('ACMEPAY_API_KEY = os.environ["ACMEPAY_API_KEY"]')).toEqual([])
  })

  it('does not carry lastIndex between calls (a real bug in shared /g regexes)', () => {
    const line = `k = "${LEAKED_KEY}"`
    expect(matchRules(line).length).toBe(matchRules(line).length)
    expect(matchRules(line).length).toBeGreaterThan(0)
  })

  it('matches AWS and GitHub formats', () => {
    expect(matchRules('AKIAIOSFODNN7EXAMPLE').map((m) => m.rule.id)).toContain('aws-access-key-id')
    expect(matchRules(`ghp_${'a'.repeat(36)}`).map((m) => m.rule.id)).toContain('github-pat')
  })
})

describe('scanning HEAD versus scanning history', () => {
  it('finds the key at HEAD while it is still committed', async () => {
    const repo = await buildRepo(4) // through "Add refund endpoint"
    const report = await scanHead(repo)
    expect(report.findings.some((f) => f.value === LEAKED_KEY)).toBe(true)
  })

  it('reports HEAD clean once the literal is replaced with os.environ', async () => {
    const repo = await buildRepo(5)
    const report = await scanHead(repo)
    expect(report.findings.some((f) => f.value === LEAKED_KEY)).toBe(false)
  })

  it('reports HEAD clean once the file is deleted outright', async () => {
    const repo = await buildRepo()
    const report = await scanHead(repo)
    expect(report.findings.some((f) => f.value === LEAKED_KEY)).toBe(false)
  })

  it('still finds the key in history after both the redaction and the delete', async () => {
    const repo = await buildRepo()
    const report = await scanHistory(repo)
    const hit = report.findings.find((f) => f.value === LEAKED_KEY)
    expect(hit).toBeDefined()
    expect(hit!.atHead).toBe(false)
    expect(hit!.path).toBe(CONFIG_PATH)
  })

  it('names the real blob and the real commits that still reach it', async () => {
    const repo = await buildRepo()
    const report = await scanHistory(repo)
    const hit = report.findings.find((f) => f.value === LEAKED_KEY)!

    expect(hit.blob).toBe(await hashBlob(SCENARIO[2]!.snapshot[CONFIG_PATH]!, 'sha1'))
    expect(repo.store.get(hit.blob)!.text).toContain(LEAKED_KEY)
    expect(hit.commits.map((c) => c.message)).toEqual([
      'Add refund endpoint',
      'Wire up AcmePay billing',
    ])
  })

  it('attributes the finding to both entropy and a format rule', async () => {
    const repo = await buildRepo()
    const hit = (await scanHistory(repo)).findings.find((f) => f.value === LEAKED_KEY)!
    expect(hit.verdict!.suspicious).toBe(true)
    expect(hit.rules.map((r) => r.id)).toContain('acmepay-secret-key')
    expect(hit.signals).toEqual(['entropy', 'rule'])
  })

  it('reports a rule-only hit the tokenizer would have missed', async () => {
    const repo = new Repo('sha1')
    await repo.commit({
      message: 'oops',
      snapshot: { 'id_rsa': '-----BEGIN OPENSSH PRIVATE KEY-----\n' },
      author: identityFor(0),
    })
    const hit = (await scanHistory(repo)).findings[0]!
    expect(hit.signals).toEqual(['rule'])
    expect(hit.verdict).toBeUndefined()
    expect(hit.rules[0]!.id).toBe('private-key-block')
  })

  it('scans strictly more commits in history mode, with identical logic', async () => {
    const repo = await buildRepo()
    const head = await scanHead(repo)
    const history = await scanHistory(repo)
    expect(head.commitsScanned).toBe(1)
    expect(history.commitsScanned).toBe(SCENARIO.length)
    expect(history.blobsScanned).toBeGreaterThan(head.blobsScanned)
  })

  it('does not flag the prose in README.md', async () => {
    const repo = await buildRepo()
    const report = await scanHistory(repo)
    expect(report.findings.some((f) => f.path === 'README.md')).toBe(false)
  })

  it('produces exactly one candidate across the whole repository — and it is the key', async () => {
    // Worth sitting with: six commits, five files, ~40 lines, and the tokenizer
    // hands the entropy function a single token. Precision here comes from what is
    // never scored, which is why the chart needs the labelled reference samples in
    // samples.ts to show where the threshold actually sits.
    const report = await scanHistory(await buildRepo())
    expect(report.linesScanned).toBeGreaterThan(30)
    expect(report.scored.map((s) => s.value)).toEqual([LEAKED_KEY])
    expect(report.findings.length).toBe(1)
  })

  it('does not fire on the environment-variable fix that replaced the literal', async () => {
    const repo = await buildRepo(5)
    const report = await scanHead(repo)
    expect(report.findings).toEqual([])
    expect(repo.head!.snapshot[CONFIG_PATH]).toContain('os.environ')
  })
})
