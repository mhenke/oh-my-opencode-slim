# src/cli/

## Responsibility
- Serve as the installer CLI for oh-my-opencode-slim: `src/cli/index.ts` parses bun-CLI flags and routes to the install workflow, while `src/cli/install.ts` orchestrates interactive prompts, validation, skill installation, next-step messaging, and exit handling.
- Provide lightweight utilities (`types.ts`, `system.ts`, `paths.ts`, `config-manager.ts`, `config-io.ts`, `providers.ts`, `skills.ts`, `custom-skills.ts`) that encapsulate the configuration, provider, and skill-install responsibilities so `install.ts` remains focused on sequencing.

## Design Patterns
- Procedural command flow with helper primitives: `install.ts` keeps UI helpers (colored symbols, step printers) and step runners close together while delegating persistence and system checks to the re-exported `config-manager` modules.
- Configuration abstraction: `config-io.ts` (JSON/JSONC parsing, atomic writes, comment stripping) and `paths.ts` centralize file system paths so callers only express intent (`addProviderConfig`, `writeLiteConfig`, `disableDefaultAgents`).
- Provider/skill registries as data-driven definitions: `providers.ts` exports `CLIPROXY_PROVIDER_CONFIG`, `MODEL_MAPPINGS`, and `generateLiteConfig` that build presets from `RECOMMENDED_SKILLS`, while `custom-skills.ts` and `skills.ts` expose lists plus install helpers (`installSkill`, `installCustomSkill`).

## Flow
- CLI entry: `index.ts` slices `process.argv`, handles `--help` or `install`, and feeds `InstallArgs` into `install(args)`.
- `install.ts` branches between non-TUI (expects yes/no flags) and interactive modes: both call `runInstall`, which detects existing config, prints numbered steps, ensures OpenCode is installed, and updates configs/plugins.
- `runInstall` sequentially adds the plugin, disables default agents, adds cliproxy provider if requested, writes the lite config, installs recommended/custom skills, and then prints the summary/next steps; helper functions like `handleStepResult`, `formatConfigSummary`, and `printAgentModels` keep each responsibility isolated.
- Configuration helpers (`config-io.ts`) parse existing configs (JSON/JSONC, stripping comments), enforce atomic writes (temp + rename + backup), and expose detection helpers used in `runInstall` and interactive prompts.

## Integration
- Tightly coupled with OpenCode installation: calls `system.ts` to detect `opencode` (and eventually `tmux`) binaries before proceeding, and manipulates `~/.config/opencode/opencode.json{c}` via `paths.ts`/`config-io.ts`.
- Talks to provider/skill bundles: uses `providers.ts` to inject cliproxy configuration and build lite configs from `MODEL_MAPPINGS` plus external `DEFAULT_AGENT_MCPS`, installs `RECOMMENDED_SKILLS` via `npx skills add` (with optional `postInstallCommands`), and copies bundled `CUSTOM_SKILLS` into the user config directory.
- Exposes a single façade via `config-manager.ts`, which re-exports the config I/O, path helpers, provider setup, and system checks so `install.ts` can treat configuration updates atomically without duplicating path logic.
