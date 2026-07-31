/**
 * A minimal but faithful git object database, in memory.
 *
 * What is real: the object graph (commits → trees → blobs), the content-addressed
 * store, the parent chain, and every object id — all produced by `objects.ts` from
 * git's actual byte formats.
 *
 * What is not modelled: packfiles, the index, refs beyond a single branch, the
 * reflog, and delta compression. None of those change the fact this demo exists to
 * show — that a blob stays reachable from an old commit no matter what HEAD says.
 */

import {
  type CommitData,
  type GitObjectType,
  type HashAlgo,
  type Identity,
  type TreeEntry,
  MODE_DIR,
  MODE_FILE,
  hashObject,
  serializeCommit,
  serializeTree,
  utf8,
} from './objects'

/** A working-tree state: path (POSIX, no leading slash) → file text. */
export type Snapshot = Readonly<Record<string, string>>

export interface StoredObject {
  readonly type: GitObjectType
  readonly bytes: Uint8Array
  /** Decoded text, for blobs the demo wants to display. */
  readonly text: string
}

export interface Commit {
  readonly hash: string
  readonly message: string
  readonly parents: readonly string[]
  readonly tree: string
  readonly author: Identity
  /** The snapshot this commit records, flattened for display. */
  readonly snapshot: Snapshot
}

const decoder = new TextDecoder()

export class ObjectStore {
  private readonly objects = new Map<string, StoredObject>()

  constructor(readonly algo: HashAlgo = 'sha1') {}

  async put(type: GitObjectType, bytes: Uint8Array): Promise<string> {
    const hash = await hashObject(type, bytes, this.algo)
    // Content addressing: writing the same bytes twice is a no-op, which is exactly
    // why "re-committing the same file" never creates a second copy of the secret.
    if (!this.objects.has(hash)) {
      this.objects.set(hash, { type, bytes, text: decoder.decode(bytes) })
    }
    return hash
  }

  get(hash: string): StoredObject | undefined {
    return this.objects.get(hash)
  }

  has(hash: string): boolean {
    return this.objects.has(hash)
  }

  get size(): number {
    return this.objects.size
  }

  /** Every object ever written, in insertion order. Nothing is ever removed. */
  entries(): ReadonlyArray<readonly [string, StoredObject]> {
    return [...this.objects.entries()]
  }
}

interface DirNode {
  readonly files: Map<string, string>
  readonly dirs: Map<string, DirNode>
}

function emptyDir(): DirNode {
  return { files: new Map(), dirs: new Map() }
}

function buildDirTree(snapshot: Snapshot): DirNode {
  const root = emptyDir()
  for (const [path, content] of Object.entries(snapshot)) {
    const parts = path.split('/')
    const fileName = parts.pop()
    if (!fileName) throw new Error(`invalid path: "${path}"`)
    let node = root
    for (const part of parts) {
      let next = node.dirs.get(part)
      if (!next) {
        next = emptyDir()
        node.dirs.set(part, next)
      }
      node = next
    }
    node.files.set(fileName, content)
  }
  return root
}

async function writeDir(store: ObjectStore, node: DirNode): Promise<string> {
  const entries: TreeEntry[] = []
  for (const [name, content] of node.files) {
    entries.push({ mode: MODE_FILE, name, hash: await store.put('blob', utf8(content)) })
  }
  for (const [name, child] of node.dirs) {
    entries.push({ mode: MODE_DIR, name, hash: await writeDir(store, child) })
  }
  return store.put('tree', serializeTree(entries, store.algo))
}

/** Write a full working tree into the store; returns the root tree id. */
export async function writeSnapshot(store: ObjectStore, snapshot: Snapshot): Promise<string> {
  return writeDir(store, buildDirTree(snapshot))
}

export interface CommitSpec {
  readonly message: string
  readonly snapshot: Snapshot
  readonly author: Identity
}

/**
 * A single-branch repository: an append-only chain of commits over a shared store.
 *
 * `commit()` is the only mutator, and it never deletes an object. Removing a file
 * from the snapshot writes a *new* tree that omits it — the old tree and its blob
 * stay in the store, reachable from the old commit. That is the invariant the whole
 * demo rests on, and it is enforced by the type of the store, not by a comment.
 */
export class Repo {
  readonly store: ObjectStore
  private readonly commits: Commit[] = []

  constructor(algo: HashAlgo = 'sha1') {
    this.store = new ObjectStore(algo)
  }

  get algo(): HashAlgo {
    return this.store.algo
  }

  /** Commits oldest → newest. */
  get log(): readonly Commit[] {
    return this.commits
  }

  get head(): Commit | undefined {
    return this.commits[this.commits.length - 1]
  }

  async commit(spec: CommitSpec): Promise<Commit> {
    const tree = await writeSnapshot(this.store, spec.snapshot)
    const parents = this.head ? [this.head.hash] : []
    const data: CommitData = {
      tree,
      parents,
      author: spec.author,
      committer: spec.author,
      message: spec.message,
    }
    const hash = await this.store.put('commit', serializeCommit(data))
    const commit: Commit = {
      hash,
      message: spec.message,
      parents,
      tree,
      author: spec.author,
      snapshot: { ...spec.snapshot },
    }
    this.commits.push(commit)
    return commit
  }

  get(hash: string): Commit | undefined {
    return this.commits.find((c) => c.hash === hash)
  }

  /**
   * Walk the parent chain from HEAD backwards — `git log` / `git rev-list HEAD`.
   * This is the traversal that finds what HEAD no longer shows.
   */
  walkHistory(from: string | undefined = this.head?.hash): Commit[] {
    const out: Commit[] = []
    let cursor = from
    const seen = new Set<string>()
    while (cursor && !seen.has(cursor)) {
      seen.add(cursor)
      const commit = this.get(cursor)
      if (!commit) break
      out.push(commit)
      cursor = commit.parents[0]
    }
    return out
  }

  /** File content at a given commit, or undefined if the path is absent there. */
  fileAt(commitHash: string, path: string): string | undefined {
    return this.get(commitHash)?.snapshot[path]
  }

  /** Distinct blobs ever recorded for a path, oldest first, with the commits citing them. */
  blobHistory(path: string): Array<{ content: string; commits: Commit[] }> {
    const byContent = new Map<string, { content: string; commits: Commit[] }>()
    for (const commit of this.commits) {
      const content = commit.snapshot[path]
      if (content === undefined) continue
      const bucket = byContent.get(content) ?? { content, commits: [] }
      bucket.commits.push(commit)
      byContent.set(content, bucket)
    }
    return [...byContent.values()]
  }
}
