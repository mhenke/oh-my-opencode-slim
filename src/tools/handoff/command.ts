/**
 * Command registration manager for handoff functionality.
 *
 * Manages the /handoff slash command registration and the HANDOFF_COMMAND
 * template that guides the AI in generating handoff prompts.
 */

import type { PluginInput } from '@opencode-ai/plugin';
import type { HandoffState } from './state';

const COMMAND_NAME = 'handoff';

/**
 * The handoff command template that guides the AI in generating handoff
 * prompts.
 */
const HANDOFF_COMMAND_TEMPLATE = `Start a handoff worker session.

Use the user's request below as the source of truth for what the worker should do. Keep scope and emphasis exactly aligned with the user's request.

USER: $ARGUMENTS

Call handoff_session with the worker prompt and any clearly relevant files:
\`handoff_session(prompt="...", files=["src/foo.ts", "src/bar.ts", ...])\``;

/**
 * Creates a handoff command manager.
 *
 * Handles registration of the /handoff command and processing of chat
 * messages to inject synthetic file parts for handoff sessions.
 */
export function createHandoffCommandManager(
  _ctx: PluginInput,
  state: HandoffState,
  _processedSessions?: Set<string>,
) {
  /**
   * Register the /handoff command in the OpenCode config.
   */
  function registerCommand(opencodeConfig: Record<string, unknown>): void {
    const configCommand = opencodeConfig.command as
      | Record<string, unknown>
      | undefined;
    if (!configCommand?.[COMMAND_NAME]) {
      if (!opencodeConfig.command) {
        opencodeConfig.command = {};
      }
      (opencodeConfig.command as Record<string, unknown>)[COMMAND_NAME] = {
        description: 'Create a focused handoff prompt for a new session',
        template: HANDOFF_COMMAND_TEMPLATE,
      };
    }
  }

  return {
    registerCommand,
    handleEvent(input: {
      event: {
        type: string;
        properties?: {
          info?: { id?: string; parentID?: string };
          sessionID?: string;
        };
      };
    }): void {
      if (input.event.type === 'session.created') {
        const info = input.event.properties?.info;
        if (!info?.id || !info.parentID) return;

        const source = state.sourceFor(info.parentID);
        if (source) state.markSession(info.id, source);
        return;
      }

      if (input.event.type !== 'session.deleted') return;
      const sessionID =
        input.event.properties?.info?.id ?? input.event.properties?.sessionID;
      if (sessionID) state.unmarkSession(sessionID);
    },
  };
}

export type HandoffCommandManager = ReturnType<
  typeof createHandoffCommandManager
>;
