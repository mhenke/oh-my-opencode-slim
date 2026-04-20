# src/hooks/foreground-fallback/

## Responsibility

- Keep foreground (interactive) sessions alive when rate limiting is detected by switching the same session to the next model in a configured fallback chain and re-prompting asynchronously.

## Design

- `index.ts` exports `ForegroundFallbackManager` and `isRateLimitError`.
- `ForegroundFallbackManager` tracks per-session state in maps:
  - `sessionModel`, `sessionAgent`, `sessionTried`, `lastTrigger`, `inProgress`.
- `isRateLimitError(error)` performs regex checks over `{ message, data.statusCode, data.message, data.responseBody }`.
- `handleEvent` is the event dispatcher for `message.updated`, `session.error`, `session.status`, `subagent.session.created`, `session.deleted`.
- `resolveChain(agentName, currentModel)` defines deterministic chain choice (agent-specific > inferred from current model > flattened fallback).
- `tryFallback` performs dedupe (`DEDUP_WINDOW_MS`), aborts stale attempts, selects next untried model, fetches last user message, calls `session.abort()`, then `session.promptAsync()` with same user parts and new model.

## Flow

1. Every relevant event arrives at `handleEvent`.
2. On suspected rate-limit signal, `handleEvent` calls `tryFallback(sessionID)`.
3. `tryFallback` skips if in-progress, duplicate within 5s, or no candidate chain.
4. It resolves the active chain, marks attempted models (`sessionTried`), parses `provider/model` with `parseModel`, and fetches last user message via `client.session.messages`.
5. If a user message exists, it aborts current turn with `session.abort`, then re-issues using `promptAsync` with parsed model.
6. Success updates `sessionModel`; `session.deleted` path clears all per-session maps.

## Integration

- Integrated through `src/index.ts` into global plugin event stream.
- Consumes `PluginInput['client']` session APIs and reads fallback chain configuration from plugin startup composition.
- Works in parallel to background fallback logic in task manager without altering core session scheduling.
