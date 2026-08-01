import { describe, expect, test } from 'bun:test';
import { applyOrchestratorPrompt } from './system-transform';

/**
 * Regression tests for orchestrator prompt ordering (PR #782).
 *
 * These import the real applyOrchestratorPrompt function — no duplicated
 * logic. If the hook changes, these catch it.
 */

const PROMPT = 'You are the orchestrator agent.';

describe('applyOrchestratorPrompt', () => {
  test('orchestrator prompt appears AFTER existing system[0] content', () => {
    const system = ['AGENTS.md: always use TypeScript'];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toBe(`AGENTS.md: always use TypeScript\n\n${PROMPT}`);
  });

  test('empty system array gets orchestrator prompt only', () => {
    const system: string[] = [];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toBe(PROMPT);
  });

  test('non-orchestrator agent leaves system untouched', () => {
    const system = ['AGENTS.md: always use TypeScript'];
    applyOrchestratorPrompt(system, 'explorer', PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md: always use TypeScript');
  });

  test('undefined agent leaves system untouched', () => {
    const system = ['AGENTS.md: always use TypeScript'];
    applyOrchestratorPrompt(system, undefined, PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md: always use TypeScript');
  });

  test('already-injected orchestrator prompt is not duplicated', () => {
    const system = ['<Role> orchestrator </Role>'];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toBe('<Role> orchestrator </Role>');
  });

  test('already-injected in non-first entry prevents injection', () => {
    const system = ['AGENTS.md', '<Role> orchestrator </Role>'];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    // No injection — guard found it in entry [1]. Collapse still runs.
    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md\n\n<Role> orchestrator </Role>');
  });

  test('multiple system entries are collapsed into one', () => {
    const system = ['AGENTS.md', 'extra context'];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    // Orchestrator prompt injected at system[0] (appended to AGENTS.md),
    // then all entries collapsed.
    expect(system).toHaveLength(1);
    expect(system[0]).toBe(`AGENTS.md\n\n${PROMPT}\n\nextra context`);
  });

  test('empty string in system[0] behaves like empty array', () => {
    const system = [''];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    // collapseSystemInPlace drops empty-string singletons
    expect(system).toHaveLength(1);
    expect(system[0]).toBe(PROMPT);
  });

  // Edge cases (#7)

  test('non-string elements in system[] are coerced by collapse', () => {
    const system = ['AGENTS.md', 42 as unknown as string];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system).toHaveLength(1);
    expect(system[0]).toContain(PROMPT);
    expect(system[0]).toContain('AGENTS.md');
  });

  test('empty orchestratorPrompt still runs collapse', () => {
    const system = ['AGENTS.md', 'extra'];
    applyOrchestratorPrompt(system, 'orchestrator', '');

    // Empty prompt appended to system[0] as "AGENTS.md\n\n", then collapsed
    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md\n\n\n\nextra');
  });

  test('whitespace-only orchestratorPrompt is injected (guard checks includes)', () => {
    const system = ['AGENTS.md'];
    applyOrchestratorPrompt(system, 'orchestrator', '   ');

    expect(system).toHaveLength(1);
    expect(system[0]).toBe('AGENTS.md\n\n   ');
  });

  test('mutates system array in-place', () => {
    const system = ['AGENTS.md'];
    const original = system;

    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system).toBe(original);
  });
});

// Snapshot test (#8) — golden byte output for cache-safety tracking
describe('applyOrchestratorPrompt snapshot', () => {
  test('canonical output matches snapshot', () => {
    const system = [
      'You are a coding assistant.\nAlways follow AGENTS.md rules.',
    ];
    applyOrchestratorPrompt(system, 'orchestrator', PROMPT);

    expect(system[0]).toBe(
      'You are a coding assistant.\nAlways follow AGENTS.md rules.\n\nYou are the orchestrator agent.',
    );
  });
});
