import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  type Assertion,
  type EvalCase,
  type EvalResult,
  type EvalSuite,
  type EvalSuiteResult,
  type Transcript,
  EvalSuiteSchema,
} from './schema';

export type { EvalResult, EvalSuite, EvalSuiteResult, Transcript };

const EVALS_DIR = import.meta.dir;
const RESULTS_DIR = join(EVALS_DIR, 'results');
/** Eval repo root (two levels above src/evals) — base for file assertions */
const REPO_ROOT = resolve(EVALS_DIR, '..', '..');

// ── Loaders ──────────────────────────────────────────────────────────

export function loadEvalSuites(): EvalSuite[] {
  const suites: EvalSuite[] = [];
  const entries = readdirSync(EVALS_DIR, { withFileTypes: true });

  for (const entry of entries) {
    if (
      !entry.isDirectory() ||
      entry.name === 'results' ||
      entry.name === '__tests__'
    )
      continue;

    const suitePath = join(EVALS_DIR, entry.name, 'eval.json');
    try {
      const raw = readFileSync(suitePath, 'utf-8');
      const parsed = JSON.parse(raw);
      const suite = EvalSuiteSchema.parse(parsed);
      suites.push(suite);
    } catch {
      // Skip malformed suites
    }
  }

  return suites;
}

export function loadEvalSuite(name: string): EvalSuite | null {
  const suitePath = join(EVALS_DIR, name, 'eval.json');
  try {
    const raw = readFileSync(suitePath, 'utf-8');
    const parsed = JSON.parse(raw);
    return EvalSuiteSchema.parse(parsed);
  } catch {
    return null;
  }
}

// ── Assertions ───────────────────────────────────────────────────────

/**
 * Check a single assertion against agent output and/or transcript.
 *
 * @param assertion - the assertion to check
 * @param output - agent output text (for contains/not_contains/regex/structure)
 * @param transcript - optional transcript for tool_used/agent_routed checks
 */
export function checkAssertion(
  assertion: Assertion,
  output: string,
  transcript?: Transcript,
): { passed: boolean; evidence?: string } {
  switch (assertion.type) {
    case 'contains':
      return {
        passed: output.toLowerCase().includes(assertion.value.toLowerCase()),
        evidence: output.toLowerCase().includes(assertion.value.toLowerCase())
          ? undefined
          : `output did not contain "${assertion.value}"`,
      };

    case 'not_contains':
      return {
        passed: !output.toLowerCase().includes(assertion.value.toLowerCase()),
        evidence: !output.toLowerCase().includes(assertion.value.toLowerCase())
          ? undefined
          : `output contained "${assertion.value}"`,
      };

    case 'regex':
      try {
        const re = new RegExp(assertion.value, 'i');
        return {
          passed: re.test(output),
          evidence: re.test(output)
            ? undefined
            : `output did not match /${assertion.value}/`,
        };
      } catch {
        return {
          passed: false,
          evidence: `invalid regex: ${assertion.value}`,
        };
      }

    // tool_used: check transcript.toolCalls for the tool name
    case 'tool_used': {
      const toolCalls = transcript?.messages
        ?.flatMap((m) => m.toolCalls ?? [])
        ?? [];
      const used = toolCalls.some(
        (t) => t.name?.toLowerCase() === assertion.value.toLowerCase(),
      );
      return {
        passed: used,
        evidence: used
          ? undefined
          : `tool "${assertion.value}" not found in transcript (${toolCalls.length} tool calls recorded)`,
      };
    }

    // tool_not_used: assert tool was NOT called
    case 'tool_not_used': {
      const toolCalls = transcript?.messages
        ?.flatMap((m) => m.toolCalls ?? [])
        ?? [];
      const used = toolCalls.some(
        (t) => t.name?.toLowerCase() === assertion.value.toLowerCase(),
      );
      return {
        passed: !used,
        evidence: !used
          ? undefined
          : `tool "${assertion.value}" was used (${toolCalls.length} tool calls recorded)`,
      };
    }

    // files_modified: check output mentions the file
    case 'files_modified':
      return {
        passed: output.toLowerCase().includes(assertion.value.toLowerCase()),
        evidence: output.toLowerCase().includes(assertion.value.toLowerCase())
          ? undefined
          : `file "${assertion.value}" not mentioned in output`,
      };

    // file_contains: check a file under the eval repo root contains the value.
    // The path is resolved against REPO_ROOT (never the orchestrator cwd), so
    // the assertion stays deterministic regardless of where evals are run from.
    case 'file_contains': {
      if (!assertion.filePath) {
        return {
          passed: false,
          evidence: 'file_contains requires filePath to be set',
        };
      }
      const filePath = resolve(REPO_ROOT, assertion.filePath);
      try {
        const content = readFileSync(filePath, 'utf-8');
        const passed = content.includes(assertion.value);
        return {
          passed,
          evidence: passed
            ? undefined
            : `file "${assertion.filePath}" did not contain "${assertion.value}"`,
        };
      } catch (e) {
        return {
          passed: false,
          evidence: `file_contains: cannot read "${assertion.filePath}": ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // structure: output must match a structural pattern (e.g., has <summary> tag)
    case 'structure': {
      const passed = output.includes(assertion.value);
      return {
        passed,
        evidence: passed
          ? undefined
          : `structural pattern "${assertion.value}" not found`,
      };
    }

    // references_read: requires referenceContent for meaningful verification
    case 'references_read': {
      const uniqueContent = assertion.referenceContent
        ? [assertion.referenceContent].flat().map((s) => s.toLowerCase())
        : [];

      if (uniqueContent.length === 0) {
        return {
          passed: false,
          evidence: 'references_read requires referenceContent to be set',
        };
      }

      const lowerOutput = output.toLowerCase();
      const hasReferenceRead = uniqueContent.some((content) =>
        lowerOutput.includes(content),
      );
      return {
        passed: hasReferenceRead,
        evidence: hasReferenceRead
          ? undefined
          : `output does not contain reference-specific content`,
      };
    }

    // agent_routed: check transcript.agentInvocations for the agent name
    case 'agent_routed': {
      const invocations = transcript?.agentInvocations ?? [];
      const found = invocations.some(
        (i) => i.agent?.toLowerCase() === assertion.value.toLowerCase(),
      );
      return {
        passed: found,
        evidence: found
          ? undefined
          : `agent "${assertion.value}" not observed (agents: ${invocations.map((i) => i.agent).join(', ') || 'none'})`,
      };
    }

    // subagent_count: check number of unique agents invoked
    // value: JSON { "min": 1, "max": 3 } or just a number for exact count
    case 'subagent_count': {
      const invocations = transcript?.agentInvocations ?? [];
      const uniqueAgents = new Set(invocations.map((i) => i.agent));
      const count = uniqueAgents.size;
      try {
        const expected = JSON.parse(assertion.value) as { min?: number; max?: number } | number;
        if (typeof expected === 'number') {
          return {
            passed: count === expected,
            evidence: count === expected
              ? undefined
              : `expected ${expected} unique agents, got ${count} (${[...uniqueAgents].join(', ') || 'none'})`,
          };
        }
        const min = expected.min ?? 0;
        const max = expected.max ?? Infinity;
        const passed = count >= min && count <= max;
        return {
          passed,
          evidence: passed
            ? undefined
            : `expected ${min}-${max} unique agents, got ${count} (${[...uniqueAgents].join(', ') || 'none'})`,
        };
      } catch {
        return { passed: false, evidence: `subagent_count: invalid value format` };
      }
    }

    // background_task_completed: check if background tasks completed and reconciled
    // value: JSON { "min": 1 } or "true" for any completion
    case 'background_task_completed': {
      const invocations = transcript?.agentInvocations ?? [];
      // Check if any agent was invoked via background task (sessionId present suggests background)
      const backgroundTasks = invocations.filter((i) => i.sessionId);
      const completed = backgroundTasks.length > 0;
      return {
        passed: completed,
        evidence: completed
          ? undefined
          : `no background tasks observed (${invocations.length} invocations, 0 with sessionId)`,
      };
    }

    // state_check: verify environment state after the eval
    case 'state_check': {
      try {
        const expected = JSON.parse(assertion.value) as Record<string, unknown>;
        const actual = JSON.parse(output) as Record<string, unknown>;
        const mismatches: string[] = [];
        for (const [key, expectedValue] of Object.entries(expected)) {
          const actualValue = actual[key];
          if (JSON.stringify(actualValue) !== JSON.stringify(expectedValue)) {
            mismatches.push(
              `${key}: expected ${JSON.stringify(expectedValue)}, got ${JSON.stringify(actualValue)}`,
            );
          }
        }
        return {
          passed: mismatches.length === 0,
          evidence: mismatches.length > 0 ? mismatches.join('; ') : undefined,
        };
      } catch (e) {
        return {
          passed: false,
          evidence: `state_check failed to parse: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    // transcript_analysis: check transcript metrics
    case 'transcript_analysis': {
      try {
        const expected = JSON.parse(assertion.value) as Record<string, unknown>;
        const actual = JSON.parse(output) as Record<string, unknown>;
        const violations: string[] = [];

        if (typeof expected.maxTurns === 'number' && typeof actual.turnCount === 'number') {
          if (actual.turnCount > expected.maxTurns) {
            violations.push(`turns: ${actual.turnCount} > max ${expected.maxTurns}`);
          }
        }
        if (typeof expected.maxToolCalls === 'number' && typeof actual.toolCallCount === 'number') {
          if (actual.toolCallCount > expected.maxToolCalls) {
            violations.push(`tool calls: ${actual.toolCallCount} > max ${expected.maxToolCalls}`);
          }
        }
        if (typeof expected.maxInputTokens === 'number' && actual.tokens && typeof (actual.tokens as { input?: number }).input === 'number') {
          if ((actual.tokens as { input: number }).input > expected.maxInputTokens) {
            violations.push(`input tokens: ${(actual.tokens as { input: number }).input} > max ${expected.maxInputTokens}`);
          }
        }
        if (typeof expected.maxOutputTokens === 'number' && actual.tokens && typeof (actual.tokens as { output?: number }).output === 'number') {
          if ((actual.tokens as { output: number }).output > expected.maxOutputTokens) {
            violations.push(`output tokens: ${(actual.tokens as { output: number }).output} > max ${expected.maxOutputTokens}`);
          }
        }

        return {
          passed: violations.length === 0,
          evidence: violations.length > 0 ? violations.join('; ') : undefined,
        };
      } catch (e) {
        return {
          passed: false,
          evidence: `transcript_analysis failed to parse: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    }

    default:
      return { passed: false, evidence: `unknown assertion type` };
  }
}

// ── Execution ────────────────────────────────────────────────────────

/**
 * Run a single eval case with multiple output samples.
 * Returns pass rate across runs and per-assertion rates.
 *
 * @param evalCase - the eval case to run
 * @param outputs - array of output texts (one per run)
 * @param transcripts - optional array of transcripts (one per run)
 */
export function executeEvalCase(
  evalCase: EvalCase,
  outputs: string[],
  transcripts?: Transcript[],
): EvalResult {
  if (outputs.length === 0) {
    return {
      evalId: evalCase.id,
      prompt: evalCase.prompt,
      passed: false,
      runs: 0,
      passRate: 0,
      passAtK: 0,
      passKk: 0,
      assertions: evalCase.assertions.map((a) => ({
        assertion: a,
        passed: false,
        evidence: 'no outputs provided',
      })),
      error: 'no outputs provided',
    };
  }

  const assertionResults = evalCase.assertions.map((assertion) => {
    const runResults = outputs.map((out) => checkAssertion(assertion, out, transcripts?.[0]));
    const passCount = runResults.filter((r) => r.passed).length;
    const passRate = passCount / outputs.length;
    return {
      assertion,
      passed: passRate > 0.5, // majority passes
      passRate,
      evidence:
        passCount < outputs.length
          ? runResults.find((r) => !r.passed)?.evidence
          : undefined,
      score: passRate, // individual assertion score for partial credit
    };
  });

  const allPassed = assertionResults.every((a) => a.passed);

  // pass@k: likelihood of at least one success in k attempts
  // pass^k: probability all k trials succeed
  const passAtK = assertionResults.some((a) => a.passed) ? 1 : 0;
  const passKk = assertionResults.every((a) => a.passed) ? 1 : 0;

  // Partial credit: weighted average of assertion scores
  const totalWeight = assertionResults.reduce(
    (s, a) => s + (a.assertion.weight ?? 1),
    0,
  );
  const partialScore =
    totalWeight > 0
      ? assertionResults.reduce(
          (s, a) => s + (a.score ?? 0) * (a.assertion.weight ?? 1),
          0,
        ) / totalWeight
      : 0;

  // Use last transcript for inspection
  const transcript = transcripts && transcripts.length > 0
    ? transcripts[transcripts.length - 1]
    : undefined;

  return {
    evalId: evalCase.id,
    prompt: evalCase.prompt,
    passed: allPassed,
    runs: outputs.length,
    passRate:
      assertionResults.reduce((s, a) => s + a.passRate, 0) /
      assertionResults.length,
    passAtK,
    passKk,
    partialScore,
    assertions: assertionResults,
    output: outputs[outputs.length - 1], // keep last run for inspection
    transcript,
  };
}

/**
 * Execute an entire eval suite.
 *
 * @param suiteName - name of the suite to run
 * @param outputs - map of evalId → output text (or array of texts for multi-run)
 * @param transcripts - optional map of evalId → transcript array
 * @returns EvalSuiteResult with per-case pass rates
 */
export function executeSuite(
  suiteName: string,
  outputs: Record<string, string | string[]>,
  transcripts?: Record<string, Transcript[]>,
): EvalSuiteResult {
  const suite = loadEvalSuite(suiteName);
  if (!suite) {
    return {
      suiteName,
      totalEvals: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      passAtK: 0,
      passK: 0,
      results: [],
      durationMs: 0,
      timestamp: new Date().toISOString(),
    };
  }

  const startTime = Date.now();
  const results: EvalResult[] = [];

  for (const evalCase of suite.evals) {
    const raw = outputs[evalCase.id];
    const outputList =
      raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];

    if (outputList.length === 0) {
      results.push({
        evalId: evalCase.id,
        prompt: evalCase.prompt,
        passed: false,
        runs: 0,
        passRate: 0,
        passAtK: 0,
        passKk: 0,
        assertions: evalCase.assertions.map((a) => ({
          assertion: a,
          passed: false,
          evidence: `no output for eval "${evalCase.id}"`,
        })),
        error: `no output for eval "${evalCase.id}"`,
      });
    } else {
      const evalTranscripts = transcripts?.[evalCase.id];
      results.push(executeEvalCase(evalCase, outputList, evalTranscripts));
    }
  }

  const durationMs = Date.now() - startTime;
  const passed = results.filter((r) => r.passed).length;
  const failed = results.filter((r) => !r.passed && r.runs > 0).length;
  const skipped = results.filter((r) => r.runs === 0).length;

  // pass@k across the suite: proportion of evals where at least one run passed
  const passAtKSuite = results.filter((r) => r.passAtK === 1).length / results.length;
  // pass^k across the suite: proportion of evals where all runs passed
  const passKSuite = results.filter((r) => r.passKk === 1).length / results.length;
  // Average partial score across all evals with runs
  const evalsWithRuns = results.filter((r) => r.runs > 0);
  const avgPartialScore = evalsWithRuns.length > 0
    ? evalsWithRuns.reduce((s, r) => s + (r.partialScore ?? 0), 0) / evalsWithRuns.length
    : 0;

  return {
    suiteName,
    totalEvals: suite.evals.length,
    passed,
    failed,
    skipped,
    passAtK: passAtKSuite,
    passK: passKSuite,
    avgPartialScore,
    results,
    durationMs,
    timestamp: new Date().toISOString(),
  };
}

// ── Results I/O ──────────────────────────────────────────────────────

export function saveResults(
  suiteName: string,
  result: EvalSuiteResult,
): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filename = `${suiteName}-${timestamp}.json`;
  const filepath = join(RESULTS_DIR, filename);
  writeFileSync(filepath, JSON.stringify(result, null, 2));
  return filepath;
}

export function loadLatestResult(suiteName: string): EvalSuiteResult | null {
  try {
    const entries = readdirSync(RESULTS_DIR)
      .filter((f) => f.startsWith(`${suiteName}-`) && f.endsWith('.json'))
      .sort()
      .reverse();

    if (entries.length === 0) return null;

    const raw = readFileSync(join(RESULTS_DIR, entries[0]), 'utf-8');
    return JSON.parse(raw) as EvalSuiteResult;
  } catch {
    return null;
  }
}

// ── Display ──────────────────────────────────────────────────────────

export function formatResult(result: EvalSuiteResult): string {
  const lines: string[] = [
    `═══ ${result.suiteName} ═══`,
    `${result.passed}/${result.totalEvals} passed (${result.failed} failed, ${result.skipped} skipped)`,
    `pass@k: ${(result.passAtK * 100).toFixed(0)}%, pass^k: ${(result.passK * 100).toFixed(0)}%`,
    `partial score: ${((result.avgPartialScore ?? 0) * 100).toFixed(0)}%`,
    `Duration: ${(result.durationMs / 1000).toFixed(1)}s`,
    '',
  ];

  for (const r of result.results) {
    const icon = r.passed ? '✓' : r.runs === 0 ? '?' : '✗';
    const rate =
      r.runs > 0
        ? ` [${(r.passRate * 100).toFixed(0)}% across ${r.runs} runs]`
        : '';
    lines.push(`  ${icon} ${r.evalId}: ${r.prompt.slice(0, 60)}...${rate}`);

    if (!r.passed) {
      for (const a of r.assertions.filter((a) => !a.passed)) {
        lines.push(`    ✗ ${a.assertion.description}`);
        if (a.evidence) lines.push(`      ${a.evidence}`);
      }
    }
  }

  return lines.join('\n');
}

export function diffResults(
  baseline: EvalSuiteResult,
  current: EvalSuiteResult,
): string {
  const lines: string[] = [
    `═══ Delta: ${baseline.suiteName} ═══`,
    `Baseline: ${baseline.passed}/${baseline.totalEvals} passed`,
    `Current:  ${current.passed}/${current.totalEvals} passed`,
    '',
  ];

  const delta = current.passed - baseline.passed;
  if (delta > 0) lines.push(`↑ ${delta} more passing`);
  else if (delta < 0) lines.push(`↓ ${Math.abs(delta)} fewer passing`);
  else lines.push('→ No change');

  for (const base of baseline.results) {
    const curr = current.results.find((r) => r.evalId === base.evalId);
    if (!curr) continue;

    if (base.passed && !curr.passed) {
      lines.push(`  REGRESSION: ${base.evalId}`);
    } else if (!base.passed && curr.passed) {
      lines.push(`  IMPROVED: ${base.evalId}`);
    }
  }

  return lines.join('\n');
}
