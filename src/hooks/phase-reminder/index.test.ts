import { describe, expect, test } from 'bun:test';
import { createPhaseReminderHook, PHASE_REMINDER } from './index';

describe('createPhaseReminderHook', () => {
  test('does not mutate orchestrator messages', async () => {
    const hook = createPhaseReminderHook();
    const output = {
      messages: [
        {
          info: { role: 'user', agent: 'orchestrator' },
          parts: [{ type: 'text', text: 'hello' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);

    expect(output.messages[0].parts[0].text).toBe('hello');
    expect(output.messages[0].parts[0].text).not.toContain(PHASE_REMINDER);
  });

  test('skips non-orchestrator sessions', async () => {
    const hook = createPhaseReminderHook();
    const output = {
      messages: [
        {
          info: { role: 'user', agent: 'explorer' },
          parts: [{ type: 'text', text: 'hello' }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);

    expect(output.messages[0].parts[0].text).toBe('hello');
  });

  test('does not mutate internal notification turns', async () => {
    const hook = createPhaseReminderHook();
    const text =
      '[Background task "x" completed]\n<!-- slim-internal-initiator -->';
    const output = {
      messages: [
        {
          info: { role: 'user' },
          parts: [{ type: 'text', text }],
        },
      ],
    };

    await hook['experimental.chat.messages.transform']({}, output);

    expect(output.messages[0].parts[0].text).toBe(text);
    expect(output.messages[0].parts[0].text).not.toContain(PHASE_REMINDER);
  });
});
