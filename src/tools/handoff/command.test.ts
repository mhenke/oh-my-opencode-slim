import { describe, expect, test } from 'bun:test';
import { createHandoffCommandManager } from './command';
import { createHandoffState } from './state';

function createContext() {
  return {
    directory: '/tmp/test',
    client: {},
  } as any;
}

describe('createHandoffCommandManager', () => {
  test('registers the /handoff command', () => {
    const manager = createHandoffCommandManager(
      createContext(),
      createHandoffState(),
    );
    const config: Record<string, unknown> = {};

    manager.registerCommand(config);

    const commands = config.command as Record<string, { template: string }>;
    expect(commands.handoff).toBeDefined();
    expect(commands.handoff.template).toContain('handoff_session');
    expect(commands.handoff.template).toContain('$ARGUMENTS');
  });

  test('marks child sessions of handoff workers with the same source', () => {
    const state = createHandoffState();
    state.markSession('ses_worker', 'ses_source');
    const manager = createHandoffCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.created',
        properties: { info: { id: 'ses_child', parentID: 'ses_worker' } },
      },
    });

    expect(state.sourceFor('ses_child')).toBe('ses_source');
  });

  test('does not mark unrelated child sessions', () => {
    const state = createHandoffState();
    const manager = createHandoffCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.created',
        properties: { info: { id: 'ses_child', parentID: 'ses_parent' } },
      },
    });

    expect(state.isHandoffSession('ses_child')).toBe(false);
  });

  test('unmarks deleted handoff sessions', () => {
    const state = createHandoffState();
    state.markSession('ses_worker', 'ses_source');
    const manager = createHandoffCommandManager(createContext(), state);

    manager.handleEvent({
      event: {
        type: 'session.deleted',
        properties: { info: { id: 'ses_worker' } },
      },
    });

    expect(state.isHandoffSession('ses_worker')).toBe(false);
  });
});
