# Hotspot Mutation Hardening — `src/index.ts` and `foreground-fallback`

Status: approved design (2026-10-15) · Lane: `omos/stryker` ·
Evidence: Stryker sweep of the last month's top-churn files + skeptic review
(`SkepticIndexSplit`, AMEND FIRST verdict, amendments folded in below).

## Problem

The last month's top-churn files measure poorly under mutation testing:

| Rank | File | Mutants | Score | Survived | No coverage |
|------|------|---------|-------|----------|-------------|
| 1 | `src/index.ts` | 1,094 | 40.5% | 383 | 268 |
| 4 | `src/hooks/foreground-fallback/index.ts` | 2,550 | 64.4% | 728 | 180 |

`src/index.ts` (3,327 lines, 126 commits/month) is one async factory wiring
25+ subsystems; its 5,742-line test never executes 268 mutant regions.
`foreground-fallback` (3,398 lines) has an 8,745-line test that still lets 728
behavioral changes through. For contrast, tightly-tested `src/config/schema.ts`
scores 78.8%.

## Goal

Both files reach **zero unexplained mutants**: every mutant is killed, a
timeout, or disabled with a written reason (`// Stryker disable <mutator> --
<reason>`); no-coverage count is 0. No numeric score threshold.

## Non-goals

- No behavior changes to plugin functionality. The split is structure-only.
- Rank 6 (`src/v2/setup.ts`, 29.4%, 755 no-coverage) is queued for later work,
  not in this spec.
- No new DI framework, no config flags, no compatibility shims.

## Part 1 — Split `src/index.ts` (rank 1)

Thin composition root + ~10 `register*(deps)` units under `src/plugin/`,
following the existing factory convention (`createTaskSessionManagerHook(ctx,
{...})` at `src/index.ts:1157`).

### Boundaries

Units (~10, finalized against the file during planning; seams already visible
in the import map): model-chain publication, cache-monitor/cache-safety
registration, orchestrator-wake scheduler wiring, permission-rules + v2
bridges, background-job board + terminal gate, marketplace, session
bookkeeping cluster, MCP + tools + TUI-state registration.

### Invariants (skeptic amendments, binding)

- **A1 — Shared state, named pattern.** ~90 factory-scope bindings cross
  regions; JS cannot pass a `let` by reference. One explicit shared-state
  holder (`PluginState` object with the in-repo box/getter pattern — cf.
  `backgroundDefaultFlip.isArmed`, `isDisposed` closures) threads the ~20
  truly cross-region bindings. No ad-hoc per-unit boxes.
- **A2 — Transform composition stays in `src/index.ts`.** The
  `experimental.chat.messages.transform` region (`src/index.ts:3146–3278`)
  remains in the root as a named region; the cache-safety drift guard
  (`src/hooks/cache-safety.property.test.ts:439`) is never edited. index.ts
  ends at ~200 lines, not zero.
- **A3 — Tripwire coverage.** Add `'plugin'` to `SCAN_DIRS` in
  `src/cache-safety-tripwire.test.ts`; allowlist the moved toast debounce
  (`lastImageRetainedToastByDir`, module-level state that must stay
  module-level — `src/index.ts:223, 3223–3241`) with justification.
- **A4 — Hook-key disjointness.** Each unit's contribution is typed
  `satisfies Pick<Hooks, K>` with disjoint keys so spreads cannot silently
  collide (the single literal's duplicate-key check is lost otherwise).
- **A5 — Ordering invariants held in the root:** wake scheduler created after
  task-session-manager (`653–663`), `cacheMonitor` outside the try
  (`358–363`), `marketplaceService` after `hostFlavor` (`1741–1743`),
  catch-path disposal of `terminalGate`/`admissionRuntimeLease`/
  `eventDirectoryScope` (`1627–1630`).
- **A6 — Chain publication moves as a domain method.**
  `publishChainGeneration` becomes a `ForegroundFallbackManager` method;
  `buildChainGeneration`/`selectDelegatedModel` move beside it as tested pure
  functions (they have zero test references today); the never-rebind
  invariant (`680–684`) is preserved; `foreground-fallback/codemap.md`
  updates in the same change.
- **A7 — Export surface frozen.** `dist/index.d.ts` diffs empty before/after;
  export statements stay verbatim in `src/index.ts` (verified surface:
  default `{id, server, setup}`, `OhMyOpenCodeLite`,
  `HARD_PROFILE_REFRESH_WARNING_KINDS`, `V2ProfileRefreshResult`, type
  re-exports).
- **A8 — Sequencing.** Split lands (with amended fences) as its own effort;
  the mutation loop is a separate, later effort. Green suite is necessary,
  not sufficient — the suite is what this work exists to strengthen.

### Cycle guard

Chain-helper relocation verified acyclic (skeptic C3): helpers are
module-private, type-only deps, no reverse edge from foreground-fallback.

## Part 2 — `foreground-fallback` (rank 4): tests-first, extraction on evidence

No big-bang split of the manager. The mutation loop runs first against the
existing test; pure decision functions are extracted only where survivor
clusters prove the need. Candidate order (from codemap density):

1. Detection/classification: `isFailoverError`, `failoverScope`,
   `extractStatusCode`, `isPermanentQuotaBillingError`, `isSpentQuotaError`
2. Chain selection skip-rules
3. Retry-budget accounting
4. Dedup identity matching

Each extraction: pure module (no host client) + table-driven tests covering
the codemap's precedence rules. The 180 no-coverage regions are reached
through the manager surface or extracted and tested directly.

## Mutation workflow (both files)

Scoped per-unit runs: `mutate` + `bun.testFiles` pointed at the unit's
covering tests (whole-suite dry runs fail from cross-file state leakage —
documented in `docs/mutation-testing.md`). Every mutant ends killed, timeout,
or disabled with reason. The bar is per unit, enforced before moving on.

## Verification gates

Per phase: `bun run check:ci`, `bun run typecheck`, `bun test` green;
cache-safety property + snapshot + tripwire green (with A3 amendment);
`dist/index.d.ts` diff empty across the split.

## Docs

Root `codemap.md` + `src/hooks/foreground-fallback/codemap.md` updated with
the new structure; `docs/mutation-testing.md` already documents the scoped
run recipe. AGENTS.md only if commands change (none planned).
