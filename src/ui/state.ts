/** Application state. One object, one notifier — every panel re-renders from it. */

import type { HashAlgo } from '../git/objects'
import { Repo } from '../git/repo'
import { SCENARIO, SEEDED_STEPS, identityFor } from '../git/scenario'
import type { ScanReport } from '../scan/scanner'

export interface AppState {
  algo: HashAlgo
  repo: Repo
  /** How many scenario steps have been committed. Starts at the seeded count. */
  committed: number
  selectedCommit: string | null
  selectedFile: string | null
  /** Set once the learner runs the history walk — gates the reveal. */
  historyWalked: boolean
  headReport: ScanReport | null
  historyReport: ScanReport | null
  /** Has the credential been rotated at the provider? Pure real-world state. */
  rotated: boolean
  /** The string currently loaded into the entropy panel. */
  subject: string
}

export async function buildRepo(algo: HashAlgo, committed: number): Promise<Repo> {
  const repo = new Repo(algo)
  for (const [index, step] of SCENARIO.slice(0, committed).entries()) {
    await repo.commit({ message: step.message, snapshot: step.snapshot, author: identityFor(index) })
  }
  return repo
}

export async function initialState(algo: HashAlgo = 'sha1'): Promise<AppState> {
  const repo = await buildRepo(algo, SEEDED_STEPS)
  return {
    algo,
    repo,
    committed: SEEDED_STEPS,
    selectedCommit: repo.head?.hash ?? null,
    selectedFile: null,
    historyWalked: false,
    headReport: null,
    historyReport: null,
    rotated: false,
    subject: '',
  }
}

type Listener = (state: AppState) => void

export class Store {
  private listeners: Listener[] = []

  constructor(public state: AppState) {}

  subscribe(fn: Listener): void {
    this.listeners.push(fn)
  }

  /** Apply a change and re-render everything. Small app, no diffing needed. */
  update(mutate: (state: AppState) => void): void {
    mutate(this.state)
    for (const fn of this.listeners) fn(this.state)
  }

  async updateAsync(mutate: (state: AppState) => Promise<void>): Promise<void> {
    await mutate(this.state)
    for (const fn of this.listeners) fn(this.state)
  }
}

/** The next step the learner can take, or undefined once the story is finished. */
export function nextStep(state: AppState): (typeof SCENARIO)[number] | undefined {
  return SCENARIO[state.committed]
}
