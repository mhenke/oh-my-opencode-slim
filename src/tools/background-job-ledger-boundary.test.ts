/**
 * Ledger-boundary tripwire — src/tools/** must read background-job lifecycle
 * state through the BackgroundJobStore accessors (`deletionEpoch` /
 * `isSuppressed`), never by importing the raw lifecycle ledger. Raw access
 * couples tool code to store internals and bypasses the single delegation
 * path (board → coordinator) documented in background-job-store.ts.
 *
 * When this test fails for a new file: replace
 * `getBackgroundJobLifecycleLedger(board).deletionEpochs.get(id)` /
 * `.tombstones.has(id)` with `board.deletionEpoch(id)` /
 * `board.isSuppressed(id)`. There is no allowlist: tools never need the
 * ledger itself (writes stay in background-job-store.ts / the hooks layer).
 */

import { describe, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const SRC_ROOT = path.join(import.meta.dir, '..');

const BANNED_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  {
    name: 'getBackgroundJobLifecycleLedger',
    regex: /\bgetBackgroundJobLifecycleLedger\b/,
  },
  {
    name: 'BackgroundJobLifecycleLedger',
    regex: /\bBackgroundJobLifecycleLedger\b/,
  },
];

async function scanForViolations(): Promise<string[]> {
  const violations: string[] = [];
  const glob = new Bun.Glob('**/*.ts');
  const self = path.basename(import.meta.path);

  for await (const file of glob.scan(path.join(SRC_ROOT, 'tools'))) {
    // The tripwire itself must name the banned identifiers.
    if (file === self) continue;
    const relative = `src/tools/${file}`;
    const content = readFileSync(path.join(SRC_ROOT, 'tools', file), 'utf8');
    for (const pattern of BANNED_PATTERNS) {
      if (pattern.regex.test(content)) {
        violations.push(`${relative} references ${pattern.name}`);
      }
    }
  }

  return violations;
}

describe('background-job ledger boundary tripwire', () => {
  test('src/tools reads lifecycle state only via store accessors', async () => {
    const violations = await scanForViolations();

    if (violations.length > 0) {
      throw new Error(
        [
          'Raw lifecycle-ledger access in src/tools. Read through the',
          'BackgroundJobStore accessors instead:',
          'backgroundJobBoard.deletionEpoch(taskID) and',
          'backgroundJobBoard.isSuppressed(taskID).',
          '',
          ...violations,
        ].join('\n'),
      );
    }
  });
});
