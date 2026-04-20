# src/hooks/

This directory exposes the public hook entry points that feature code imports to tap into behavior such as workflow reminders, error recovery, rate-limit fallback, and delegation guidance.

## Responsibility

Acts as the central export surface for all runtime hooks in `src/hooks/*`, so callers can register feature behavior from one namespace (`src/hooks/index.ts`) without depending on subfolder internals.

## Design

- **Aggregator/re-export pattern**: `src/hooks/index.ts` re-exports hook factories, classes, and types from submodules.
- **Factory architecture**: Every feature module exports a `create*Hook` factory and returns an object implementing one or more OpenCode lifecycle surfaces (`tool.execute.before`, `tool.execute.after`, message/system transforms, `event`, command handlers).
- **Submodule boundary**: Each behavior class/function set is isolated in a folder (`auto-update-checker/`, `foreground-fallback/`, etc.) with a local `index.ts` shim.
- **Typed hook contracts**: The exported signatures use concrete OpenCode plugin types where available (`PluginInput`) and strict internal helper shapes for internal state.

## Flow

1. Consumers import from `src/hooks/index.ts` (e.g. `createTodoContinuationHook`, `createPhaseReminderHook`).
2. Plugin initialization in `src/index.ts` invokes hook factories with `PluginInput` and optional config.
3. OpenCode dispatches lifecycle callbacks at tool, message, system, event, and command surfaces.
4. Each implementation mutates the provided payload (e.g., `output.output`, `output.messages`, `output.system`) or triggers client APIs.
5. Hook handlers produce side effects like retries, prompts, reminders, and metadata updates.

## Integration

- `createAutoUpdateCheckerHook`: lifecycle `event` (`session.created`) and startup `ctx.client.tui` notifications.
- `createApplyPatchHook`: `tool.execute.before` pre-processing for `apply_patch` arguments.
- `createDelegateTaskRetryHook`, `createJsonErrorRecoveryHook`, `createPostFileToolNudgeHook`, `createFilterAvailableSkillsHook`: primarily `tool.execute.after` / message-transform surfaces.
- `createPhaseReminderHook`, todo-continuation message system handlers: `experimental.chat.messages.transform` / `experimental.chat.system.transform`.
- `ForegroundFallbackManager`: wired to the global event stream for foreground fallback on rate-limit conditions.
- `createChatHeadersHook`, `processImageAttachments`: transport/attachments/header-level integrations.
- All submodules are consumed through `src/index.ts`, which also wires `auto-continue` command integration from `todo-continuation`.

### Hook Points

| Hook Point | Purpose | Hooks |
|------------|---------|-------|
| `'tool.execute.after'` | React to tool output after execution | `post-file-tool-nudge`, `delegate-task-retry`, `json-error-recovery` |
| `'experimental.chat.system.transform'` | Transform system prompts before API call | `post-file-tool-nudge` |
| `'experimental.chat.messages.transform'` | Transform messages before API call | `phase-reminder` |
| `'chat.headers'` | Add custom headers to API requests | `chat-headers` |
| Event handlers | React to OpenCode events | `foreground-fallback`, `post-file-tool-nudge` |

### Hook Implementations

#### **phase-reminder**
- **Location**: `src/hooks/phase-reminder/index.ts`
- **Purpose**: Injects workflow reminder before each user message for the orchestrator agent to combat instruction-following degradation.
- **Hook Point**: `'experimental.chat.messages.transform'`
- **Behavior**: Prepend reminder text to the last user message if agent is 'orchestrator' and message doesn't contain internal initiator marker.
- **Research**: Based on "LLMs Get Lost In Multi-Turn Conversation" (arXiv:2505.06120) showing ~40% compliance drop after 2-3 turns without reminders.

#### **post-file-tool-nudge**
- **Location**: `src/hooks/post-file-tool-nudge/index.ts`
- **Purpose**: Queues a delegation reminder after file reads/writes to catch the "inspect/edit files → implement myself" anti-pattern.
- **Hook Points**: `'tool.execute.after'`, `'experimental.chat.system.transform'`
- **Behavior**: Records a pending reminder when Read/Write tools run, consumes it once in the next system prompt transform without mutating persisted tool output, and clears stale pending markers on session deletion.

#### **chat-headers**
- **Location**: `src/hooks/chat-headers.ts`
- **Purpose**: Adds `x-initiator: agent` header for GitHub Copilot provider when internal initiator marker is detected.
- **Hook Point**: `'chat.headers'`
- **Behavior**: Checks for internal marker via API call, only applies to Copilot provider and non-Copilot npm model.
- **Caching**: Uses in-memory cache (max 1000 entries) to reduce API calls.

#### **delegate-task-retry**
- **Location**: `src/hooks/delegate-task-retry/`
- **Purpose**: Detects delegate task errors and provides actionable retry guidance.
- **Components**:
  - `hook.ts`: Main hook that detects errors and appends guidance.
  - `patterns.ts`: Defines error patterns and detection logic.
  - `guidance.ts`: Builds retry guidance messages with available options.
- **Hook Point**: `'tool.execute.after'`
- **Behavior**: Detects errors like missing `run_in_background`, invalid category/agent, unknown skills, and appends structured guidance.
- **Patterns**: 8 error types with specific fix hints and available options extraction.

#### **foreground-fallback**
- **Location**: `src/hooks/foreground-fallback/index.ts`
- **Purpose**: Runtime model fallback for foreground (interactive) agent sessions experiencing rate limits.
- **Hook Point**: Event-driven (not a standard hook point)
- **Behavior**:
  - Monitors `message.updated`, `session.error`, `session.status`, and `subagent.session.created` events.
  - Detects rate-limit signals via regex patterns.
  - Aborts rate-limited prompt via `client.session.abort()`.
  - Re-queues last user message via `client.session.promptAsync()` with fallback model.
  - Tracks tried models per session to avoid infinite loops.
  - Deduplicates triggers within 5-second window.
- **Fallback Chains**: Configurable per agent (e.g., `{ orchestrator: ['anthropic/claude-opus-4-5', 'openai/gpt-4o'] }`).
- **Cleanup**: Removes session state on `session.deleted` events.

#### **json-error-recovery**
- **Location**: `src/hooks/json-error-recovery/`
- **Purpose**: Detects JSON parse errors and provides immediate recovery guidance.
- **Components**:
  - `hook.ts`: Main hook that detects JSON errors and appends guidance.
  - `index.ts`: Re-exports hook and constants.
- **Hook Point**: `'tool.execute.after'`
- **Behavior**: Appends structured reminder when JSON parse errors are detected in tool output (excluding bash, read, glob, webfetch, etc.).
- **Patterns**: 8 regex patterns covering common JSON syntax errors.

### Dependencies

- **OpenCode SDK**: `@opencode-ai/plugin` (PluginInput type, client access)
- **OpenCode SDK**: `@opencode-ai/sdk` (Model, UserMessage types)
- **Internal Utils**: `hasInternalInitiatorMarker`, `SLIM_INTERNAL_INITIATOR_MARKER`
- **Internal Logger**: `utils/logger`

### Consumers

- Feature modules in `src/` import hook factories from `src/hooks/index.ts`.
- Plugin initialization in `src/index.ts` registers hooks with OpenCode's plugin system.
- No direct relations to deeper hook files from consumers (implementation details hidden).
