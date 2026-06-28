import { describe, expect, test } from 'bun:test';
import {
  compactAttempt,
  createLoopSession,
  type LoopDefinition,
  loopDirname,
} from './loop-session';

function testDef(overrides?: Partial<LoopDefinition>): LoopDefinition {
  return {
    goal: 'test goal',
    successCriteria: 'it works',
    success: { type: 'test', command: 'bun test' },
    maxAttempts: 3,
    executeAgent: 'fixer',
    verifyAgent: 'oracle',
    ...overrides,
  };
}

describe('loopDirname', () => {
  test('creates human-readable dir name with short ID', () => {
    const name = loopDirname('loop-mqwo5ddt', 'Fix typescript errors');
    expect(name).toBe('fix-typescript-errors-mqwo5ddt');
  });

  test('slugifies the goal text', () => {
    const name = loopDirname('loop-abc-123', 'Fix TypeScript & ESLint errors!');
    expect(name).toBe('fix-typescript-eslint-errors-123');
  });

  test('truncates long goals', () => {
    const longGoal = 'a'.repeat(50);
    const name = loopDirname('xyz-999', longGoal);
    expect(name.length).toBeLessThan(60);
  });
});

describe('createLoopSession', () => {
  test('creates a session with executing phase and attempt 1', () => {
    const def = testDef();
    const session = createLoopSession(def, 'loop-test-1');

    expect(session.loopID).toBe('loop-test-1');
    expect(session.definition).toBe(def);
    expect(session.currentPhase).toBe('executing');
    expect(session.attempts).toBe(1);
    expect(session.history).toEqual([]);
    expect(session.activeJobID).toBeUndefined();
    expect(session.manualReviewPending).toBe(false);
    expect(session.historyDir).toContain('test-goal');
  });
});

describe('compactAttempt', () => {
  test('formats a passed attempt', () => {
    const result = compactAttempt({
      attemptNumber: 1,
      executionResult: 'bun test',
      verificationResult: { passed: true, reason: 'all green' },
    });
    expect(result).toContain('## Attempt 1');
    expect(result).toContain('**Outcome:** PASS');
    expect(result).toContain('### Execution Result');
  });

  test('formats a failed attempt with reason', () => {
    const result = compactAttempt({
      attemptNumber: 2,
      executionResult: 'bun test',
      verificationResult: { passed: false, reason: 'tests failed' },
    });
    expect(result).toContain('## Attempt 2');
    expect(result).toContain('FAIL: tests failed');
  });

  test('includes artifacts when present', () => {
    const result = compactAttempt({
      attemptNumber: 1,
      executionResult: 'built',
      verificationResult: { passed: true, reason: 'ok' },
      artifactPaths: ['src/output.ts', 'src/output.test.ts'],
    });
    expect(result).toContain('artifacts: src/output.ts, src/output.test.ts');
  });
});
