/**
 * Post-Read nudge - appends a delegation reminder after file reads.
 * Catches the "read files → implement myself" anti-pattern.
 */

const NUDGE = "\n\n---\n⚡ Consider: delegate to specialist now? (When delegating, reference file paths/lines - don't copy file contents.)";

interface ToolExecuteAfterInput {
  tool: string;
  sessionID?: string;
  callID?: string;
}

interface ToolExecuteAfterOutput {
  title: string;
  output: string;
  metadata: Record<string, unknown>;
}

export function createPostReadNudgeHook() {
  return {
    "tool.execute.after": async (
      input: ToolExecuteAfterInput,
      output: ToolExecuteAfterOutput
    ): Promise<void> => {
      // Only nudge for Read tool
      if (input.tool !== "Read" && input.tool !== "read") {
        return;
      }

      // Append the nudge
      output.output = output.output + NUDGE;
    },
  };
}
