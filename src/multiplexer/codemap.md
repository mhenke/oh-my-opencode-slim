# src/multiplexer/

## Responsibility

- Abstract terminal multiplexer integration behind a unified interface for background session visualization.
- Select the correct implementation based on configuration (`tmux`, `zellij`, `auto`, `none`) and runtime environment.
- Expose shared utilities required by task orchestration and health-gating logic.

## Design

- `types.ts` is the boundary contract:
  - `Multiplexer` (`spawnPane`, `closePane`, `applyLayout`, `isAvailable`, `isInsideSession`).
  - `PaneResult` and `MultiplexerFactory`.
  - `isServerRunning(serverUrl, timeoutMs, maxAttempts)` for shared health checks.
- `factory.ts` implements mode selection and instance creation in `getMultiplexer`:
  - direct construction for explicit `tmux`/`zellij`
  - environment-based fallback in `auto` (`TMUX` vs `ZELLIJ`, else disabled)
  - no caching: each call creates a fresh object to capture live environment (`TMUX_PANE` / `ZELLIJ`).
- `index.ts` re-exports factories and contracts and both concrete implementations.
- `startAvailabilityCheck` is a fire-and-forget availability preflight by calling `multiplexer.isAvailable()` asynchronously.
- `getAutoMultiplexerType` is a pure helper used by tests/diagnostics to determine current effective backend.

## Flow

- `src/index.ts` computes `multiplexerConfig`, creates a one-shot probe instance in init, and starts `startAvailabilityCheck` for telemetry/log warming.
- Consumers request concrete objects via `getMultiplexer(config)` and must handle `null` when disabled.
- `MultiplexerSessionManager` consumes `spawnPane`, `closePane`, and `isServerRunning` in a unified lifecycle.
- Concrete implementations apply their own platform-specific pane semantics while sharing the same abstractions.

## Integration

- Used by `background/background-manager.ts` for feature-gating background pane support and by `background/multiplexer-session-manager.ts` for session lifecycle hooks.
- Implementations live in `src/multiplexer/tmux` and `src/multiplexer/zellij`; callers must pass `(sessionId, description, serverUrl, directory)`.
- Unit tests in `src/multiplexer/factory.test.ts` validate mode selection, `none` behavior, and `auto` environment precedence.
