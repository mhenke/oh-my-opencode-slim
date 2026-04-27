/**
 * Phase reminder hook retained for backwards-compatible hook wiring.
 *
 * The reminder now lives in the static orchestrator prompt. Injecting it into
 * every latest user message changed request content unnecessarily and could
 * interfere with provider prompt-cache reuse. Keeping this transform as a
 * no-op preserves the hook shape without mutating chat messages.
 */
import { PHASE_REMINDER_TEXT } from '../../config/constants';

export const PHASE_REMINDER = `<reminder>${PHASE_REMINDER_TEXT}</reminder>`;

interface MessageInfo {
  role: string;
  agent?: string;
  sessionID?: string;
}

interface MessagePart {
  type: string;
  text?: string;
  [key: string]: unknown;
}

interface MessageWithParts {
  info: MessageInfo;
  parts: MessagePart[];
}

/**
 * Creates the experimental.chat.messages.transform hook for phase reminder injection.
 * This hook runs right before sending to API, so it doesn't affect UI display.
 * Only injects for the orchestrator agent.
 */
export function createPhaseReminderHook() {
  return {
    'experimental.chat.messages.transform': async (
      _input: Record<string, never>,
      output: { messages: MessageWithParts[] },
    ): Promise<void> => {
      void output;
    },
  };
}
