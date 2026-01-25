# src/agents/

## Responsibility

Hosts every OpenCode specialist agent plus the orchestrator definition that coordinates them. `index.ts` is responsible for instantiating each agent definition (model, temperature, prompt) using the folder-level factories, applying per-agent overrides from `config`, wiring in default permissions, and exposing helpers (`createAgents`, `getAgentConfigs`) consumed by the plugin runtime.

## Design

- Each specialist (`explorer`, `librarian`, `oracle`, `designer`, `fixer`) is defined in its own file. They share the `AgentDefinition` shape from `orchestrator.ts`, configure temperature/model, and build a default prompt that can be replaced or appended with custom content.
- `orchestrator.ts` also hosts the central prompt template that defines the delegation workflow, the role descriptions, and the policy for when to spin up specialists. That template plus the shared `createOrchestratorAgent` helper keep the orchestrator bundle self-contained.
- The module follows a factory + post-processing pattern: `SUBAGENT_FACTORIES` maps names to creators, `createAgents` builds proto-agents, then decorates them with overrides, permissions, and the orchestrator definition before returning the full roster.
- Permission helpers (`applyOverrides`, `applyDefaultPermissions`) enforce consistent runtime metadata (model, temperature, skill permissions) while keeping authorization logic separate from factory instantiation.

## Flow

1. `createAgents(config?)` is the entry point. It determines the fallback models (fixer inherits librarian’s model when undefined), loads any custom prompts, then instantiates each subagent via `SUBAGENT_FACTORIES`.
2. Each proto agent passes through `applyOverrides` (model/temperature) and `applyDefaultPermissions`, which merges configured skill permissions from `getSkillPermissionsForAgent` and always allows the `question` permission.
3. The orchestrator is built last with `createOrchestratorAgent`, honoring its own prompt overrides before default permissions/override logic runs again.
4. `getAgentConfigs(config?)` turns the roster into a record keyed by agent name, attaches descriptions, includes MCPs via `getAgentMcpList`, and flags `mode` (subagent vs primary) based on `isSubagent`.

## Integration

- Depends on the shared config layer (`../config` and `../config/agent-mcps`) for default models, override data, custom prompts, and MCP routing decisions.
- Hooks into `../cli/skills` to fetch skill-specific permissions for each agent so the orchestrator can enforce runtime guardrails without hardcoding skill lists here.
- Consumers (plugin entrypoints/runtime) import `createAgents`/`getAgentConfigs` to register agents with the OpenCode SDK; the orchestrator prompt mentions the specialists and guides delegation.
- Specialist agents themselves are mostly self-contained (hardcoded prompts + simple factory) but are composed and configured through this folder’s public API before being surfaced to the rest of the system.
