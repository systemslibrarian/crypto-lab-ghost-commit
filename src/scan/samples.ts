/**
 * Reference strings for the entropy chart.
 *
 * These are labelled comparison samples, not repository contents — the chart marks
 * them as such. They exist because the repository alone produces too few candidates
 * to show where a threshold sits, and because two of them make the demo's least
 * obvious point: an English sentence scores nearly as high as an API key, and the
 * only reason it is never flagged is that it never becomes a candidate.
 *
 * Nothing here is a working credential. The AcmePay value uses an invented vendor
 * prefix; AKIAIOSFODNN7EXAMPLE is AWS's own documented placeholder.
 */

import { LEAKED_KEY } from '../git/scenario'

export interface Sample {
  readonly label: string
  readonly value: string
  /** Why this sample is in the chart. */
  readonly note: string
  /** Is this a secret, in truth? Used to show where the detector is right and wrong. */
  readonly isSecret: boolean
}

export const SAMPLES: readonly Sample[] = [
  {
    label: 'AcmePay live key',
    value: LEAKED_KEY,
    note: 'The credential this repository leaked. High rate, long, and rule-matched. AcmePay is a fictional vendor — see the note in scenario.ts for why the demo does not ship a real vendor prefix.',
    isSecret: true,
  },
  {
    label: 'AWS access key ID',
    value: 'AKIAIOSFODNN7EXAMPLE',
    note: 'AWS’s own documented placeholder. Caught by its prefix, not by entropy.',
    isSecret: true,
  },
  {
    label: 'Base64 key material',
    value: 'heMve8FKnTb4Ur4HY9qRLE+oHtcwa8WZcg3kO69YhiE=',
    note: '32 random bytes, base64-encoded — the shape a real symmetric key arrives in. The + and = are what let the classifier recognise base64 at all.',
    isSecret: true,
  },
  {
    label: 'JWT header segment',
    value: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    note: 'Decodes to {"alg":"HS256","typ":"JWT"} — public metadata, not a credential. Note the charset: with no + / or =, base64url is indistinguishable from plain alphanumeric, so it is judged against the alphanumeric threshold.',
    isSecret: false,
  },
  {
    label: 'English sentence',
    value: 'Configuration lives in src/config.py; ask the payments team.',
    note: 'The surprise: prose scores close to the key. It is never flagged because the spaces break it into runs far shorter than the candidate floor — the tokenizer rejects it, not the threshold.',
    isSecret: false,
  },
  {
    label: 'English word',
    value: 'configuration',
    note: 'Below the 16-character floor. Never scored by a real scanner.',
    isSecret: false,
  },
  {
    label: 'Git SHA-1 object id',
    value: '04f91b3a1f5c8a1c0e9a9f6e2b3f4d5a6c7b8e90',
    note: 'Maximally random hex, and completely harmless. The classic entropy false positive.',
    isSecret: false,
  },
  {
    label: 'UUID',
    value: 'f47ac10b58cc4372a5670e02b2c3d479',
    note: 'Also uniform hex. A scanner cannot tell this from a key by entropy alone.',
    isSecret: false,
  },
  {
    label: 'Repeated character',
    value: 'aaaaaaaaaaaaaaaaaaaaaaaa',
    note: 'Zero entropy: long, but there is no uncertainty in it at all.',
    isSecret: false,
  },
  {
    label: 'Sequential alphabet',
    value: 'abcdefghijklmnopqrstuvwx',
    note: 'Maximum entropy for its length, and utterly predictable. Entropy measures distribution, never guessability.',
    isSecret: false,
  },
]
