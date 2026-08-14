# Eval Development

This document is for developers working on the eval code itself: adding
suites, modifying the runner, writing assertions. For user-facing commands
and options, see [docs/evals.md](../../docs/evals.md).

## Architecture

The eval system has three parts:

- **`schema.ts`**: Zod schemas for suites, eval cases, assertions, and
  transcripts. Every `eval.json` is validated against these at load time.
- **`runner.ts`**: Loads suites, runs assertions against agent output and
  transcripts, computes pass@k / pass^k and partial credit, writes results
  to `results/`.
- **CLI scripts in `src/cli/`**: `auto-collect.ts` (run prompts through a
  live OpenCode server), `collect.ts` (manual collection), `eval.ts`
  (scoring), `eval-review.ts` (council grading of failures), `precheck.ts`
  (suite validation).

Data flow: `auto-collect` produces an outputs JSON, `eval` scores it against
the suite's assertions, results land in `src/evals/results/` with
timestamps.

## File Structure

```
src/evals/
├── runner.ts              # Suite loading, assertion checks, scoring
├── schema.ts              # Zod schemas for suites, cases, assertions
├── README.md              # This file
├── results/               # Timestamped results and transcripts
├── __tests__/             # Runner tests (eval.test.ts)
└── <suite-name>/          # One directory per suite
    └── eval.json          # The suite definition
src/cli/
├── auto-collect.ts        # Automated prompt collection
├── collect.ts             # Manual prompt collection
├── eval.ts                # Scoring
├── eval-review.ts         # Council review of failures
└── precheck.ts            # Suite validation
```

## Adding a New Eval Suite

1. Create a directory `src/evals/<suite-name>/`.
2. Add an `eval.json` following `EvalSuiteSchema`:

```json
{
  "name": "my-suite",
  "description": "What this suite tests",
  "category": "capability",
  "evals": [
    {
      "id": "my-eval-1",
      "prompt": "The prompt to run through the agent",
      "agent": "orchestrator",
      "assertions": [
        {
          "type": "contains",
          "value": "expected text",
          "description": "What this assertion checks"
        }
      ]
    }
  ]
}
```

3. Run `bun run precheck` to validate the schema.
4. Collect and score using the commands in [docs/evals.md](../../docs/evals.md).

No registration needed. The runner scans directories under `src/evals/` for
`eval.json` and loads whatever it finds.

## Adding an Assertion Type

1. Add the type to the enum in `AssertionSchema` in `schema.ts`.
2. Add a `case` for it in `checkAssertion` in `runner.ts`. The case gets the
   assertion, the agent output text, and the transcript. Transcript-based
   checks (like `tool_used` and `agent_routed`) read from the transcript.
3. Add a test in `src/evals/__tests__/eval.test.ts`.
4. Update the assertion table in [docs/evals.md](../../docs/evals.md).

## Notes

- Suites are validated against the schema at load time. Malformed suites are
  skipped silently, so run `precheck` after editing an `eval.json`.
- Assertions support `weight` for partial credit scoring. The `partialScore`
  is a weighted average of assertion scores.
- The suite `category` distinguishes capability evals (start at low pass
  rate) from regression evals (target ~100%).
