/**
 * Post-tool nudge - queues a delegation reminder after file reads/writes.
 * Catches the "inspect/edit files → implement myself" anti-pattern.
 *
 * The reminder is ephemeral: recorded on tool execution, injected via
 * system.transform, and consumed once. File tool output stays clean.
 */

import { PHASE_REMINDER } from '../../config/constants';

interface ToolExecuteAfterInput {
  tool: string;
  sessionID?: string;
  callID?: string;
}

interface PostFileToolNudgeOptions {
  shouldInject?: (sessionID: string) => boolean;
}

const FILE_TOOLS = new Set(['Read', 'read', 'Write', 'write']);

export function createPostFileToolNudgeHook(
  options: PostFileToolNudgeOptions = {},
) {
  const pendingSessionIds = new Set<string>();

  return {
    'tool.execute.after': async (
      input: ToolExecuteAfterInput,
      _output: unknown,
    ): Promise<void> => {
      if (!FILE_TOOLS.has(input.tool) || !input.sessionID) {
        return;
      }

      pendingSessionIds.add(input.sessionID);
    },
    'experimental.chat.system.transform': async (
      input: { sessionID?: string },
      output: { system: string[] },
    ): Promise<void> => {
      if (!input.sessionID || !pendingSessionIds.delete(input.sessionID)) {
        return;
      }

      if (options.shouldInject && !options.shouldInject(input.sessionID)) {
        return;
      }

      output.system.push(PHASE_REMINDER);
    },
    event: async (input: {
      event: {
        type: string;
        properties?: { info?: { id?: string }; sessionID?: string };
      };
    }): Promise<void> => {
      if (input.event.type !== 'session.deleted') return;
      const sid =
        input.event.properties?.sessionID ?? input.event.properties?.info?.id;
      if (sid) pendingSessionIds.delete(sid);
    },
  };
}
