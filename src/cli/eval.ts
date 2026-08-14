#!/usr/bin/env bun
// CLI for running eval suites and comparing agent outputs against expected results.
/**
 * CLI entry point for running eval suites.
 *
 * Usage:
 *   bun run eval [--suite <name>] --outputs-file <path>
 *   bun run eval [--suite <name>] --outputs-file /tmp/outputs.json
 *
 * --suite is optional: if exactly one eval suite exists it is used
 * automatically.
 *
 * outputs.json format:
 *   { "eval-id-1": "agent output text", "eval-id-2": ["run1", "run2"] }
 *
 * Each value is a single string or array of strings for multi-run.
 * Results are saved to src/evals/results/ and printed to stdout.
 *
 * If a transcripts file exists (outputs-transcripts.json), it will be
 * loaded automatically and included in the results.
 *
 * --flaky-threshold: exit with code 2 if any eval has pass@k=1 but pass^k=0
 * with at least N runs (default: 3). Catches inconsistent eval results.
 */

import { parseArgs } from 'node:util';
import {
  executeSuite,
  formatResult,
  loadEvalSuites,
  saveResults,
  type Transcript,
} from '../evals/runner';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    suite: { type: 'string' },
    'outputs-file': { type: 'string' },
    'flaky-threshold': { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});

if (!values.suite) {
  const suites = loadEvalSuites();
  if (suites.length === 1) {
    values.suite = suites[0].name;
  } else if (suites.length > 1) {
    console.error(
      `Multiple suites found: ${suites.map((s) => s.name).join(', ')}`,
    );
    console.error('Usage: bun run eval --suite <name> --outputs-file <path>');
    process.exit(1);
  } else {
    console.error('Usage: bun run eval --suite <name> --outputs-file <path>');
    process.exit(1);
  }
}

let outputs: Record<string, string | string[]> = {};

if (values['outputs-file']) {
  try {
    const raw = await Bun.file(values['outputs-file']).text();
    outputs = JSON.parse(raw);
  } catch (err) {
    console.error(
      `Failed to read outputs file: ${values['outputs-file']}`,
      err instanceof Error ? err.message : String(err),
    );
    process.exit(1);
  }
}

// Try to load transcripts if they exist
let transcripts: Record<string, Transcript[]> | undefined;
if (values['outputs-file']) {
  const transcriptPath = values['outputs-file'].replace(/\.json$/, '-transcripts.json');
  try {
    const raw = await Bun.file(transcriptPath).text();
    transcripts = JSON.parse(raw);
    console.log(`Loaded transcripts from ${transcriptPath}`);
  } catch {
    // Transcripts file doesn't exist, that's fine
  }
}

const result = executeSuite(values.suite, outputs, transcripts);
const formatted = formatResult(result);
console.log(formatted);

if (result.totalEvals > 0) {
  const savedPath = saveResults(values.suite, result);
  console.log(`\nResults saved to: ${savedPath}`);
}

// Flaky detection: exit code 2 if any eval is flaky
let exitCode = result.failed > 0 ? 1 : 0;
const flakyThreshold = values['flaky-threshold'] ? parseInt(values['flaky-threshold'], 10) : 3;

const flaky = result.results.filter(
  (r) => r.passAtK === 1 && r.passKk === 0 && r.runs >= flakyThreshold,
);

if (flaky.length > 0) {
  console.log(`\n⚠ ${flaky.length} flaky eval(s) detected (pass@k=1 but pass^k=0):`);
  for (const f of flaky) {
    console.log(`  - ${f.evalId}: ${f.runs} runs, ${f.passRate.toFixed(0)}% pass rate`);
  }
  exitCode = 2;
}

process.exit(exitCode);
