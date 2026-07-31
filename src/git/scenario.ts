/**
 * The demo repository: a small Python billing service, and the six commits that
 * leak a credential and then fail to un-leak it.
 *
 * Every value here is fixed — author, email, timestamps, timezone, file bytes — so
 * the object ids are deterministic. That is what lets `objects.test.ts` compare the
 * ids this page computes in your browser against ids produced by the real `git`
 * binary for the same repository (see `tools/gen-git-kat.ts`).
 *
 * The credential is a fictional vendor's key: the prefix `acmepay_live_` belongs to
 * no real service, and the body is Stripe's public documentation sample value. It has
 * never authenticated anything, and it cannot, because AcmePay does not exist.
 *
 * It reads as fictional on purpose. An earlier draft used a real `sk_live_` prefix and
 * GitHub's push protection refused the push — correctly, because a scanner cannot tell
 * a teaching sample from a live credential. That is this demo's whole thesis, so the
 * demo declines to make its own repository the counterexample. `rules.ts` still carries
 * the genuine Stripe, AWS, and GitHub patterns for reference.
 */

import type { Identity } from './objects'
import type { Snapshot } from './repo'

export const LEAKED_KEY = 'acmepay_live_4eC39HqLyjWDarjtT1zdp7dc'

export const AUTHOR_NAME = 'Ada Rivera'
export const AUTHOR_EMAIL = 'ada@billing.example'
/** 2024-06-01T00:00:00Z. Fixed so commit ids reproduce on every run. */
export const BASE_TIMESTAMP = 1_717_200_000
export const COMMIT_INTERVAL = 3_600
export const TIMEZONE = '+0000'

export function identityFor(index: number): Identity {
  return {
    name: AUTHOR_NAME,
    email: AUTHOR_EMAIL,
    timestamp: BASE_TIMESTAMP + index * COMMIT_INTERVAL,
    tz: TIMEZONE,
  }
}

const README = `# billing-service

Internal billing service for the storefront. Deploys from main on every push.
Configuration lives in src/config.py; ask the payments team before changing it.
`

const APP = `"""Entry point for the billing service."""


def charge(customer_id: str, cents: int) -> dict:
    """Build a charge request. Amounts are in the smallest currency unit."""
    return {"customer": customer_id, "amount": cents, "status": "pending"}
`

const CONFIG_PLACEHOLDER = `"""Runtime configuration for the billing service."""

TIMEOUT_SECONDS = 30
RETRIES = 3
ACMEPAY_API_KEY = ""
`

const CONFIG_LEAKED = `"""Runtime configuration for the billing service."""

TIMEOUT_SECONDS = 30
RETRIES = 3
ACMEPAY_API_KEY = "${LEAKED_KEY}"
`

const CONFIG_FROM_ENV = `"""Runtime configuration for the billing service."""

import os

TIMEOUT_SECONDS = 30
RETRIES = 3
ACMEPAY_API_KEY = os.environ["ACMEPAY_API_KEY"]
`

const REFUNDS_IMPORTING_CONFIG = `"""Refund handling."""

from src.config import ACMEPAY_API_KEY


def refund(charge_id: str) -> dict:
    """Issue a full refund for a charge."""
    return {"charge": charge_id, "authorized": bool(ACMEPAY_API_KEY)}
`

const REFUNDS_FROM_ENV = `"""Refund handling."""

import os


def refund(charge_id: str) -> dict:
    """Issue a full refund for a charge."""
    return {"charge": charge_id, "authorized": bool(os.environ["ACMEPAY_API_KEY"])}
`

export const CONFIG_PATH = 'src/config.py'

/** Which action produced a step — drives the button that is offered next. */
export type StepKind = 'seed' | 'leak' | 'unrelated' | 'redact' | 'delete'

export interface ScenarioStep {
  readonly id: string
  readonly message: string
  readonly snapshot: Snapshot
  readonly kind: StepKind
  /** Button label for the user-driven steps. */
  readonly action: string
  /** One line explaining what this commit does to the repository. */
  readonly note: string
  /** What the learner should expect to happen — shown before they click. */
  readonly expectation: string
}

export const SCENARIO: readonly ScenarioStep[] = [
  {
    id: 'c1',
    message: 'Initial commit',
    kind: 'seed',
    action: 'Initial commit',
    note: 'A README and the service entry point. No credential anywhere yet.',
    expectation: 'A clean starting repository.',
    snapshot: { 'README.md': README, 'src/app.py': APP },
  },
  {
    id: 'c2',
    message: 'Add config module',
    kind: 'seed',
    action: 'Add config module',
    note: 'A config file with an empty placeholder for the AcmePay key.',
    expectation: 'Still clean — the key field exists but is empty.',
    snapshot: {
      'README.md': README,
      'src/app.py': APP,
      'src/config.py': CONFIG_PLACEHOLDER,
    },
  },
  {
    id: 'c3',
    message: 'Wire up AcmePay billing',
    kind: 'leak',
    action: 'Commit the key',
    note: 'The live secret key is pasted straight into src/config.py and committed.',
    expectation:
      'The key is now a blob in the object store, named by its own hash. Watch that id — it is what survives everything you do next.',
    snapshot: {
      'README.md': README,
      'src/app.py': APP,
      'src/config.py': CONFIG_LEAKED,
    },
  },
  {
    id: 'c4',
    message: 'Add refund endpoint',
    kind: 'unrelated',
    action: 'Ship an unrelated feature',
    note: 'A new module lands. Nobody touches config.py — so the key rides along.',
    expectation:
      'A new tree and a new commit, but the config blob is reused byte for byte. Content addressing means no second copy is made.',
    snapshot: {
      'README.md': README,
      'src/app.py': APP,
      'src/config.py': CONFIG_LEAKED,
      'src/refunds.py': REFUNDS_IMPORTING_CONFIG,
    },
  },
  {
    id: 'c5',
    message: 'Read AcmePay key from the environment',
    kind: 'redact',
    action: 'Remove the key from the file',
    note: 'The literal is replaced with os.environ. HEAD no longer contains the key.',
    expectation:
      'A new blob for config.py, with the key gone. The old blob is not modified, not overwritten, and not deleted — commit c3 still points at it.',
    snapshot: {
      'README.md': README,
      'src/app.py': APP,
      'src/config.py': CONFIG_FROM_ENV,
      'src/refunds.py': REFUNDS_IMPORTING_CONFIG,
    },
  },
  {
    id: 'c6',
    message: 'Delete config.py',
    kind: 'delete',
    action: 'Delete the file entirely',
    note: 'git rm src/config.py. The path is gone from the working tree.',
    expectation:
      'The newest tree simply omits the path. Deleting from HEAD adds a commit; it never removes an object.',
    snapshot: {
      'README.md': README,
      'src/app.py': APP,
      'src/refunds.py': REFUNDS_FROM_ENV,
    },
  },
]

/** The two commits already in the repo when the learner arrives. */
export const SEEDED_STEPS = SCENARIO.filter((s) => s.kind === 'seed').length
