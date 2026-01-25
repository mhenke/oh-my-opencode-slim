# src/tools/

The `src/tools/` directory exposes the command-and-control helpers agents rely on when they need to search the repository (grep/AST), interrogate the language server, or orchestrate long-running background work.

## Responsibility

- `index.ts` re-exports the AST-grep helpers, RG-backed `grep`, LSP helpers, and the quota tool so that callers can import a single entry point for tooling.
- `background.ts` wires up the `background_task`, `background_output`, and `background_cancel` tools that plugin agents use to launch, monitor, and cancel background jobs (sync or async) while automatically managing sessions and metadata.

## Design

- Tools are built via `@opencode-ai/plugin`'s `tool` schema; each tool declares arguments/descriptions plus an `execute` body that is sandboxed by the plugin framework.
- `background_task` supports both async launches (delegating to `BackgroundTaskManager.launch`) and a sync path that pipelines through helper functions (`resolveSessionId`, `sendPrompt`, `pollSession`, `extractResponseText`).
- Session helpers encapsulate concerns like reusing parent directories, applying agent variants (via `applyAgentVariant`), disabling recursive tools in prompts, and formatting responses with `<task_metadata>` for consumers.
- Polling uses configuration constants (`MAX_POLL_TIME_MS`, `POLL_INTERVAL_MS`, `STABLE_POLLS_THRESHOLD`) to decide when a session has stabilized, while cancel/output helpers rely on the `BackgroundTaskManager` API.

## Flow

- `background_task` validates `toolContext`, then either launches a background job through `manager.launch` (async) or calls `executeSync` (sync).
- `executeSync`: resolve/create a session, send the agent prompt (with recursive tools disabled), poll the session status/messages until idle/stable, fetch messages, extract assistant parts, and wrap the final text with metadata before returning.
- `background_output` fetches stored task state via `manager.getResult`, summarizes metadata/duration, and appends raw result or error depending on the task status.
- `background_cancel` pauses ongoing tasks either globally (`all=true`) or for a specific `task_id` by delegating to `manager.cancel`.

## Integration

- Relies on the plugin `ctx` (session client) to create/get sessions, send prompts, read statuses/messages, and logs via `../utils/logger`.
- Uses shared configuration across the repo (`../config`, schema definitions, `SUBAGENT_NAMES`, timeouts) plus helper utilities like `applyAgentVariant`/`resolveAgentVariant` to honor agent overrides.
- Accepts optional `tmuxConfig` and `PluginConfig` so the session creation/prompt logic respects tmux-managed panes and agent variant settings.
- `index.ts` also exports `antigravity_quota` and the LSP helpers, so higher-level modules can wire grepping, AST-grep, and diagnostics together with background tooling through this directory.
