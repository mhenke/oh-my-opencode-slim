type AgentPermission = Record<
  string,
  'allow' | 'ask' | 'deny' | Record<string, 'allow' | 'ask' | 'deny'>
>;

/**
 * Strict read-only tool permissions for advisory agents.
 *
 * Start with wildcard deny so newly-added tools are unavailable by default,
 * then allow only inspection/search tools. Explicitly deny known mutating and
 * delegation tools to make the read-only boundary obvious in generated config.
 */
export function createReadOnlyAgentPermission(): AgentPermission {
  return {
    '*': 'deny',
    bash: 'deny',
    edit: 'deny',
    write: 'deny',
    apply_patch: 'deny',
    ast_grep_replace: 'deny',
    task: 'deny',
    question: 'deny',
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    lsp: 'allow',
    list: 'allow',
    codesearch: 'allow',
    ast_grep_search: 'allow',
  } as AgentPermission;
}

/**
 * Full coding-tool permissions for the main orchestrator agent.
 *
 * The orchestrator delegates most work but must be able to handle one
 * isolated, clear, low-risk action directly (per its own prompt), so the
 * standard coding and communication tools are allowed. No wildcard deny:
 * unlisted tools keep OpenCode defaults (e.g. `todowrite` stays usable).
 */
export function createOrchestratorPermission(): AgentPermission {
  return {
    read: 'allow',
    glob: 'allow',
    grep: 'allow',
    list: 'allow',
    lsp: 'allow',
    codesearch: 'allow',
    ast_grep_search: 'allow',
    edit: 'allow',
    write: 'allow',
    apply_patch: 'allow',
    ast_grep_replace: 'allow',
    bash: 'allow',
    webfetch: 'allow',
    task: 'allow',
    question: 'allow',
    cancel_task: 'allow',
    wait_for_user: 'allow',
  } as AgentPermission;
}

/**
 * Strict deny-all permissions for the council synthesis agent.
 *
 * The council agent is text-in/text-out only — it must NOT use any
 * file-inspection tools. Councillors already perform codebase exploration;
 * the council only reconciles their text output.
 */
export function createSynthesisOnlyPermission(): AgentPermission {
  return {
    '*': 'deny',
    bash: 'deny',
    edit: 'deny',
    write: 'deny',
    apply_patch: 'deny',
    ast_grep_replace: 'deny',
    task: 'deny',
    question: 'deny',
    read: 'deny',
    glob: 'deny',
    grep: 'deny',
    lsp: 'deny',
    list: 'deny',
    codesearch: 'deny',
    ast_grep_search: 'deny',
  } as AgentPermission;
}
