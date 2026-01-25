# src/config/

Manages the OpenCode Slim plugin configuration surface (constants, schema, loader helpers, and agent/MCP defaults) and exposes a cohesive API for the rest of the app.

## Responsibility

- `constants.ts` defines agent name enums, default models, and polling/time settings that serve as the canonical runtime defaults for every subprocess.
- `schema.ts` captures the zod-based structure of user/project configs (agents, presets, MCP toggles, tmux options), enabling rigorous validation for every entry point.
- `loader.ts`, `agent-mcps.ts`, and `utils.ts` orchestrate reading, merging, and overriding those configs, plus discovering custom agent prompts and MCP availability.

## Design

- Schemas: re-exported zod helpers keep shape/typing centralized (`AgentOverrideConfigSchema`, `PluginConfigSchema`, `McpNameSchema`, etc.), so validation and inference travel with exports.
- Override helpers: `getAgentOverride` handles legacy aliases and layered agent configs; `DEFAULT_AGENT_MCPS` + `parseList` provide wildcard/exclusion semantics for MCP selection.
- Loader patterns: `deepMerge` recursively merges nested maps (agents/tmux) while letting arrays/primitives be replaced, and the loader chains user, project, and preset configs with environment overrides to preserve precedence.

## Flow

- `loadPluginConfig` is the entry point: it reads `~/.config/opencode/oh-my-opencode-slim.json`, then `<project>/.opencode/oh-my-opencode-slim.json`, deep-merges agents/tmux objects, and replaces top-level arrays with project-specific values.
- Environment overrides (`OH_MY_OPENCODE_SLIM_PRESET`) are applied after the merge, and any preset name resolves via `config.presets` with a warning if missing.
- `loadAgentPrompt` layers user-supplied `{agent}.md` and `_append` files from the prompts directory, so custom prompts can replace or extend defaults without touching code.
- `getAgentMcpList` pulls agent-level overrides (via `getAgentOverride`) before falling back to `DEFAULT_AGENT_MCPS`, and `getAvailableMcpNames` filters the MCP schema by `disabled_mcps`.

## Integration

- `src/index.ts` invokes `loadPluginConfig` early in startup to feed runtime contexts (including tmux config) and imports `TmuxConfig` via re-export from `src/config/index.ts`.
- `src/config/index.ts` re-exports constants, schema types, loaders, and `getAgentOverride`, so any other workspace module needing config metadata or validators consumes this folder as a single surface.
- Defaults from `constants.ts` (poll intervals, `DEFAULT_MODELS`, agent aliases) propagate to orchestrator/subagent bootstrap and keep behavior consistent even when user configs are absent.
