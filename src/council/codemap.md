# src/council/

## Responsibility

- Orchestrate multi-agent council sessions by running configured councillors and synthesizing outputs with a master model.
- Provide a configurable, defensive decision path for model-based consensus, including depth guarding and graceful degradation when partial failures occur.

## Design

- `src/council/index.ts` is a barrel export; implementation is in `council-manager.ts`.
- `CouncilManager` is injected with `PluginInput`, optional `PluginConfig`, optional `SubagentDepthTracker`, and multiplexer settings.
- Presets and schema are defined in `config/council-schema.ts` (`default_preset`, councillor/master timeout, retry rules, execution mode).
- Uses shared formatting/parsing helpers from `utils/session.ts` so councillor/master prompting stays consistent with other session tools.

## Flow

- `runCouncil(prompt, presetName, parentSessionId)`:
  - Validate depth limit and resolve preset.
  - Abort early for missing config, unknown preset, or empty councillor set.
  - Send a lightweight start notification into the parent session.
  - Run councillors in configured mode (`parallel`/`serial`) with per-councillor timeout and retries.
  - Aggregate completed responses; if none succeed, return failure.
  - Run master synthesis on success; if master fails, fallback to a single completed councillor response with context.

## Integration

- Used by `createCouncilTool` in the tools layer for explicit user-triggered council sessions.
- Depends on `SubagentDepthTracker` to prevent runaway nested delegation.
- Reuses the same OpenCode session API contract (`client.session`) as background tasks and other agent orchestration modules.
