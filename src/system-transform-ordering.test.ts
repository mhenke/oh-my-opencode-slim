import { describe, expect, test } from 'bun:test';
import { collapseSystemInPlace } from './utils/system-collapse';

/**
 * Regression tests for orchestrator prompt ordering in the
 * experimental.chat.system.transform hook (PR #782).
 *
 * The hook places the orchestrator prompt AFTER AGENTS.md so the user's
 * behavioral rules retain their intended priority. These tests exercise
 * the core ordering logic that the hook performs.
 */

const ORCHESTRATOR_PROMPT = 'You are the orchestrator agent.';

function applySystemTransform(
  system: string[],
  agentName: string | undefined,
  orchestratorPrompt = ORCHESTRATOR_PROMPT,
): void {
  if (agentName === 'orchestrator') {
    const alreadyInjected = system.some(
      (s) =>
        typeof s === 'string' &&
        s.includes('<Role>') &&
        s.includes('orchestrator'),
    );
    if (!alreadyInjected) {
      system[0] = system[0]
        ? `${system[0]}\n\n${orchestratorPrompt}`
        : orchestratorPrompt;
    }
  }
  collapseSystemInPlace(system);
}

describe('system.transform hook ordering (PR #782)', () => {
  test('orchestrator prompt appears AFTER AGENTS.md content', () => {
    const system = ['AGENTS.md: always use TypeScript'];
    applySystemTransform(system, 'orchestrator');

    expect(system).toHaveLength(1);
    expect(system[0]).toBe(
      'AGENTS.md: always use TypeScript\n\n' + ORCHESTRATOR_PROMPT,
    );
  });

  test('empty system array gets orchestrator prompt only', () => {
    const system: string[] = [];
    applySystemTransform(system, 'orchestrator');

    expect(system).toHaveLength(1);
    expect(system[0]).toBe(ORCHESTRATOR_PROMPT);
  });

  test('non-orchestrator agent is not modified', () => {
    const system = ['AGENTS.md: always use TypeScript'];
    applySystemTransform(system, 'explorer');

    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md: always use TypeScript');
  });

  test('already-injected orchestrator prompt is not duplicated', () => {
    const system = ['<Role> orchestrator </Role>'];
    applySystemTransform(system, 'orchestrator');

    expect(system).toHaveLength(1);
    // No double-injection
    expect(system[0]).toBe('<Role> orchestrator </Role>');
  });
});
