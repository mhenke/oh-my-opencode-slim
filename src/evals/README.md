# Evaluations

Test orchestrator routing and quality without running the full model.

## How It Works

Two-step process: collect outputs, then score them.

## Step 1: Collect Outputs

### Automated (recommended)

```bash
bun run auto-collect --suite orchestrator-routing --out /tmp/outputs.json
```

Connects to a running OpenCode instance, runs each prompt through the agent, and captures outputs automatically.

Options:
- `--suite <name>` — eval suite to run (required)
- `--out <path>` — output file (default: `/tmp/<suite>-outputs.json`)
- `--runs <N>` — collect N responses per eval for pass@k (default: 1)
- `--directory <path>` — OpenCode project directory (default: cwd)
- `--timeout <ms>` — per-prompt timeout in ms (default: 300000 = 5 min)
- `--concurrency <N>` — parallel prompts (default: 3)

### Manual (interactive)

```bash
bun run collect --suite orchestrator-routing --out /tmp/outputs.json
```

Shows each eval prompt. For each one:
1. Copy the prompt into a fresh OpenCode session
2. Get the response
3. Paste it back
4. End with `.` on its own line

## Step 2: Score Them

```bun run eval --suite orchestrator-routing --outputs-file /tmp/outputs.json
```

## Step 3: Review Failures (optional)

Send failed evals to the council for model-based grading:

```bash
bun run eval-review --suite orchestrator-routing
```

The council reviews each failed eval, diagnoses why it failed, grades the agent's output (1-5), and recommends whether to fix the agent, fix the eval, or accept the failure.

Options:
- `--suite <name>` — suite to review
- `--latest` — use the most recent result
- `--results-path <path>` — specific results JSON file
- `--directory <path>` — OpenCode project directory

## Available Suites

- `orchestrator-routing` — Does the orchestrator route to the right agent?
- `fixer-execution` — Does the fixer produce correct output?

## Precheck

Validate eval suites before running:

```bash
bun run precheck
```

## Notes

- You can't run eval without first running collect (or manually creating the JSON file)
- Results are saved to `src/evals/results/`

## Advanced Metrics

### pass@k and pass^k

This eval suite now tracks two additional metrics per the [Anthropic evals roadmap](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents):

- **pass@k**: The likelihood that at least one run succeeds across k attempts. A score of 50% pass@1 means the model succeeds on half the tasks on its first try.
- **pass^k**: The probability that all k trials succeed. This is essential for agents where consistency matters (e.g., customer-facing agents where users expect reliable behavior every time).

At k=1, pass@1 and pass^k are identical. By k=10, they diverge: pass@k approaches 100% while pass^k falls to very low values.

### Transcript Review

Regularly reading eval transcripts is critical for evaluating whether your graders are working well. When a task fails, the transcript tells you whether the agent made a genuine mistake or whether your graders rejected a valid solution. It also surfaces key details about agent and eval behavior.

Failures should seem fair: it should be clear what the agent got wrong and why. When scores don't climb, read transcripts to verify the eval is measuring what actually matters.

### Saturation Monitoring

An eval at 100% tracks regressions but provides no signal for improvement. **Eval saturation** occurs when an agent passes all of the solvable tasks, leaving no room for progress. As teams hill-climb on capability evals, it's important to also run regression evals to make sure changes don't cause issues elsewhere.

When an eval suite approaches saturation (near 100% pass rate), consider:
- Graduating capability evals to become a continuous regression suite
- Adding more difficult tasks to the suite
- Tracking per-task pass rates to identify which behaviors still need improvement

### Example: Interpreting pass@k vs pass^k

| k | pass@k | pass^k (if per-trial success = 75%) |
|---|--------|-------------------------------------|
| 1 | 75% | 75% |
| 3 | 93% | 42% |
| 10 | ~100% | 5.6% |

This table illustrates why both metrics matter: pass@k shows "one success is enough," while pass^k shows "consistent success across all attempts."

## Available Commands