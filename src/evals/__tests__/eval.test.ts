import { describe, expect, test } from 'bun:test';
import {
  checkAssertion,
  executeEvalCase,
  executeSuite,
  formatResult,
  loadEvalSuite,
  loadEvalSuites,
} from '../runner';
import { EvalSuiteSchema } from '../schema';

describe('eval schema', () => {
  test('validates a minimal eval suite', () => {
    const suite = EvalSuiteSchema.parse({
      name: 'test-suite',
      description: 'A test suite',
      evals: [
        {
          id: 'test-1',
          prompt: 'Do something',
          assertions: [
            {
              type: 'contains',
              value: 'hello',
              description: 'Should say hello',
            },
          ],
        },
      ],
    });

    expect(suite.name).toBe('test-suite');
    expect(suite.evals).toHaveLength(1);
    expect(suite.evals[0].agent).toBe('orchestrator'); // default
  });

  test('rejects invalid assertion type', () => {
    expect(() =>
      EvalSuiteSchema.parse({
        name: 'bad',
        description: 'bad',
        evals: [
          {
            id: 'bad-1',
            prompt: 'Do something',
            assertions: [
              { type: 'invalid_type', value: 'x', description: 'bad' },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('eval loader', () => {
  test('loads all eval suites', () => {
    const suites = loadEvalSuites();
    expect(suites.length).toBeGreaterThan(0);

    const names = suites.map((s) => s.name);
    expect(names).toContain('orchestrator-routing');
    expect(names).toContain('fixer-execution');
  });

  test('loads a specific suite', () => {
    const suite = loadEvalSuite('orchestrator-routing');
    expect(suite).not.toBeNull();
    expect(suite?.evals.length).toBeGreaterThan(0);
  });

  test('returns null for nonexistent suite', () => {
    expect(loadEvalSuite('nonexistent')).toBeNull();
  });
});

describe('result formatting', () => {
  test('formats results', () => {
    const result = formatResult({
      suiteName: 'test',
      totalEvals: 3,
      passed: 2,
      failed: 1,
      skipped: 0,
      passAtK: 2 / 3,
      passK: 2 / 3,
      results: [
        {
          evalId: 'a',
          prompt: 'test a',
          runs: 1,
          passRate: 1,
          passed: true,
          assertions: [],
        },
        {
          evalId: 'b',
          prompt: 'test b',
          runs: 1,
          passRate: 1,
          passed: true,
          assertions: [],
        },
        {
          evalId: 'c',
          prompt: 'test c',
          runs: 1,
          passRate: 0,
          passed: false,
          assertions: [
            {
              assertion: {
                type: 'contains',
                value: 'x',
                description: 'Should have x',
              },
              passed: false,
              evidence: 'Output did not contain x',
            },
          ],
        },
      ],
      durationMs: 1500,
      timestamp: new Date().toISOString(),
    });

    expect(result).toContain('2/3 passed');
    expect(result).toContain('test c...');
    expect(result).toContain('Should have x');
  });

  describe('checkAssertion', () => {
    test('contains passes when substring present', () => {
      const assertion = { type: 'contains', value: 'hello', description: 'test' };
      const output = 'hello world';
      expect(checkAssertion(assertion, output).passed).toBe(true);
    });
    test('contains fails when substring absent', () => {
      const assertion = { type: 'contains', value: 'hello', description: 'test' };
      const output = 'goodbye world';
      expect(checkAssertion(assertion, output).passed).toBe(false);
      expect(checkAssertion(assertion, output).evidence).toBe('output did not contain "hello"');
    });
    test('not_contains passes when substring absent', () => {
      const assertion = { type: 'not_contains', value: 'hello', description: 'test' };
      const output = 'goodbye world';
      expect(checkAssertion(assertion, output).passed).toBe(true);
    });
    test('not_contains fails when substring present', () => {
      const assertion = { type: 'not_contains', value: 'hello', description: 'test' };
      const output = 'hello world';
      expect(checkAssertion(assertion, output).passed).toBe(false);
      expect(checkAssertion(assertion, output).evidence).toBe('output contained "hello"');
    });
    test('regex passes when pattern matches', () => {
      const assertion = { type: 'regex', value: '\\d+', description: 'test' };
      const output = 'there are 123 items';
      expect(checkAssertion(assertion, output).passed).toBe(true);
    });
    test('regex fails when pattern does not match', () => {
      const assertion = { type: 'regex', value: '\\d+', description: 'test' };
      const output = 'no numbers here';
      expect(checkAssertion(assertion, output).passed).toBe(false);
      expect(checkAssertion(assertion, output).evidence).toBe('output did not match /\\d+/');
    });
    test('structure passes when pattern present', () => {
      const assertion = { type: 'structure', value: 'name', description: 'test' };
      const output = '{"name": "test", "value": 123}';
      expect(checkAssertion(assertion, output).passed).toBe(true);
    });
    test('references_read requires referenceContent', () => {
      const assertion = { type: 'references_read', value: 'dummy', description: 'test' };
      const output = 'I read the references/full-guide.md file for detailed patterns';
      expect(checkAssertion(assertion, output).passed).toBe(false);
      expect(checkAssertion(assertion, output).evidence).toBe('references_read requires referenceContent to be set');
    });
    test('references_read passes when referenceContent matches', () => {
      const assertion = { type: 'references_read', value: 'dummy', description: 'test', referenceContent: 'Session Archaeology' };
      const output = 'I used Session Archaeology to find past patterns';
      expect(checkAssertion(assertion, output).passed).toBe(true);
    });
    test('references_read fails when referenceContent absent', () => {
      const assertion = { type: 'references_read', value: 'dummy', description: 'test', referenceContent: 'UniquePhrase' };
      const output = 'I will handle this directly';
      expect(checkAssertion(assertion, output).passed).toBe(false);
    });
    test('agent_routed passes when agent in transcript', () => {
      const assertion = { type: 'agent_routed', value: 'fixer', description: 'test' };
      const transcript = { messages: [{ role: 'assistant', content: '', toolCalls: [{ name: 'agent', args: { agent: 'fixer' } }] }], agentInvocations: [{ agent: 'fixer' }] };
      expect(checkAssertion(assertion, '', transcript).passed).toBe(true);
    });
    test('agent_routed fails when agent not in transcript', () => {
      const assertion = { type: 'agent_routed', value: 'fixer', description: 'test' };
      const transcript = { messages: [], agentInvocations: [{ agent: 'librarian' }] };
      expect(checkAssertion(assertion, '', transcript).passed).toBe(false);
      expect(checkAssertion(assertion, '', transcript).evidence).toContain('librarian');
    });
    test('tool_used checks transcript not text', () => {
      const assertion = { type: 'tool_used', value: 'read', description: 'test' };
      const transcript = { messages: [{ role: 'assistant', content: '', toolCalls: [{ name: 'read', args: {} }] }] };
      expect(checkAssertion(assertion, 'I did not use any tools', transcript).passed).toBe(true);
      expect(checkAssertion(assertion, 'I used read tool', undefined).passed).toBe(false);
    });
  });
});

describe('executeEvalCase', () => {
  const evalCase = {
    id: 'test',
    prompt: 'say hello',
    assertions: [
      {
        type: 'contains' as const,
        value: 'hello',
        description: 'should greet',
      },
    ],
  };

  test('passes when all assertions pass across all runs', () => {
    const result = executeEvalCase(evalCase, [
      'hello world',
      'hello again',
      'say hello',
    ]);
    expect(result.passed).toBe(true);
    expect(result.runs).toBe(3);
    expect(result.passRate).toBe(1);
  });

  test('fails when majority of runs fail', () => {
    const result = executeEvalCase(evalCase, ['goodbye', 'goodbye', 'hello']);
    expect(result.passed).toBe(false);
    expect(result.runs).toBe(3);
    expect(result.passRate).toBeCloseTo(1 / 3);
  });

  test('returns error when no outputs provided', () => {
    const result = executeEvalCase(evalCase, []);
    expect(result.passed).toBe(false);
    expect(result.runs).toBe(0);
    expect(result.error).toContain('no outputs');
  });
});

describe('executeSuite', () => {
  test('returns empty result for nonexistent suite', () => {
    const result = executeSuite('nonexistent', {});
    expect(result.totalEvals).toBe(0);
  });

  test('executes orchestrator-routing suite with mock outputs', () => {
    const outputs: Record<string, string> = {
      'trivial-edit-direct': '// This file runs the eval CLI',
      'ui-work-to-designer': 'delegating this to @designer for UI work',
      'multi-file-to-fixer': 'delegating to @fixer for implementation',
      'architecture-to-oracle': 'asking @oracle for architecture guidance',
      'external-docs-to-librarian': '@librarian should research this',
    };

    const result = executeSuite('orchestrator-routing', outputs);
    expect(result.totalEvals).toBe(11);
    expect(result.skipped).toBe(6);
    expect(result.passed).toBe(5);
    expect(result.failed).toBe(0);
  });

  test('skips evals with no output', () => {
    const result = executeSuite('orchestrator-routing', {});
    expect(result.totalEvals).toBe(11);
    expect(result.skipped).toBe(11);
    expect(result.passed).toBe(0);
  });

  test('supports multi-run outputs', () => {
    const outputs: Record<string, string[]> = {
      'trivial-edit-direct': [
        '// This file runs the eval CLI',
        '// This file runs the eval CLI',
        '// This file runs the eval CLI',
      ],
    };

    const result = executeSuite('orchestrator-routing', outputs);
    const trivial = result.results.find(
      (r) => r.evalId === 'trivial-edit-direct',
    );
    expect(trivial).toBeDefined();
    expect(trivial?.runs).toBe(3);
    expect(trivial?.passed).toBe(true);
    expect(trivial?.passRate).toBe(1);
  });
});