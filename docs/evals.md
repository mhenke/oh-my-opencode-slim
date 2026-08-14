# Evaluations

Test orchestrator routing, agent delegation, and code quality against real agent behavior.

> **Note:** The eval infrastructure currently lives on the `new-rules` worktree
> branch (`.slim/worktrees/new-rules/`). The commands below assume you are
> running them from that worktree, where the `eval` scripts are defined in
> `package.json`. The scripts are not yet available in the main repo.

## Prerequisites

**OpenCode must be running in headless mode.** Auto-collect connects to the OpenCode SDK to run prompts through the agent.

```bash
# Terminal 1: Start headless OpenCode server
cd ~/Projects/oh-my-opencode-slim/.slim/worktrees/new-rules
opencode serve
```

Wait for the server to start (you'll see the OpenCode banner). Then in another terminal:

```bash
# Terminal 2: Run evals
cd ~/Projects/oh-my-opencode-slim/.slim/worktrees/new-rules
bun run auto-collect --suite orchestrator-routing --out /tmp/routing.json
```

## Quick Start

```bash
# Run all 4 suites (recommended)
bun run eval:all

# Or run one suite at a time:
bun run auto-collect --suite orchestrator-routing --out /tmp/routing.json
bun run eval --suite orchestrator-routing --outputs-file /tmp/routing.json
```

### Step by step

```bash
# 1. Start OpenCode server (must be running)
opencode serve

# 2. Collect outputs
bun run auto-collect --suite orchestrator-routing --out /tmp/routing.json

# 3. Score them
bun run eval --suite orchestrator-routing --outputs-file /tmp/routing.json

# 4. Review failures (optional)
bun run eval-review --suite orchestrator-routing
```

## Step 1: Collect Outputs

### Automated (recommended)

```bash
bun run auto-collect --suite <name> --out <path>
```

Connects to a running OpenCode instance, runs each prompt through the agent, and captures outputs + transcripts.

**Required**: `opencode serve` must be running in another terminal.

Options:
- `--suite <name>`: eval suite to run (required)
- `--out <path>`: output file (default: `/tmp/<suite>-outputs.json`)
- `--runs <N>`: collect N responses per eval for pass@k (default: 1)
- `--directory <path>`: OpenCode project directory (default: cwd)
- `--timeout <ms>`: per-prompt timeout in ms (default: 300000 = 5 min)
- `--concurrency <N>`: parallel prompts (default: 3)
- `--delay <ms>`: delay between batches in ms (default: 0)
- `--url <url>`: OpenCode server URL (default: http://localhost:4096)

**Rate limit tips**: If using free-tier models, run sequentially with delays:
```bash
bun run auto-collect --suite fixer-execution --out /tmp/fixer.json --concurrency 1 --delay 30000
```

### Manual (interactive)

```bash
bun run collect --suite <name> --out <path>
```

Shows each eval prompt. For each one:
1. Copy the prompt into a fresh OpenCode session
2. Get the response
3. Paste it back
4. End with `.` on its own line

## Step 2: Score Them

```bash
bun run eval --suite <name> --outputs-file <path>
```

Options:
- `--suite <name>`: suite to score (required)
- `--outputs-file <path>`: outputs JSON from step 1
- `--flaky-threshold <N>`: exit code 2 if evals are flaky (default: 3 runs)

If a `*-transcripts.json` file exists alongside the outputs, it's loaded automatically.

## Step 3: Review Failures (optional)

```bash
bun run eval-review --suite <name>
```

Sends failed evals to the council for model-based grading. The council:
1. Diagnoses why each eval failed
2. Grades the agent's output (1-5)
3. Recommends: fix agent, fix eval, or accept failure

Options:
- `--suite <name>`: suite to review
- `--latest`: use the most recent result
- `--results-path <path>`: specific results JSON file
- `--url <url>`: OpenCode server URL

## Available Suites

| Suite | Evals | What it tests |
|-------|-------|---------------|
| `orchestrator-routing` | 11 | Which agent handles each request |
| `fixer-execution` | 4 | Bounded implementation tasks |
| `subagent-lifecycle` | 6 | Multi-agent orchestration dynamics |
| `agent-failure-regression` | 7 | Regression tests from real GitHub issues |

### orchestrator-routing

Tests that the orchestrator delegates to the correct specialist:
- Trivial edits → handled directly (no delegation)
- Multi-file implementation → @fixer
- Architecture decisions → @oracle
- External research → @librarian
- Codebase search → @explorer
- UI work → @designer
- Progressive disclosure → skill reference files

### fixer-execution

Tests that the fixer agent implements code correctly:
- No research delegation (implements directly)
- Output format (summary, changes, verification)
- Edge case handling (safeParseJson)
- Code quality (formatCurrency)

### subagent-lifecycle

Tests multi-agent orchestration dynamics:
- Fixer delegation (agent_routed: fixer)
- Explorer-then-fixer chains (multi-agent)
- Architecture routing (agent_routed: oracle)
- External research routing (agent_routed: librarian)
- No delegation for trivial questions
- Parallel multi-agent tasks

## Assertion Types

| Type | What it checks | Source |
|------|---------------|--------|
| `contains` | Output contains string (case-insensitive) | Output text |
| `not_contains` | Output does NOT contain string | Output text |
| `regex` | Output matches regex pattern | Output text |
| `structure` | Output contains structural pattern | Output text |
| `tool_used` | Agent called a specific tool | Transcript |
| `tool_not_used` | Agent did NOT call a tool | Transcript |
| `agent_routed` | Specific agent was invoked | Transcript |
| `subagent_count` | Number of unique agents in range | Transcript |
| `background_task_completed` | Background task has sessionId | Transcript |
| `references_read` | Agent read reference file (requires referenceContent) | Output text |
| `state_check` | Environment state matches expected | JSON output |
| `transcript_analysis` | Metrics within bounds (turns, tokens, etc.) | JSON output |

## Metrics

### pass@k and pass^k

- **pass@k**: Likelihood of at least one success in k attempts
- **pass^k**: Probability that all k trials succeed

At k=1 they're identical. By k=10 they diverge: pass@k → 100%, pass^k → 5.6%.

### Partial Credit

Assertions can have weights. The `partialScore` is a weighted average of assertion scores (0-1).

### Flaky Detection

With `--flaky-threshold 3`, exit code 2 if any eval has pass@k=1 but pass^k=0 across 3+ runs.

## Precheck

Validate eval suites before running:

```bash
bun run precheck
```

## Results

Results are saved to `src/evals/results/` with timestamps:
- `<suite>-<timestamp>.json`: full results with pass@k/pass^k
- `<suite>-<timestamp>-transcripts.json`: transcripts with tool calls
- `<suite>-review-<timestamp>.md`: council review of failures

## Notes

- `opencode serve` must be running for auto-collect to work
- Free-tier models may hit rate limits. Use `--concurrency 1 --delay 30000`
- Transcript file is auto-loaded when it exists alongside outputs
- Exit code 0 = all pass, 1 = some failed, 2 = flaky detected

## For Developers

This document covers running evals. If you are working on the eval code
itself (adding suites, modifying the runner, writing assertions), see
[`src/evals/README.md`](../src/evals/README.md) for the architecture, the
eval.json schema, and how to extend the system.
