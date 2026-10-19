import { afterAll, describe, expect, test } from 'bun:test';
import { existsSync, rmSync } from 'node:fs';
import type { LedgerLine, MutationRecord, StrykerReport } from './records';
import { baselinePathFor, renderReport, summarizeReport } from './report';
import { claimBaseline } from './sweep';

function rec(
  id: string,
  status: string,
  fileName: string,
  mutatorName = 'BooleanLiteral',
): MutationRecord {
  const column = 22 + Number(id);
  return {
    identity: {
      fileName,
      location: {
        start: { line: 1, column },
        end: { line: 1, column: column + 4 },
      },
      mutatorName,
      original: 'true',
      replacement: 'false',
    },
    identityKey: JSON.stringify([
      fileName,
      1,
      column,
      1,
      column + 4,
      mutatorName,
      'true',
      'false',
    ]),
    observed: {
      id,
      status: status as MutationRecord['observed']['status'],
      static: false,
      coveredBy: [],
      killedBy: null,
    },
    reviewed: {
      disposition: null,
      contract: null,
      distinguishingCondition: null,
      reachableSetup: null,
      observableDifference: null,
      falsifierResult: null,
      rationale: null,
    },
  };
}

// Real Stryker report shape (readReport parses this via collectMutationRecords).
// Derived original for the slice is 'true' (cols 11..15 of the source line).
function strykerReport(
  fileName: string,
  status: 'Killed' | 'Survived',
): StrykerReport {
  return {
    files: {
      [fileName]: {
        language: 'typescript',
        source: 'const x = true;',
        mutants: [
          {
            id: '1',
            mutatorName: 'BooleanLiteral',
            replacement: 'false',
            status,
            static: false,
            coveredBy: [],
            location: {
              start: { line: 1, column: 11 },
              end: { line: 1, column: 15 },
            },
          },
        ],
      },
    },
  };
}

const SCRATCH = 'reports/mutation/state-test';
const A = 'state-test-a.ts';
const B = 'state-test-b.ts';

afterAll(async () => {
  for (const path of [
    `${SCRATCH}-claim.json`,
    `${SCRATCH}-attach.json`,
    `${SCRATCH}-cross.json`,
    `${SCRATCH}-replace.json`,
    baselinePathFor([A]),
    baselinePathFor([B]),
  ]) {
    rmSync(path, { force: true });
  }
});

describe('state semantics: baseline per file set', () => {
  test('first sweep claims the reference at the derived path', async () => {
    const reportPath = `${SCRATCH}-claim.json`;
    await Bun.write(reportPath, JSON.stringify(strykerReport(A, 'Survived')));
    const baselinePath = baselinePathFor([A]);
    rmSync(baselinePath, { force: true });

    const first = await claimBaseline([A], reportPath);
    expect(first.firstRun).toBe(true);
    expect(first.baselinePath).toBe(baselinePath);
    expect(existsSync(baselinePath)).toBe(true);

    // Claiming again must never overwrite an existing reference.
    const again = await claimBaseline([A], reportPath);
    expect(again.firstRun).toBe(false);
    expect(await Bun.file(baselinePath).text()).toBe(
      await Bun.file(reportPath).text(),
    );
  });

  test('second sweep attaches its own set reference', async () => {
    const reportPath = `${SCRATCH}-attach.json`;
    await Bun.write(reportPath, JSON.stringify(strykerReport(A, 'Survived')));
    await Bun.write(
      baselinePathFor([A]),
      JSON.stringify(strykerReport(A, 'Survived')),
    );
    const out = await summarizeReport(reportPath);
    expect(out).toContain('still-surviving: 1');
  });

  test('different file set never borrows the baseline', async () => {
    const reportPath = `${SCRATCH}-cross.json`;
    await Bun.write(reportPath, JSON.stringify(strykerReport(B, 'Survived')));
    // A baseline exists, but only for a different file set.
    await Bun.write(
      baselinePathFor([A]),
      JSON.stringify(strykerReport(A, 'Survived')),
    );
    const out = await summarizeReport(reportPath);
    expect(out).not.toContain('transitions');
  });

  test('replacing the baseline resets the reference', async () => {
    const reportPath = `${SCRATCH}-replace.json`;
    await Bun.write(reportPath, JSON.stringify(strykerReport(A, 'Survived')));
    const baselinePath = baselinePathFor([A]);
    await Bun.write(baselinePath, JSON.stringify(strykerReport(A, 'Survived')));
    expect(await summarizeReport(reportPath)).toContain('still-surviving: 1');

    await Bun.write(baselinePath, JSON.stringify(strykerReport(A, 'Killed')));
    expect(await summarizeReport(reportPath)).toContain('newly-surviving: 1');
  });
});

describe('state semantics: ledger attach + verbatim carry-through + duplicate identityKey surfacing', () => {
  test('carries ledger entries verbatim and never overwrites', () => {
    const survivor = rec('1', 'Survived', 'a.ts');
    const ledger: LedgerLine[] = [
      {
        identityKey: survivor.identityKey,
        disposition: 'Unreachable-under-invariant',
        rationale: 'state forbidden by the lifecycle',
      },
    ];
    const out = renderReport({
      records: [survivor],
      baseline: undefined,
      ledger,
    });
    expect(out).toContain('Unreachable-under-invariant');
    expect(out).toContain('state forbidden by the lifecycle');
    expect(out).not.toContain('equivalent');
    expect(out).not.toContain('detected');
  });

  test('two ledger lines under one identityKey stop the run with a named contradiction', () => {
    const survivor = rec('1', 'Survived', 'a.ts');
    const contradictoryLedger: LedgerLine[] = [
      {
        identityKey: survivor.identityKey,
        disposition: 'Unreachable-under-invariant',
        rationale: 'first judgment',
      },
      {
        identityKey: survivor.identityKey,
        disposition: 'Detected',
        rationale: 'second judgment',
      },
    ];
    expect(() =>
      renderReport({
        records: [survivor],
        baseline: undefined,
        ledger: contradictoryLedger,
      }),
    ).toThrow(/duplicate identityKey/);
  });

  test('survivor grouping for large sets', () => {
    const records = [];
    for (let i = 1; i <= 15; i++) {
      records.push(rec(i.toString(), 'Survived', `file${i}.ts`));
    }
    for (let i = 16; i <= 25; i++) {
      records.push(
        rec(i.toString(), 'Survived', `file${i}.ts`, 'EqualityOperator'),
      );
    }
    const out = renderReport({ records, baseline: undefined, ledger: [] });
    expect(out).toContain('survivors (25):');
    expect(out).toContain('BooleanLiteral (15):');
    expect(out).toContain('EqualityOperator (10):');
    for (let i = 1; i <= 25; i++) {
      expect(out).toContain(`id=${i}`);
    }
    // Small sets stay flat: no cluster headers.
    const small = renderReport({
      records: records.slice(0, 5),
      baseline: undefined,
      ledger: [],
    });
    expect(small).toContain('survivors (5):');
    expect(small).not.toContain('BooleanLiteral (5):');
  });

  test('score with Timeout counted detected and slow-under-mutant named', () => {
    const out = renderReport({
      records: [
        rec('1', 'Killed', 'a.ts'),
        rec('2', 'Timeout', 'a.ts'),
        rec('3', 'NoCoverage', 'a.ts'),
        rec('4', 'Error', 'a.ts'),
        rec('5', 'Survived', 'a.ts'),
      ],
      baseline: undefined,
      ledger: [],
    });
    expect(out).toContain('Timeout=1');
    expect(out).toContain('Error=1');
    expect(out).toContain('NoCoverage=1');
    expect(out).toContain('Survived=1');
    expect(out).toContain('Killed=1');
    expect(out).toContain('score:');
    expect(out).toContain('flagged (3):');
    expect(out).toContain('slow-under-mutant');
    expect(out).toContain('id=2');
  });
});

describe('state semantics: identityKey stability across numeric ID churn', () => {
  test('identityKey depends on source, location, mutator, original, replacement only', () => {
    const base = rec('1', 'Survived', 'a.ts');
    const churned = { ...base, observed: { ...base.observed, id: '99' } };
    const out = renderReport({
      records: [churned],
      baseline: [base],
      ledger: [],
    });
    expect(out).toContain('still-surviving: 1');
    expect(out).not.toContain('newly-surviving: 1');
  });
});

describe('state semantics: tool-observed vs human-concluded separation', () => {
  test('tool-observed fields (status, id, coveredBy) never change when ledger is attached', () => {
    const survivor = rec('1', 'Survived', 'a.ts');
    const ledger: LedgerLine[] = [
      {
        identityKey: survivor.identityKey,
        disposition: 'Detected',
        rationale: 'hand-judged',
      },
    ];
    const out = renderReport({
      records: [survivor],
      baseline: undefined,
      ledger,
    });
    expect(out).toContain('Detected');
    expect(out).toContain('hand-judged');
    expect(out).toContain('disp=Detected');
    expect(out).not.toContain('unreviewed');
  });

  test('human-concluded fields (disposition, rationale) come from ledger only', () => {
    const survivor = rec('1', 'Survived', 'a.ts');
    const bare = renderReport({
      records: [survivor],
      baseline: undefined,
      ledger: [],
    });
    expect(bare).toContain('disp=unreviewed');

    const out = renderReport({
      records: [survivor],
      baseline: undefined,
      ledger: [
        {
          identityKey: survivor.identityKey,
          disposition: 'Equivalent-under-preconditions',
          rationale: 'mutant never triggers in real system',
        },
      ],
    });
    expect(out).toContain('disp=Equivalent-under-preconditions');
    expect(out).toContain('mutant never triggers in real system');
    expect(out).not.toContain('disp=unreviewed');
  });
});

describe('state semantics: transitions block against baseline', () => {
  test('transitions show against baseline (newly-killed, newly-surviving, etc.)', () => {
    const base = [rec('1', 'Survived', 'a.ts'), rec('2', 'Killed', 'a.ts')];
    const next = [rec('1', 'Killed', 'a.ts'), rec('2', 'Survived', 'a.ts')];
    const out = renderReport({ records: next, baseline: base, ledger: [] });
    expect(out).toContain('transitions');
    expect(out).toContain('newly-killed: 1');
    expect(out).toContain('newly-surviving: 1');
    expect(out).toContain('still-surviving: 0');
    expect(out).toContain('already-killed: 0');
    expect(out).toContain('added: 0, removed: 0');
  });
});
