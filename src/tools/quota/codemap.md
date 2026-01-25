# src/tools/quota/

Responsibility: expose the `antigravity_quota` tool that reads locally configured Antigravity/Gemini accounts, refreshes Google OAuth tokens, polls the Cloud Code quota endpoints, and formats a compact progress-bar view of each model’s remaining quota so OpenCode can present it on demand. The folder also prepares the desktop command file (`command.ts`) that surfaces the tool name, description, and invocation example for users.

## Responsibility

- Coordinates quota-checking for every account listed in the user’s Antigravity config, shielding the rest of the app from the OAuth/token refresh, quota fetching, and model filtering logic.

## Design

- `src/tools/quota/api.ts` contains the low-level orchestration: loading config paths defined relative to platform-specific config/data directories, refreshing tokens via `https://oauth2.googleapis.com/token`, optionally discovering a project via `loadCodeAssist`, and calling Cloud Code’s `fetchAvailableModels`. Results are normalized into `ModelQuota` objects (see `types.ts`) with percent completed, reset timers, and sorted names.
- `src/tools/quota/index.ts` wraps the API in the OpenCode plugin tool (`tool({ ... execute() { ... } })`), handles errors, provides deterministic defaults (e.g., fake `account-1` email), groups models into the Claude/Flash/Pro families, renders ASCII progress bars, and emits the quoted output block that must be displayed verbatim.
- `command.ts` ensures the contextual command file describing `antigravity_quota()` exists under the OpenCode command cache so the CLI can present the tool description and usage to users.
- Reusable types (`Account`, `AccountsConfig`, `ModelQuota`, etc.) live in `types.ts` and keep the API and tool layers aligned on data shapes.

## Flow

1. At runtime the tool loads `antigravity-accounts.json` from one of the configured paths; if missing, the tool immediately reports the paths it checked.
2. Each account’s refresh token is exchanged for an access token (`refreshToken`). If no `projectId` is provided, `loadCodeAssist` can supply one via the Cloud AI companion project metadata.
3. `fetchAvailableModels` returns quota data; entries matching the `EXCLUDED_PATTERNS` blacklist are dropped, the remaining ones are clamped to 0–100%, and their reset times are turned into human-friendly durations (`formatDuration`).
4. The tool groups models by quota family, computes padded names/pct values, renders `[filled/empty]` bars, and builds a `blocks` array that is ultimately joined into the final output string, prefixed with an error section if any accounts failed.
5. `command.ts` complements this flow by ensuring the CLI knows about `antigravity_quota` via the generated Markdown file so users can discover it.

## Integration

- Plugin registration: `index.ts` exports `antigravity_quota` via `tool` from `@opencode-ai/plugin`, making the quota view callable through OpenCode’s CLI/API surface.
- Config/read access: `api.ts` relies on `CONFIG_PATHS` derived from `os.platform()` and XDG conventions, reading `antigravity-accounts.json` and expecting `Account` objects with refresh tokens and optional project IDs.
- HTTP dependencies: every account invocation hits Google’s OAuth token endpoint and the CloudCode quota endpoints, so the tool depends on network connectivity and the `fetch` global (Node 18+ or polyfilled environment).
- Command discovery: `command.ts` writes to the user’s `~/.config/opencode/command/antigravity-quota.md` (or `%APPDATA%` on Windows) so the CLI automatically lists the tool and instructs on using `antigravity_quota()` without needing to inspect the code.
