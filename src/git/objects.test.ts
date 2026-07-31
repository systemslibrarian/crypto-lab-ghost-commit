import { describe, expect, it } from 'vitest'

import KAT from './git-objects.kat.json'
import {
  MODE_DIR,
  MODE_FILE,
  type HashAlgo,
  compareTreeEntries,
  fromHex,
  hashBlob,
  hashObject,
  objectHeader,
  serializeTree,
  shortId,
  toHex,
  utf8,
} from './objects'
import { Repo } from './repo'
import { CONFIG_PATH, LEAKED_KEY, SCENARIO, identityFor } from './scenario'

const ALGOS: readonly HashAlgo[] = ['sha1', 'sha256']

/** Build the demo repository exactly as the page does. */
async function buildScenario(algo: HashAlgo): Promise<Repo> {
  const repo = new Repo(algo)
  for (const [index, step] of SCENARIO.entries()) {
    await repo.commit({
      message: step.message,
      snapshot: step.snapshot,
      author: identityFor(index),
    })
  }
  return repo
}

describe('git object hashing — known answers', () => {
  it('hashes the empty blob to the id git documents', async () => {
    expect(await hashBlob('', 'sha1')).toBe(KAT.wellKnown.sha1.emptyBlob)
    expect(await hashBlob('', 'sha256')).toBe(KAT.wellKnown.sha256.emptyBlob)
  })

  it('hashes "hello world" the way `git hash-object` does', async () => {
    expect(await hashBlob('hello world\n', 'sha1')).toBe(KAT.wellKnown.sha1.helloWorldBlob)
  })

  it('hashes the empty tree to git’s canonical empty-tree id', async () => {
    expect(await hashObject('tree', new Uint8Array(0), 'sha1')).toBe(KAT.wellKnown.sha1.emptyTree)
    expect(await hashObject('tree', new Uint8Array(0), 'sha256')).toBe(
      KAT.wellKnown.sha256.emptyTree,
    )
  })

  it('is not the same as hashing the file contents alone — the header is load-bearing', async () => {
    const bare = utf8('hello world\n')
    const raw = toHex(
      new Uint8Array(await crypto.subtle.digest('SHA-1', bare.slice().buffer as ArrayBuffer)),
    )
    expect(await hashBlob('hello world\n', 'sha1')).not.toBe(raw)
  })

  it('builds the loose-object header git prepends', () => {
    expect(new TextDecoder().decode(objectHeader('blob', 12))).toBe('blob 12\0')
    expect(new TextDecoder().decode(objectHeader('commit', 0))).toBe('commit 0\0')
  })
})

describe('tree serialization', () => {
  it('sorts a directory as though its name ended in a slash', () => {
    // "src.py" < "src/" byte-wise ('.' = 0x2e < '/' = 0x2f), so the directory sorts last.
    const dir = { mode: MODE_DIR, name: 'src', hash: '0'.repeat(40) }
    const file = { mode: MODE_FILE, name: 'src.py', hash: '1'.repeat(40) }
    expect(compareTreeEntries(file, dir)).toBeLessThan(0)
    expect(compareTreeEntries(dir, file)).toBeGreaterThan(0)
  })

  it('emits `<mode> <name>\\0<raw id>` with the id in binary, not hex', () => {
    const hash = 'a'.repeat(40)
    const bytes = serializeTree([{ mode: MODE_FILE, name: 'a.txt', hash }], 'sha1')
    expect(new TextDecoder().decode(bytes.slice(0, 13))).toBe('100644 a.txt\0')
    expect(bytes.length).toBe(13 + 20)
    expect(toHex(bytes.slice(13))).toBe(hash)
  })

  it('rejects an id of the wrong width for the algorithm', () => {
    const sha1Id = { mode: MODE_FILE, name: 'a', hash: 'a'.repeat(40) }
    expect(() => serializeTree([sha1Id], 'sha256')).toThrow(/expected a sha256 id/)
  })
})

describe('hex helpers', () => {
  it('round-trips', () => {
    const bytes = new Uint8Array([0x00, 0x0f, 0xff, 0x7b])
    expect(fromHex(toHex(bytes))).toEqual(bytes)
  })

  it('rejects malformed hex rather than producing a plausible-looking id', () => {
    expect(() => fromHex('abc')).toThrow(/odd-length/)
    expect(() => fromHex('zz')).toThrow(/invalid hex/)
  })

  it('abbreviates ids the way git logs them', () => {
    expect(shortId('0123456789abcdef')).toBe('0123456')
  })
})

describe.each(ALGOS)('the demo repository, hashed with %s', (algo) => {
  const expected = KAT.scenario[algo]

  it('reproduces every commit id the real git binary computed', async () => {
    const repo = await buildScenario(algo)
    expect(repo.log.map((c) => c.hash)).toEqual(expected.map((e) => e.commit))
  })

  it('reproduces every tree id', async () => {
    const repo = await buildScenario(algo)
    expect(repo.log.map((c) => c.tree)).toEqual(expected.map((e) => e.tree))
  })

  it('reproduces every blob id, path by path', async () => {
    for (const [index, step] of SCENARIO.entries()) {
      const wanted: Record<string, string> = expected[index]?.blobs ?? {}
      for (const [path, content] of Object.entries(step.snapshot)) {
        expect(await hashBlob(content, algo), `${step.id}:${path}`).toBe(wanted[path])
      }
    }
  })
})

describe('the persistence invariant', () => {
  it('reuses one blob across the two commits that share the leaked file', async () => {
    const leaked = KAT.scenario.sha1[2]?.blobs[CONFIG_PATH]
    expect(KAT.scenario.sha1[3]?.blobs[CONFIG_PATH]).toBe(leaked)
  })

  it('keeps the leaked blob in the store after the value is removed from HEAD', async () => {
    const repo = await buildScenario('sha1')
    const leakedBlob = await hashBlob(SCENARIO[2]!.snapshot[CONFIG_PATH]!, 'sha1')

    // HEAD is clean: the path is gone entirely by the last commit.
    expect(repo.head!.snapshot[CONFIG_PATH]).toBeUndefined()
    // The object is not: nothing in git's model ever removed it.
    expect(repo.store.has(leakedBlob)).toBe(true)
    expect(repo.store.get(leakedBlob)!.text).toContain(LEAKED_KEY)
  })

  it('surfaces the secret by walking the parent chain from a clean HEAD', async () => {
    const repo = await buildScenario('sha1')
    const hits = repo
      .walkHistory()
      .filter((c) => (c.snapshot[CONFIG_PATH] ?? '').includes(LEAKED_KEY))
    expect(hits.map((c) => c.message)).toEqual(['Add refund endpoint', 'Wire up AcmePay billing'])
  })

  it('grows the object count on delete — removal is an addition', async () => {
    const repo = new Repo('sha1')
    for (const [index, step] of SCENARIO.entries()) {
      await repo.commit({ message: step.message, snapshot: step.snapshot, author: identityFor(index) })
    }
    const afterAll = repo.store.size

    const upToRedact = new Repo('sha1')
    for (const [index, step] of SCENARIO.slice(0, 5).entries()) {
      await upToRedact.commit({
        message: step.message,
        snapshot: step.snapshot,
        author: identityFor(index),
      })
    }
    expect(afterAll).toBeGreaterThan(upToRedact.store.size)
  })
})
