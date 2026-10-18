# Acceptance 1613 — Conversation semantics seam (mutation-evidence workflow)

**PROVENANCE**: This acceptance test covers the conversation semantics of the mutation-evidence workflow (parent: #1613, issue #1615). It exercises word resolution, target resolution, pick UX, Unresolved discipline, fix batching, and state re-rendering rules defined in the spec.

**DIRECTIVE** — run it live, no questions

You ARE the session under test. The mutation-evidence skill (`mutation-evidence`) provides the `audit`, `critique`, `fix`, and `baseline` commands. You exercise the behavior through real OpenCode runs of `bun run mutation:sweep` and the skill's routing logic. Never simulate skill output — use actual tooling.

All work happens in this repository worktree with the mutation-evidence skill active.

## Preconditions (verify from filesystem, never from simulated output)

1. Loaded tree is this worktree: the skill `mutation-evidence` is active at
   `.agents/skills/mutation-evidence/SKILL.md`.
2. Build is fresh: in the worktree run `bun install && bun run build`, then
   confirm the mutation-evidence skill loads without errors.
3. Grep-string sanity: run `bun src/mutation-evidence/report.ts reports/mutation/mutation.json` 
   and confirm it re-renders the saved report without a new sweep.

**One-time setup** — pin the log and prepare probe files:

```bash
L=$(ls -t ~/.local/share/opencode/log/oh-my-opencode-slim.*-$PPID.log 2>/dev/null | head -1)
[ -n "$L" ] || L=$(ls -t ~/.local/share/opencode/log/oh-my-opencode-slim.*.log | head -1)
echo "$L"

W=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
mkdir -p "$W/tmp-acceptance-1613"

# Probe files for word-resolution scenarios
printf 'one two three\nfour five six\nseven eight nine ten\n' > "$W/tmp-acceptance-1613/probe-basic.ts"

# Probe file for target-resolution change-set scenarios
printf '// mutation targets go here\nimport test from "node:test"\nimport assert from "node:assert"\n\ntest("basic assertion", () => {\n  assert.equal(1, 1)\n})\n' > "$W/tmp-acceptance-1613/probe-targets.ts"
```

---

## Scenario 1 — Word: exact match

**Goal**: When the user says exactly one of the four words (`audit`, `critique`, `fix`, `baseline`), that word is used as-is. No nearest-word fallback.

1. `audit` → resolves to `audit` (exact match).
2. `critique` → resolves to `critique` (exact match).
3. `fix` → resolves to `fix` (exact match).
4. `baseline` → resolves to `baseline` (exact match).

**PASS criterion**: each word resolves to itself, no nearest-word interpolation.

**evidence**: log line mentioning the resolved word and that it was used as-is (no "nearest" substitution).

---

## Scenario 2 — Word: nearest-word fallback

**Goal**: When the user's word is not exact, the nearest word is selected:
- `criteria` → `critique`
- `fixes` → `fix`
- `compare` → `audit`
- Any other word → the whole session (audit, then critique, then fix).

Two words fit → ask once only; a later command includes the earlier phases.

1. User says `criteria` → resolves to `critique` (nearest).
2. User says `fixes` → resolves to `fix` (nearest).
3. User says `compare` → resolves to `audit` (nearest).
4. User says `something-else` → resolves to the whole session: audit, then critique, then fix (ask once only).
5. User says `audit critique` (two words fit) → ask once to disambiguate; the ask must happen before any phase runs.

**PASS criterion**: `criteria` → `critique`, `fixes` → `fix`, `compare` → `audit`, unknown → whole session with ask-once.

**evidence**: log line mentioning the resolved word and the nearest-word mapping.

---

## Scenario 3 — Word: no word → whole session

**Goal**: When the user speaks nothing (or gives no recognized word), the full session runs: audit, then critique, then fix.

1. User says nothing → runs audit, then critique, then fix in order.
2. A later `fix` command after `audit` includes the earlier phases (i.e., `fix` alone does not re-run audit/critique; only the explicit sequence does).

**PASS criterion**: bare invocation runs all three phases in order; later single-word commands do not re-run earlier phases.

**evidence**: log line showing the three-phase sequence started.

---

## Scenario 4 — Target: conversation about

**Goal**: When the conversation is already about a specific file or change, that is the target. The skill should not ask again.

1. If the current discussion is about `probe-basic.ts`, then `audit` targets `probe-basic.ts`.
2. If the current discussion is about a PR #123, then `audit` targets the files in that PR.

**PASS criterion**: target is the file/change the conversation is already about, no "ask" step.

**evidence**: log line mentioning the target was resolved from the conversation context.

---

## Scenario 5 — Target: last sweep's file set

**Goal**: If no conversation context establishes a target, the last sweep's file set (`reports/mutation/mutation.json`) is used.

1. Run a sweep → a baseline is claimed.
2. Subsequent `audit` without conversation context → targets the last sweep's file set.

**PASS criterion**: target falls back to last sweep's file set when no conversation context exists.

**evidence**: log line mentioning the target was the last sweep's file set.

---

## Scenario 6 — Target: ask when unresolved

**Goal**: If neither conversation context nor last sweep's file set establishes a target, ask the user.

1. No conversation context, no last sweep → prompt: "Which file or change should I audit?"
2. User responds with a file or change → target is resolved.

**PASS criterion**: when ambiguous, the system asks once and uses the user's answer.

**evidence**: log line mentioning the ask occurred and was answered.

---

## Scenario 7 — Target: change sets resolve to files with sibling tests

**Goal**: When a user names a change (branch, PR, uncommitted work, commit range), it resolves to its files that have tests. Stryker mutates whole files; when the change is narrower than its file, say so.

1. User names branch `feature/login` → resolves to files in that branch that have sibling test files.
2. If a change touches only `utils/helpers.ts` but that file has no test → it is excluded from the target set; the system says so.

**PASS criterion**: change sets resolve only to files with sibling tests; files without tests are excluded with a warning.

**evidence**: log line mentioning the change-set resolution and any excluded files.

---

## Scenario 8 — Pick UX: survivors grouped by shared boundary

**Goal**: When `critique` or `fix` presents survivors, they are grouped by shared boundary (e.g., semantic cluster, mutation type). The user picks some or all.

1. 730 survivors → presented as clusters, not a wall.
2. User picks a subset → only those are processed; unpicked stay unreviewed.
3. User picks all → all are processed.

**PASS criterion**: survivors are grouped; user picks some or all; the UI groups them by boundary.

**evidence**: log line mentioning the number of survivor clusters and the user's picks.

---

## Scenario 9 — Unresolved discipline: endorsed verdict only

**Goal**: `Unresolved` means the user looked and deferred. Silence is never recorded as a verdict. Unpicked survivors stay unreviewed and are counted.

1. User picks a survivor and chooses `Unresolved` → recorded as a rationale-endorsed verdict.
2. User ignores a survivor → it stays unreviewed; the run reports how many are unreviewed.
3. `Unresolved` is never the default for silence; it must be an explicit choice with a rationale.

**PASS criterion**: `Unresolved` only appears when the user explicitly endorsed it; silence produces no disposition line.

**evidence**: log line mentioning an `Unresolved` verdict with a rationale, and a count of unreviewed survivors.

---

## Scenario 10 — Fix batching: killing tests land first, then one re-sweep

**Goal**: `fix` lands the killing tests for `Detected` survivors, then re-sweeps once. `newly-killed` against the baseline is the proof.

1. User picks survivors with `Detected` verdict → killing tests are landed.
2. After the picked set is done, `bun run mutation:sweep -- <files>` runs once (the re-sweep).
3. The re-sweep shows `newly-killed` lines against the baseline; no existing entry is changed.

**PASS criterion**: killing tests land; one re-sweep runs; `newly-killed` is visible against the baseline.

**evidence**: log line mentioning killing tests landed, re-sweep ran, and `newly-killed` appeared.

---

## Scenario 11 — State questions re-render without sweeping

**Goal**: Asking for the state (e.g., `bun src/mutation-evidence/report.ts reports/mutation/mutation.json`) re-renders the saved report with no new sweep.

1. User asks "what's the state?" → `bun src/mutation-evidence/report.ts reports/mutation/mutation.json` runs and shows the saved report; no new sweep is triggered.
2. The report includes baseline, ledger, and survivor groupings.

**PASS criterion**: state query re-renders the report; no sweep is spawned.

**evidence**: log line mentioning the report was rendered without a new sweep starting.

---

## Reporting

End with exactly this table (evidence = `$L` line numbers via `grep -n ... "$L"`:

```
Scenario | PASS/FAIL/INCONCLUSIVE | evidence (log line numbers)
1 - exact word | | 
2 - nearest word | | 
3 - no word | | 
4 - target: conversation | | 
5 - target: last sweep | | 
6 - target: ask | | 
7 - target: change sets | | 
8 - pick UX: grouped | | 
9 - Unresolved discipline | | 
10 - fix batching | | 
11 - state re-render | | 
```

Plus one line: any precondition that failed, and the `$L` path used.

---

## Reference

- Skill: `.agents/skills/mutation-evidence/SKILL.md` — word and target routing.
- State: `reports/mutation/baselines/` (baseline per file set), `docs/mutation-ledger.json` (human memory).
- Four evidence questions: semantic difference, reachability, observable difference, detection.
- Dispositions: `Detected`, `Equivalent-under-preconditions`, `Unreachable-under-invariant`, `Unresolved`.
- Score: `Timeout` counts as detected; slow-under-mutant named before calling anything a hang.