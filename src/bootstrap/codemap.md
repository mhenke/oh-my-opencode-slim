# src/bootstrap/

## Responsibility

Plugin-factory bootstrap modules extracted from `src/index.ts` (deep
bootstrap refactor). Each module owns one stage of plugin initialization;
`index.ts` remains the thin orchestrator that calls them in order:

1. `createSessionState(ctx)` — factory-local session metadata, TUI
   activity, and model-selection state
2. `bootProfile(ctx, hostFlavor)` — config load, `RuntimeConfig` seed,
   agent definitions
3. `createBackgroundJobs(ctx, deps)` — the background-job machinery
4. `createTools(ctx, deps)` — tool surface + built-in MCPs

## Design

### Key Components

| Module | Purpose | Exports |
|--------|---------|---------|
| `session-state.ts` | Session metadata, TUI activity, and model-selection state behind lazy `bind()` accessors | `createSessionState`, `SessionState` |
| `profile.ts` | Config load + agent-definition boot; v2 live inference-profile refresh | `bootProfile`, `refreshProfilesFromDisk`, `HARD_PROFILE_REFRESH_WARNING_KINDS`, `V2ProfileRefreshResult` |
| `background-jobs.ts` | Job board, admission lease, coordinator, supervisor, revived-run tracker, terminal gate, wake scheduler, task-session-manager hook, fallback manager | `createBackgroundJobs`, `BackgroundJobs` |
| `tools.ts` | Tool assembly with disabled-tools filter + built-in MCPs | `createTools` |

### session-state.ts

`createSessionState()` runs first, so it cannot close over values the
plugin factory assigns later (runtime, fallback manager, job board,
resolved registry, final host agent config). It reads them lazily via
`bind(deps)` thunk accessors; before `bind()` the getters report
undefined exactly like the former factory `let` declarations. Owns:

- `sessionMetadata` (`SessionMetadataStore` with LRU eviction),
  internal/compacting session-ID sets, v1 delegated intents (bounded
  pending queue), and v1 internal selection overrides
- TUI activity bookkeeping: `markTuiAgentActive`/`Inactive`,
  `clearTuiActivities`, and child→parent hydration against the persisted
  `sessionParents` index
- Model selection: `selectDelegatedModel` (child-chain entry matching
  the parent's live fallback: exact id → working provider → first
  non-exhausted provider), `resolveDelegatedModelForParent`,
  `lifecycleSelectionResolver` (host-persisted selection vs preserved
  internal continuation overrides), `resolvePrimaryModelFromFinalHostConfig`,
  and `resolveTuiVariantForModel`

### profile.ts

- `bootProfile(ctx, hostFlavor)`: loads the plugin config, seeds
  `RuntimeConfig.init`, reapplies any persisted runtime preset (it wins
  over the config-file preset and is re-merged into `config.agents` for
  legacy consumers), and builds the generation's agent definitions via
  `createAgents` / `getAgentConfigsFromDefinitions`. Also resolves
  marketplace package IDs, the display-name mention rewriter, and the
  host-flavor delegation wording.
- `refreshProfilesFromDisk()`: the v2 `v2.refreshProfiles` path. Re-reads
  config from disk and resolves ONLY the inference fields (model,
  variant, temperature, options) plus the sidebar projection;
  session-frozen surfaces (prompts, tools, permissions, skills, MCPs)
  are never rebuilt. A config load with
  `invalid-json`/`invalid-schema`/`read-error` warnings
  (`HARD_PROFILE_REFRESH_WARNING_KINDS`) aborts before any state swap;
  the discriminated `{ok, ...}` result means failures never claim
  success.

### background-jobs.ts

`createBackgroundJobs()` owns the entire background-job machinery;
construction order mirrors the original factory statement order:

- `BackgroundJobBoard` (optional evicted-session GC via
  `pruneEvictedHostSession`, registered same-tick with the
  pending-prune fence) and the per-directory `AdmissionRuntimeLease`
- `BackgroundJobCoordinator` as sole board writer; TUI reusable
  projection and launch-identity listeners
- `BackgroundJobTerminalGate` (stop-confirmation grace, revived-run
  baselines) and `BackgroundJobSupervisor` (wall-clock timeout + abort)
- `createRevivedRunTracker` with degraded-fallback re-emission through
  the wake scheduler on ownership release
- `ForegroundFallbackManager`: v1 replay fallback; v2 keeps only
  retry-hook steering (replays race the newer user turn) — plus the
  background observation handoff and concurrency `migrateTask`
- `createTaskSessionManagerHook`, `createAliasAuthority`,
  `createSessionRecovery`; the revived-run slots (`markRevivedRunPending`,
  `getRevivedContextFiles`, ...) are rebound once the hook exists
- `createOrchestratorWakeScheduler` plus terminal-outcome listeners for
  stopped-job recovery and terminal-publication wakes (with
  revived-tracker and first-publication ownership skips)

Returns a facade (`board`, `coordinator`, `supervisor`, `terminalGate`,
`revivedRunTracker`, `wakeScheduler`, `taskSessionManagerHook`,
`foregroundFallback`, `chains`, `sessionLifecycle`, `admissionLease`,
...) with disposal parity:

- `abort()` — init-catch teardown of the terminal gate + admission lease
- `dispose()` — gate, fallback timers, `server.instance.disposed` events
  for the hook and wake scheduler, and the process-global wake-gate
  clear when this was the last live instance
- `disposeProjection()` — retract this generation's TUI sections
- `disposeLease()` — release only this generation's ownership (final
  teardown deferred one macrotask so an immediate re-init retains
  active/queued calls)

### tools.ts

`createTools()` assembles the tool surface in original factory order:
built-in MCPs, ACP run, webfetch (model refs from config), the task tool
family (cancel/message/reply/result/revive/status), `wait_for_user`, the
AST-grep pair, then applies the `disabledTools` filter and returns
`toolCount` for the init health check (including the marketplace tools).
`mcps` is returned by reference: the registry bridge passes it as
`pluginMcps` and the config hook prunes/re-merges keys in place.
`shouldManageSession` (orchestrator membership or task-managed) is
hoisted here and shared by the cancel/revive/wait-for-user deps.

## Flow

Plugin-factory initialization order (see `src/codemap.md`):

```
createSessionState(ctx)           // before the init try-block
  └─ sessionState.bind({ getRuntime, getForegroundFallback, ... })
bootProfile(ctx, hostFlavor)      // config → RuntimeConfig → agent defs
createBackgroundJobs(ctx, deps)   // board → lease → coordinator → gate →
                                  // supervisor → tracker → fallback →
                                  // TSM hook → wake scheduler
... hooks, commands, interview, companion, registry bridge ...
createTools(ctx, deps)            // MCPs + tools + disabled filter
```

Init failure calls `jobs.abort()` before rethrowing.

## Integration

### Consumers

- `src/index.ts`: thin orchestrator; consumes all four facades and owns
  the remaining hooks/commands/interview/companion wiring, the health
  check, and the v2 registry bridge
- `src/v2/`: consumes `refreshProfilesFromDisk` via `v2.refreshProfiles`
  and shares the mutable `chains` map and the `mcps` reference with the
  registry bridge

### Dependencies

- `src/config/` (RuntimeConfig, loader, presets)
- `src/agents/` (createAgents, resolved registry, runtime projections)
- `src/hooks/` (task-session manager, orchestrator-wake, foreground
  fallback, session lifecycle)
- `src/utils/` (job board/coordinator/supervisor, terminal gate, TUI
  reusable projection, session metadata/status)
- `src/tools/`, `src/mcp/`, `src/tui-state.ts`, `src/admission-runtime.ts`
