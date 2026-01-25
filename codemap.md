# Repository Atlas: oh-my-opencode-slim

## Project Responsibility
Provides an OpenCode plugin that orchestrates specialist agents, background task execution, tooling (grep/AST/LSP/quota), MCP connectors, and lifecycle hooks, plus a CLI installer that bootstraps user configuration and skill setup.

## System Entry Points
- `src/index.ts`: Plugin entrypoint that registers agents, tools, MCPs, hooks, and configuration hooks with OpenCode.
- `src/cli/index.ts`: CLI entry that dispatches to the installer workflow.
- `package.json`: Dependency manifest and build/runtime scripts.
- `tsconfig.json`: TypeScript compiler configuration.

## Repository Directory Map
| Directory | Responsibility Summary | Detailed Map |
| --- | --- | --- |
| `src/` | Main plugin entrypoint plus all feature modules that compose agents, tools, hooks, background managers, and utils. | [View Map](src/codemap.md) |
| `src/agents/` | Defines specialist agents and the orchestrator, with factories and override/permission helpers. | [View Map](src/agents/codemap.md) |
| `src/background/` | Background task/session managers and tmux pane orchestration for off-thread agent runs. | [View Map](src/background/codemap.md) |
| `src/cli/` | Installer CLI flow, config edits, provider setup, and skill installation helpers. | [View Map](src/cli/codemap.md) |
| `src/config/` | Plugin configuration schemas, defaults, loaders, and MCP/agent override helpers. | [View Map](src/config/codemap.md) |
| `src/hooks/` | Re-exported hook factories and option types for lifecycle hooks. | [View Map](src/hooks/codemap.md) |
| `src/hooks/auto-update-checker/` | Startup update check hook with cache invalidation and optional auto-install. | [View Map](src/hooks/auto-update-checker/codemap.md) |
| `src/hooks/phase-reminder/` | Orchestrator message transform hook that injects phase reminders. | [View Map](src/hooks/phase-reminder/codemap.md) |
| `src/hooks/post-read-nudge/` | Read tool after-hook that appends delegation nudges. | [View Map](src/hooks/post-read-nudge/codemap.md) |
| `src/mcp/` | Built-in MCP registry and config types for remote connectors. | [View Map](src/mcp/codemap.md) |
| `src/tools/` | Tool registry plus background task tool implementations. | [View Map](src/tools/codemap.md) |
| `src/tools/ast-grep/` | AST-grep CLI discovery, execution, and tool definitions. | [View Map](src/tools/ast-grep/codemap.md) |
| `src/tools/grep/` | Ripgrep/grep runner, downloader, and tool definition. | [View Map](src/tools/grep/codemap.md) |
| `src/tools/lsp/` | LSP client stack and tool surface for definitions, diagnostics, and rename. | [View Map](src/tools/lsp/codemap.md) |
| `src/tools/quota/` | Antigravity quota fetcher and CLI tool output formatter. | [View Map](src/tools/quota/codemap.md) |
| `src/utils/` | Shared helpers for variants, tmux, polling, logging, and zip extraction. | [View Map](src/utils/codemap.md) |
