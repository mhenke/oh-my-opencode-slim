/**
 * Post-tool nudge - queues a delegation reminder after file reads/writes.
 * Catches the "inspect/edit files → implement myself" anti-pattern.
 */

import { PHASE_REMINDER_TEXT } from '../../config/constants';

const POST_FILE_TOOL_NUDGE = PHASE_REMINDER_TEXT;

interface ToolExecuteAfterInput {
  tool: string;
  sessionID?: string;
  callID?: string;
}

interface ChatSystemTransformInput {
  sessionID?: string;
}

interface ChatSystemTransformOutput {
  system: string[];
}

interface ToolExecuteAfterOutput {
  output?: unknown;
}

interface EventInput {
  event: {
    type: string;
    properties?: {
      info?: { id?: string };
      sessionID?: string;
    };
  };
}

interface PostFileToolNudgeOptions {
  shouldInject?: (sessionID: string) => boolean;
}

const FILE_TOOLS = new Set(['Read', 'read', 'Write', 'write']);

export function createPostFileToolNudgeHook(
  options: PostFileToolNudgeOptions = {},
) {
  function appendReminder(output: ToolExecuteAfterOutput): void {
    if (typeof output.output !== 'string') {
      return;
    }

    if (output.output.includes(POST_FILE_TOOL_NUDGE)) {
      return;
    }

    output.output = [
      output.output,
      '',
      '<internal_reminder>',
      POST_FILE_TOOL_NUDGE,
      '</internal_reminder>',
    ].join('\n');
  }

  return {
    'tool.execute.after': async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput,
    ): Promise<void> => {
      if (!FILE_TOOLS.has(input.tool) || !input.sessionID) {
        return;
      }

      if (options.shouldInject && !options.shouldInject(input.sessionID)) {
        return;
      }

      appendReminder(output);
    },
    'experimental.chat.system.transform': async (
      _input: ChatSystemTransformInput,
      _output: ChatSystemTransformOutput,
    ): Promise<void> => {
      // Kept as a no-op for hook shape compatibility. Dynamic reminders must
      // not mutate the system prompt because OpenCode prompt-caches system
      // messages as the stable prefix.
    },
    event: async (input: EventInput): Promise<void> => {
      if (input.event.type !== 'session.deleted') {
        return;
      }
    },
  };
}
