import { collapseSystemInPlace } from './system-collapse';

/**
 * Apply the orchestrator system prompt injection for serve-mode sessions.
 *
 * Places the orchestrator prompt AFTER existing system[0] content (AGENTS.md)
 * so the user's behavioral rules retain their intended priority. Skips
 * injection if the orchestrator prompt is already present in any system entry.
 *
 * This is a pure function extracted from the plugin hook for testability.
 * The hook in src/index.ts calls this and then passes through any sub-hooks.
 */
export function applyOrchestratorPrompt(
  system: string[],
  agentName: string | undefined,
  orchestratorPrompt: string,
): void {
  if (agentName === 'orchestrator') {
    const alreadyInjected = system.some(
      (s) =>
        typeof s === 'string' &&
        s.includes('<Role>') &&
        s.includes('orchestrator'),
    );
    if (!alreadyInjected) {
      system[0] = system[0]
        ? `${system[0]}\n\n${orchestratorPrompt}`
        : orchestratorPrompt;
    }
  }
  collapseSystemInPlace(system);
}
