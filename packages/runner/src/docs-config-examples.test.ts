import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Platform } from './config'
import { assertValid } from './validate'

/**
 * Every complete `defineRnDriverConfig` example in the shipped documentation must
 * survive the runner's own validator.
 *
 * `docs-examples.test.ts` hand-writes a "README-style" config, so it grades a shape
 * someone typed into a test rather than the shape a consumer copies, and it only
 * typechecks — it never calls `assertValid`. Both gaps let the root README's
 * canonical example carry `launch: { mode: 'attach', kind: 'plain' }`, which the
 * validator rejects, while the runner README documented the correct combination two
 * files away. A consumer following the root README hit exit 2 on the one config the
 * CLI requires them to write. This reads the markdown instead, so the docs cannot
 * drift from the validator again.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

const DOC_FILES = ['README.md', 'packages/runner/README.md', 'examples/basic-app/README.md']

interface DocExample {
  readonly file: string
  readonly line: number
  readonly source: string
}

/**
 * Fenced `ts` blocks that define a whole config. Blocks carrying an elision marker
 * are prose fragments (they reference helpers the doc never defines) and are not
 * consumer-copyable, so they are out of scope rather than silently passed.
 */
function extractCompleteConfigExamples(markdown: string, file: string): DocExample[] {
  const examples: DocExample[] = []
  const fence = /```ts\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = fence.exec(markdown)) !== null) {
    const source = match[1] ?? ''
    if (!source.includes('export default defineRnDriverConfig({')) continue
    if (source.includes('// ...')) continue
    examples.push({
      file,
      line: markdown.slice(0, match.index).split('\n').length + 1,
      source,
    })
  }
  return examples
}

/** Evaluate the example as a plain object literal: drop the import, unwrap the helper. */
function evaluateExample(example: DocExample): unknown {
  const body = example.source
    .split('\n')
    .filter((line) => !line.startsWith('import '))
    .join('\n')
    .replace('export default defineRnDriverConfig(', '(')
    .replace(/\)\s*$/, ')')
  return new Function(`return ${body.trim().replace(/;$/, '')}`)()
}

function declaredPlatforms(config: unknown): Platform[] {
  const record = config as Record<string, unknown>
  const platforms: Platform[] = []
  if (record['ios']) platforms.push('ios')
  if (record['android']) platforms.push('android')
  return platforms
}

describe('documented config examples validate', async () => {
  const examples: DocExample[] = []
  for (const file of DOC_FILES) {
    const markdown = await readFile(path.join(repoRoot, file), 'utf8')
    examples.push(...extractCompleteConfigExamples(markdown, file))
  }

  it('finds the documented examples it is meant to guard', () => {
    // A regex that silently matches nothing would make every assertion below vacuous.
    expect(examples.length).toBeGreaterThanOrEqual(4)
    expect(examples.map((e) => e.file)).toContain('README.md')
  })

  for (const example of examples) {
    it(`${example.file}:${example.line} passes assertValid`, () => {
      const config = evaluateExample(example)
      const platforms = declaredPlatforms(config)
      expect(platforms.length).toBeGreaterThan(0)
      expect(() => {
        assertValid(config, platforms)
      }).not.toThrow()
    })
  }
})
