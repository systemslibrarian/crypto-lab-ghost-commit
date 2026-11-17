/* The README's own account of the test suite.
 *
 * The "Build & Verify" table listed three files and totalled 63 unit tests.
 * src/git/objects.independent.test.ts — six cases that recompute the object ids
 * a third way — had been added and never reached the table, so the table was
 * missing a file and the total was six short of what `npm test` reported.
 *
 * Checking each row's number against the real per-file count would mean running
 * the suite from inside the suite. What broke here is checkable without that,
 * and is checked: no test file may be absent from the table, no row may name a
 * file that is gone, and the total the README prints must be the sum of the
 * rows it goes on to list.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const srcDir = fileURLToPath(new URL('.', import.meta.url))
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8')

function testFiles(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) found.push(...testFiles(full))
    else if (entry.endsWith('.test.ts')) found.push(`src/${relative(srcDir, full)}`)
  }
  return found.sort()
}

/** The table's rows, as (path, count) pairs read out of the README. */
const rows = [...readme.matchAll(/^\| `(src\/[^`]+\.test\.ts)` \| (\d+) \|/gm)].map((m) => ({
  file: m[1],
  tests: Number(m[2]),
}))

describe("the README's test table", () => {
  it('lists every test file in src/, and no file that does not exist', () => {
    expect(rows.length, 'the table still has rows this test can read').toBeGreaterThan(0)
    expect(rows.map((r) => r.file).sort()).toEqual(testFiles(srcDir))
  })

  it('prints a total that is the sum of its own rows', () => {
    const stated = [...readme.matchAll(/\*\*(\d+) unit tests\*\*/g)].map((m) => Number(m[1]))
    const inProse = [...readme.matchAll(/# (\d+) unit tests/g)].map((m) => Number(m[1]))
    const sum = rows.reduce((total, row) => total + row.tests, 0)

    expect(stated, 'the README states a total').not.toHaveLength(0)
    for (const total of [...stated, ...inProse]) {
      expect(total, 'every unit-test count in the README is the sum of the table').toBe(sum)
    }
  })
})
