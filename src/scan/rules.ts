/**
 * Pattern rules — the other half of how a real secret scanner works.
 *
 * Entropy asks "does this look random?"; rules ask "does this look like a *known*
 * credential format?". Production scanners run both, because each covers the
 * other's blind spot: a rule cannot catch a credential format it has never seen,
 * and entropy cannot tell a UUID from an API key.
 *
 * The patterns below are simplified restatements of published detections — the
 * prefixes are the vendors' own documented formats. They are here to be read, not
 * to be comprehensive: gitleaks ships hundreds.
 */

export interface Rule {
  readonly id: string
  readonly name: string
  /** Why this pattern implies a credential. */
  readonly rationale: string
  /** Where the real-world version of this rule lives. */
  readonly source: string
  readonly regex: RegExp
}

export const RULES: readonly Rule[] = [
  {
    id: 'acmepay-secret-key',
    name: 'AcmePay secret key',
    rationale:
      'The demo repository leaks an AcmePay key. AcmePay is invented, but the rule is shaped exactly like the Stripe rule below — a fixed vendor prefix followed by a random body, which is the highest-confidence match a scanner can make.',
    source: 'this demo — the same shape as gitleaks\' stripe-access-token',
    regex: /\bacmepay_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  {
    id: 'stripe-secret-key',
    name: 'Stripe secret key',
    rationale:
      'Stripe issues secret keys with a fixed sk_live_ / sk_test_ prefix, so the prefix alone is a high-confidence match. Carried here as the real-world original the demo rule is modelled on.',
    source: 'gitleaks rule "stripe-access-token"',
    regex: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/g,
  },
  {
    id: 'aws-access-key-id',
    name: 'AWS access key ID',
    rationale: 'AWS access key IDs are exactly AKIA followed by 16 uppercase alphanumerics.',
    source: 'gitleaks rule "aws-access-token"',
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    id: 'github-pat',
    name: 'GitHub personal access token',
    rationale: 'GitHub prefixes its tokens ghp_ / gho_ / ghs_ precisely so scanners can find them.',
    source: 'GitHub secret scanning partner patterns',
    regex: /\bgh[pos]_[A-Za-z0-9]{36}\b/g,
  },
  {
    id: 'private-key-block',
    name: 'PEM private key block',
    rationale: 'A PEM armour header is unambiguous — no legitimate source file needs one inline.',
    source: 'gitleaks rule "private-key"',
    regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
  },
  {
    id: 'hardcoded-secret-assignment',
    name: 'Hardcoded secret assignment',
    rationale:
      'A variable named like a credential, assigned a long string literal. This is the generic catch-all — the same shape as the Semgrep hardcoded-secret rule, and the reason naming a variable API_KEY is what gets you caught.',
    source: 'Semgrep generic.secrets hardcoded-secret-assignment',
    // No word boundary before the name: the interesting cases are suffixes of a
    // longer identifier (STRIPE_API_KEY, dbPassword), which a leading \b would miss.
    regex:
      /(?:api[_-]?key|secret[_-]?key|secret|token|passwd|password|pwd|credential)\b\s*[:=]\s*["'][^"'\n]{12,}["']/gi,
  },
]

export interface RuleMatch {
  readonly rule: Rule
  readonly match: string
  readonly index: number
}

/** Every rule hit in a piece of text, in source order. */
export function matchRules(text: string): RuleMatch[] {
  const hits: RuleMatch[] = []
  for (const rule of RULES) {
    // Fresh RegExp per call: a shared /g pattern carries lastIndex between calls.
    const re = new RegExp(rule.regex.source, rule.regex.flags)
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      hits.push({ rule, match: m[0], index: m.index })
      if (m[0].length === 0) re.lastIndex++
    }
  }
  return hits.sort((a, b) => a.index - b.index)
}
