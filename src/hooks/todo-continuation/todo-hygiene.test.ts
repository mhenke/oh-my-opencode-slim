import { describe, expect, test } from 'bun:test';
import {
  createTodoHygiene,
  TODO_FINAL_ACTIVE_REMINDER,
  TODO_HYGIENE_REMINDER,
} from './todo-hygiene';

function createState(
  overrides?: Partial<{
    hasOpenTodos: boolean;
    openCount: number;
    inProgressCount: number;
    pendingCount: number;
  }>,
) {
  return {
    hasOpenTodos: overrides?.hasOpenTodos ?? true,
    openCount: overrides?.openCount ?? 1,
    inProgressCount: overrides?.inProgressCount ?? 0,
    pendingCount: overrides?.pendingCount ?? 1,
  };
}

function createToolOutput(output = 'tool result') {
  return { output };
}

describe('todo hygiene', () => {
  test('new request clears pending state from the previous turn', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const staleOutput = createToolOutput('stale tool result');
    const freshOutput = createToolOutput('fresh tool result');

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      staleOutput,
    );

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      freshOutput,
    );

    expect(staleOutput.output).toContain(TODO_HYGIENE_REMINDER);
    expect(freshOutput.output).toContain(TODO_HYGIENE_REMINDER);
  });

  test('system transform is no-op (cache-safe)', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const system = { system: ['base'] };

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'read', sessionID: 's1' });
    await hook.handleChatSystemTransform({ sessionID: 's1' }, system);

    expect(system.system).toEqual(['base']);
    expect(system.system.join('\n')).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('does not arm before the current request calls todowrite', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );

    expect(output.output).toBe('tool result');
    expect(output.output).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('arms after the first relevant tool following todowrite', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );

    expect(output.output).toContain(TODO_HYGIENE_REMINDER);
    expect(output.output).toContain('<internal_reminder>');
  });

  test('multiple tools in the same round still inject only one reminder', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const output1 = createToolOutput('result 1');
    const output2 = createToolOutput('result 2');
    const output3 = createToolOutput('result 3');

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output1,
    );
    await hook.handleToolExecuteAfter(
      { tool: 'grep', sessionID: 's1' },
      output2,
    );
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output3,
    );

    // Only the first non-todowrite tool should get the reminder
    expect(output1.output).toContain(TODO_HYGIENE_REMINDER);
    expect(output2.output).not.toContain(TODO_HYGIENE_REMINDER);
    expect(output3.output).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('injects again on a later round after new activity', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const firstOutput = createToolOutput('first result');
    const secondOutput = createToolOutput('second result');

    // First request cycle
    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      firstOutput,
    );

    // Second request cycle - needs new request start to clear injected state
    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      secondOutput,
    );

    expect(firstOutput.output).toContain(TODO_HYGIENE_REMINDER);
    expect(secondOutput.output).toContain(TODO_HYGIENE_REMINDER);
  });

  test('upgrades to final-active on a later round', async () => {
    let call = 0;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        call++;
        if (call <= 3) {
          return createState();
        }
        return createState({
          openCount: 1,
          inProgressCount: 1,
          pendingCount: 0,
        });
      },
    });
    const firstOutput = createToolOutput('first result');
    const secondOutput = createToolOutput('second result');

    // First request cycle - general reminder
    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      firstOutput,
    );

    // Second request cycle - final-active reminder (state changed)
    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      secondOutput,
    );

    expect(firstOutput.output).toContain(TODO_HYGIENE_REMINDER);
    expect(secondOutput.output).toContain(TODO_FINAL_ACTIVE_REMINDER);
  });

  test('todowrite can arm final-active immediately', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () =>
        createState({
          openCount: 1,
          inProgressCount: 1,
          pendingCount: 0,
        }),
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'todowrite', sessionID: 's1' },
      output,
    );

    expect(output.output).toContain(TODO_FINAL_ACTIVE_REMINDER);
    expect(output.output).toContain('<internal_reminder>');
  });

  test('once final-active is armed, later tools skip extra todo lookups in the same round', async () => {
    let calls = 0;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        calls++;
        return createState({
          openCount: 1,
          inProgressCount: 1,
          pendingCount: 0,
        });
      },
    });

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'read', sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'grep', sessionID: 's1' });

    expect(calls).toBe(1);
  });

  test('shouldInject rejection consumes the pending reminder', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
      shouldInject: () => false,
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );

    expect(output.output).toBe('tool result');
    expect(output.output).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('final-active reminder wins when only one active todo remains', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () =>
        createState({
          openCount: 1,
          inProgressCount: 1,
          pendingCount: 0,
        }),
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'todowrite', sessionID: 's1' },
      output,
    );

    expect(output.output).toContain(TODO_FINAL_ACTIVE_REMINDER);
    expect(output.output).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('transform lookup failures are best-effort and do not drop later reminders', async () => {
    let fail = false;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        if (fail) {
          throw new Error('boom');
        }
        return createState();
      },
    });
    const firstOutput = createToolOutput('first result');
    const failedOutput = createToolOutput('failed result');
    const recoveredOutput = createToolOutput('recovered result');

    // First cycle - succeeds
    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      firstOutput,
    );

    // Second cycle - todowrite fails but read succeeds
    hook.handleRequestStart({ sessionID: 's1' });
    fail = true;
    await hook.handleToolExecuteAfter(
      { tool: 'todowrite', sessionID: 's1' },
      failedOutput,
    );
    fail = false;
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      recoveredOutput,
    );

    expect(firstOutput.output).toContain(TODO_HYGIENE_REMINDER);
    expect(failedOutput.output).toBe('failed result');
    expect(failedOutput.output).not.toContain(TODO_HYGIENE_REMINDER);
    expect(recoveredOutput.output).toContain(TODO_HYGIENE_REMINDER);
  });

  test('a late tool failure does not clear a reminder already armed for the round', async () => {
    let call = 0;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        call++;
        if (call === 3) {
          throw new Error('boom');
        }
        return createState();
      },
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );
    await hook.handleToolExecuteAfter({ tool: 'grep', sessionID: 's1' });

    expect(output.output).toContain(TODO_HYGIENE_REMINDER);
  });

  test('todowrite lookup failures do not disable the current request', async () => {
    let fail = false;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        if (fail) {
          throw new Error('boom');
        }
        return createState();
      },
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    fail = true;
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    fail = false;
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );
    await hook.handleToolExecuteAfter({ tool: 'grep', sessionID: 's1' });

    expect(output.output).toContain(TODO_HYGIENE_REMINDER);
  });

  test('non-injectable sessions are fully cleared after a rejected round', async () => {
    let calls = 0;
    const hook = createTodoHygiene({
      getTodoState: async () => {
        calls++;
        return createState();
      },
      shouldInject: () => false,
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter(
      { tool: 'read', sessionID: 's1' },
      output,
    );
    await hook.handleToolExecuteAfter({ tool: 'grep', sessionID: 's1' });

    expect(calls).toBe(1);
    expect(output.output).toBe('tool result');
    expect(output.output).not.toContain(TODO_HYGIENE_REMINDER);
  });

  test('session.deleted clears all state', async () => {
    const hook = createTodoHygiene({
      getTodoState: async () => createState(),
    });
    const output = createToolOutput();

    hook.handleRequestStart({ sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'todowrite', sessionID: 's1' });
    await hook.handleToolExecuteAfter({ tool: 'read', sessionID: 's1' });
    hook.handleEvent({
      type: 'session.deleted',
      properties: { info: { id: 's1' } },
    });
    await hook.handleToolExecuteAfter(
      { tool: 'grep', sessionID: 's1' },
      output,
    );

    expect(output.output).toBe('tool result');
    expect(output.output).not.toContain(TODO_HYGIENE_REMINDER);
  });
});
