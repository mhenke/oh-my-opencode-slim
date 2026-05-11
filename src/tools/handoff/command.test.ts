import { describe, expect, test } from 'bun:test';
import { createHandoffCommandManager } from './command';

function createContext() {
  return {
    directory: '/tmp/test',
    client: {},
  } as any;
}

describe('createHandoffCommandManager', () => {
  test('registers the /handoff command', () => {
    const manager = createHandoffCommandManager(createContext());
    const config: Record<string, unknown> = {};

    manager.registerCommand(config);

    const commands = config.command as Record<string, { template: string }>;
    expect(commands.handoff).toBeDefined();
    expect(commands.handoff.template).toContain('handoff_session');
    expect(commands.handoff.template).toContain('$ARGUMENTS');
  });
});
