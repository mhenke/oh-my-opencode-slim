# src/background/

## Responsibility

- Hosts the services that run OpenCode agents outside the main conversation, keeping work progressing while users continue interacting in the foreground. `BackgroundTaskManager` orchestrates task lifecycle (session creation, prompt delivery, polling, result capture), and `TmuxSessionManager` surfaces child sessions inside tmux panes when enabled so operators see streaming updates.

## Design

- `BackgroundTaskManager` stores tasks in a `Map`, creates isolated sessions via the plugin client, applies agent variants/extensions, and polls session status/messages at configured intervals (`POLL_INTERVAL_BACKGROUND_MS`/`POLL_INTERVAL_SLOW_MS`) until completion or failure (see `background-manager.ts:66-165` and `background-manager.ts:218-313`).
- `TmuxSessionManager` listens for `session.created` hooks, spawns/closes panes with `spawnTmuxPane`/`closeTmuxPane`, and maintains per-session metadata plus polling/timeout logic to tear down stale panes (`tmux-session-manager.ts:30-205`).
- Both managers rely on shared config helpers (`applyAgentVariant`, `resolveAgentVariant`, `tmux` utils) and the plugin client/ directory context passed from the host plugin bootstrap (see `background-manager.ts:15-83`, `tmux-session-manager.ts:1-55`, and `index.ts`).

## Flow

- Launch: `launch()` creates a session under the parent ID, registers the task, optionally waits for tmux pane, resolves agent variant, then sends the prompt to the new session (`background-manager.ts:95-148`).
- Polling: a shared interval iterates running tasks, queries session status, fetches assistant messages only after the session becomes idle, and stores the aggregated result or error plus timestamps (`background-manager.ts:217-315`).
- Cancellation/Cleanup: `cancel()` marks tasks as failed with user-supplied reason; `TmuxSessionManager` closes panes when sessions time out or disappear, and exposes `cleanup()` for plugin shutdown (`background-manager.ts:187-215`, `tmux-session-manager.ts:89-205`).

## Integration

- Communicates with OpenCode’s plugin API client (`PluginInput`) for session creation, prompting, status, and messages; relies on the plugin config (`PluginConfig`, `TmuxConfig`) for model/variant overrides and tmux settings (`background-manager.ts` and `tmux-session-manager.ts`).
- When tmux is enabled, `TmuxSessionManager` is wired to the plugin’s event hook so it can spawn panes as soon as `session.created` events arrive (`tmux-session-manager.ts:57-115`).
- `index.ts` re-exports the managers so host code can import them together for plugin setup (`index.ts:1-6`).
