#!/usr/bin/env bun
/**
 * Eval result reviewer.
 *
 * Sends failed eval outputs to the council for model-based grading.
 * Reads eval results, extracts failed cases, and sends them to an
 * OpenCode session for review.
 *
 * Usage:
 *   bun run eval-review --suite orchestrator-routing
 *   bun run eval-review --suite orchestrator-routing --latest
 *   bun run eval-review --results-path /path/to/results.json
 *
 * Requires a running OpenCode instance.
 */

import { parseArgs } from 'node:util';
import { createOpencodeClient } from '@opencode-ai/sdk';
import {
  loadEvalSuite,
  loadLatestResult,
  type EvalResult,
  type EvalSuiteResult,
} from '../evals/runner';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    suite: { type: 'string' },
    'results-path': { type: 'string' },
    latest: { type: 'boolean' },
    directory: { type: 'string' },
    timeout: { type: 'string' },
    url: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});

// ── Load results ─────────────────────────────────────────────────────

const RESULTS_DIR = join(import.meta.dir, '..', 'evals', 'results');

function loadResults(): EvalSuiteResult | null {
  if (values['results-path']) {
    try {
      const raw = readFileSync(values['results-path'], 'utf-8');
      return JSON.parse(raw) as EvalSuiteResult;
    } catch (err) {
      console.error(
        `Failed to read results: ${values['results-path']}`,
        err instanceof Error ? err.message : String(err),
      );
      return null;
    }
  }

  if (values.suite) {
    if (values.latest) {
      return loadLatestResult(values.suite);
    }

    // Find most recent result for this suite
    try {
      const entries = readdirSync(RESULTS_DIR)
        .filter((f) => f.startsWith(`${values.suite}-`) && f.endsWith('.json'))
        .sort()
        .reverse();

      if (entries.length === 0) {
        console.error(`No results found for suite: ${values.suite}`);
        return null;
      }

      const raw = readFileSync(join(RESULTS_DIR, entries[0]), 'utf-8');
      return JSON.parse(raw) as EvalSuiteResult;
    } catch {
      console.error(`No results found for suite: ${values.suite}`);
      return null;
    }
  }

  console.error(
    'Usage: bun run eval-review --suite <name> [--latest] or --results-path <path>',
  );
  return null;
}

const results = loadResults();
if (!results) process.exit(1);

// ── Filter failed evals ──────────────────────────────────────────────

const failed = results.results.filter((r) => !r.passed && r.runs > 0);
if (failed.length === 0) {
  console.log('All evals passed! Nothing to review.');
  process.exit(0);
}

console.log(`\nReviewing ${failed.length} failed evals from ${results.suiteName}:`);
console.log('');

// ── Connect to OpenCode ──────────────────────────────────────────────

const directory = values.directory ?? process.cwd();
const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : 7_200_000; // 2 hours
const baseUrl = values.url ?? 'http://localhost:4096';

const client = createOpencodeClient({ baseUrl, directory });

try {
  const status = await client.session.status();
  if (status.error) {
    console.error('Failed to connect to OpenCode:', status.error);
    process.exit(1);
  }
  console.log('Connected to OpenCode\n');
} catch (err) {
  console.error(
    'Cannot connect to OpenCode. Is it running?',
    err instanceof Error ? err.message : String(err),
  );
  process.exit(1);
}

// ── Build review prompt ──────────────────────────────────────────────

function buildReviewPrompt(failed: EvalResult[], suiteName: string): string {
  const evalSuite = loadEvalSuite(suiteName);
  const evalMap = new Map((evalSuite?.evals ?? []).map((e) => [e.id, e]));

  const sections = failed.map((r) => {
    const evalCase = evalMap.get(r.evalId);
    const assertions = r.assertions
      .filter((a) => !a.passed)
      .map(
        (a) =>
          `- ${a.assertion.type}: "${a.assertion.value}" — ${a.assertion.description}${a.evidence ? ` (${a.evidence})` : ''}`,
      )
      .join('\n');

    return `### Eval: ${r.evalId}
**Prompt:** ${r.prompt}
**Agent:** ${evalCase?.agent ?? 'unknown'}
**Pass rate:** ${(r.passRate * 100).toFixed(0)}% across ${r.runs} runs

**Failed assertions:**
${assertions || '(none)'}

**Agent output (last run):**
\`\`\`
${(r.output ?? '(no output)').slice(0, 2000)}
\`\`\`
`;
  });

  return `You are reviewing eval results for an AI agent orchestration system.

Review each failed eval below. For each one:
1. **Diagnose**: Why did it fail? Is the assertion too strict, the task ambiguous, or did the agent genuinely fail?
2. **Grade**: Rate the agent's output on a scale of 1-5 (1=terrible, 5=excellent)
3. **Recommend**: What should change? Options:
   - Fix the agent (prompt/config change needed)
   - Fix the eval (assertion too strict, task ambiguous)
   - Accept the failure (correct behavior, eval is wrong)

Output your review as JSON:
\`\`\`json
{
  "reviews": [
    {
      "evalId": "...",
      "diagnosis": "...",
      "grade": 1-5,
      "recommendation": "fix_agent | fix_eval | accept_failure",
      "details": "..."
    }
  ],
  "summary": "Overall assessment of eval suite health"
}
\`\`\`

---

${sections.join('\n---\n\n')}`;
}

// ── Send to council ──────────────────────────────────────────────────

async function reviewWithCouncil(
  prompt: string,
): Promise<{
  success: boolean;
  response: string;
  error?: string;
  sessionId?: string;
  timedOut?: boolean;
}> {
  try {
    // Create session
    const createResult = await client.session.create({
      body: { title: 'eval-review' },
      query: { directory },
    });

    if (createResult.error) {
      const err = createResult.error as { data?: { message?: string }; message?: string };
      return {
        success: false,
        response: '',
        error: err.data?.message ?? err.message ?? 'session create failed',
      };
    }

    const sessionId = createResult.data.id;

    // Send prompt with council agent
    const promptPromise = client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        agent: 'council',
      },
      query: { directory },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    );

    let result;
    try {
      result = await Promise.race([promptPromise, timeoutPromise]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === 'timeout') {
        // Leave the session running so the user can retrieve the result.
        return {
          success: false,
          response: '',
          error: 'timeout',
          sessionId,
          timedOut: true,
        };
      }
      await client.session.delete({ path: { id: sessionId } }).catch(() => {});
      return { success: false, response: '', error: message };
    }

    if (result.error) {
      const err = result.error as { data?: { message?: string }; message?: string };
      await client.session.delete({ path: { id: sessionId } }).catch(() => {});
      return {
        success: false,
        response: '',
        error: err.data?.message ?? err.message ?? 'prompt failed',
      };
    }

    // Extract text
    const parts = result.data.parts ?? [];
    const textParts = parts.filter(
      (p: { type: string }) => p.type === 'text',
    ) as Array<{ type: 'text'; text: string }>;
    const responseText = textParts.map((p) => p.text).join('\n');

    await client.session.delete({ path: { id: sessionId } }).catch(() => {});
    return { success: true, response: responseText };
  } catch (err) {
    return {
      success: false,
      response: '',
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ── Run review ───────────────────────────────────────────────────────

console.log('Sending failed evals to council for review...');
console.log('This may take several minutes for complex reviews. Please wait...\n');

const reviewPrompt = buildReviewPrompt(failed, results.suiteName);
const review = await reviewWithCouncil(reviewPrompt);

if (!review.success) {
  if (review.timedOut) {
    const mins = Math.round(timeoutMs / 60000);
    console.error(`⏱ Review timed out after ${mins} minutes.`);
    console.error(
      `The council agent is likely still generating a response in OpenCode session: ${review.sessionId}`,
    );
    console.error(
      `Re-run with a larger --timeout (e.g. --timeout 7200000) to let it finish, or open that session to read the result.`,
    );
    process.exit(2);
  }
  console.error('Review failed:', review.error);
  process.exit(1);
}

console.log('═══ Council Review ═══\n');
console.log(review.response);

// Save review
const reviewPath = join(
  RESULTS_DIR,
  `${results.suiteName}-review-${new Date().toISOString().replace(/[:.]/g, '-')}.md`,
);
const { writeFileSync, mkdirSync } = await import('node:fs');
mkdirSync(RESULTS_DIR, { recursive: true });
writeFileSync(reviewPath, review.response);
console.log(`\nReview saved to: ${reviewPath}`);
