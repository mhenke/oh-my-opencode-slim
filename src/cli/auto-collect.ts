#!/usr/bin/env bun
/**
 * Automated eval output collector.
 *
 * Connects to a running OpenCode instance via the SDK, runs each eval
 * prompt through the agent, and writes outputs to a JSON file.
 *
 * Usage:
 *   bun run auto-collect --suite orchestrator-routing --out /tmp/outputs.json
 *   bun run auto-collect --suite fixer-execution --runs 3 --out /tmp/outputs.json
 *
 * Requires a running OpenCode instance. The SDK connects via HTTP.
 */

import { parseArgs } from 'node:util';
import { createOpencodeClient } from '@opencode-ai/sdk';
import { loadEvalSuite, loadEvalSuites, type Transcript } from '../evals/runner';

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    suite: { type: 'string' },
    out: { type: 'string' },
    runs: { type: 'string' },
    directory: { type: 'string' },
    timeout: { type: 'string' },
    concurrency: { type: 'string' },
    url: { type: 'string' },
  },
  strict: true,
  allowPositionals: false,
});

// ── Validate args ────────────────────────────────────────────────────

if (!values.suite) {
  const suites = loadEvalSuites();
  if (suites.length === 1) {
    values.suite = suites[0].name;
  } else if (suites.length > 1) {
    console.error(
      `Multiple suites found: ${suites.map((s) => s.name).join(', ')}`,
    );
    console.error('Usage: bun run auto-collect --suite <name> --out <path>');
    process.exit(1);
  } else {
    console.error('Usage: bun run auto-collect --suite <name> --out <path>');
    process.exit(1);
  }
}

const suite = loadEvalSuite(values.suite);
if (!suite) {
  console.error(`Suite not found: ${values.suite}`);
  process.exit(1);
}

const runs = values.runs ? parseInt(values.runs, 10) : 1;
const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : 300_000; // 5 min
const concurrency = values.concurrency ? parseInt(values.concurrency, 10) : 3;
const outPath = values.out ?? `/tmp/${values.suite}-outputs.json`;
const directory = values.directory ?? process.cwd();
const baseUrl = values.url ?? 'http://localhost:4096';

// ── Connect to OpenCode ──────────────────────────────────────────────

console.log(`\nSuite: ${suite.name} (${suite.evals.length} cases × ${runs} runs)`);
console.log(`Output: ${outPath}`);
console.log(`Timeout: ${timeoutMs / 1000}s per prompt`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Directory: ${directory}`);
console.log(`OpenCode URL: ${baseUrl}`);
console.log('');

const client = createOpencodeClient({ baseUrl, directory });

// Verify connection
try {
  const status = await client.session.status();
  if (status.error) {
    console.error('Failed to connect to OpenCode:', status.error);
    process.exit(1);
  }
  console.log('Connected to OpenCode');
} catch (err) {
  console.error(
    'Cannot connect to OpenCode. Is it running?',
    err instanceof Error ? err.message : String(err),
  );
  console.error('Start OpenCode in this directory first: opencode');
  process.exit(1);
}

// ── Run evals ────────────────────────────────────────────────────────

type OutputEntry = { prompts: string[]; responses: string[] };

async function runOneEval(
  evalId: string,
  prompt: string,
  agent: string,
  runIndex: number,
): Promise<{ success: boolean; response: string; transcript?: Transcript; error?: string }> {
  const label = `  [${evalId}] run ${runIndex + 1}/${runs}`;

  try {
    // Create a fresh session
    const createResult = await client.session.create({
      body: { title: `eval: ${evalId}#${runIndex}` },
      query: { directory },
    });

    if (createResult.error) {
      const err = createResult.error as { data?: { message?: string }; message?: string };
      const msg = err.data?.message ?? err.message ?? JSON.stringify(createResult.error);
      console.log(`${label} — session create failed: ${msg}`);
      return { success: false, response: '', error: msg };
    }

    const sessionId = createResult.data.id;
    console.log(`${label} — session ${sessionId}, prompting...`);

    // Send the prompt with a timeout
    const promptPromise = client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: 'text', text: prompt }],
        agent,
      },
      query: { directory },
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    );

    const result = await Promise.race([promptPromise, timeoutPromise]);

    if (result.error) {
      const err = result.error as { data?: { message?: string }; message?: string };
      const msg = err.data?.message ?? err.message ?? JSON.stringify(result.error);
      console.log(`${label} — prompt failed: ${msg}`);
      // Try to clean up session
      await client.session.delete({ path: { id: sessionId } }).catch(() => {});
      return { success: false, response: '', error: msg };
    }

    // Extract text from response parts
    const parts = result.data.parts ?? [];
    const textParts = parts.filter(
      (p: { type: string }) => p.type === 'text',
    ) as Array<{ type: 'text'; text: string }>;
    const responseText = textParts.map((p) => p.text).join('\n');

    // Extract tool calls from parts
    const toolParts = parts.filter(
      (p: { type: string }) => p.type === 'tool',
    ) as Array<{ type: 'tool'; name?: string; args?: unknown; result?: unknown }>;

    // Build transcript
    const transcript: Transcript = {
      messages: [
        { role: 'user', content: prompt },
        { role: 'assistant', content: responseText, toolCalls: toolParts.map((t) => ({ name: t.name ?? 'unknown', args: t.args, result: t.result })) },
      ],
      toolCallCount: toolParts.length,
      turnCount: 1,
    };

    console.log(`${label} — ${responseText.length} chars, ${toolParts.length} tool calls`);

    // Clean up session
    await client.session.delete({ path: { id: sessionId } }).catch(() => {});

    return { success: true, response: responseText, transcript };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.log(`${label} — error: ${msg}`);
    return { success: false, response: '', error: msg };
  }
}

// Run evals with concurrency control
const outputs: Record<string, string | string[]> = {};
const allTranscripts: Record<string, Transcript[]> = {};
const errors: Array<{ evalId: string; run: number; error: string }> = [];

// Flatten all tasks
type Task = {
  evalId: string;
  prompt: string;
  agent: string;
  runIndex: number;
};

const tasks: Task[] = [];
for (const evalCase of suite.evals) {
  for (let r = 0; r < runs; r++) {
    tasks.push({
      evalId: evalCase.id,
      prompt: evalCase.prompt,
      agent: evalCase.agent ?? 'orchestrator',
      runIndex: r,
    });
  }
}

// Process in batches
for (let i = 0; i < tasks.length; i += concurrency) {
  const batch = tasks.slice(i, i + concurrency);
  const results = await Promise.all(
    batch.map((t) => runOneEval(t.evalId, t.prompt, t.agent, t.runIndex)),
  );

  // Collect results
  for (let j = 0; j < batch.length; j++) {
    const task = batch[j];
    const result = results[j];

    if (!outputs[task.evalId]) {
      outputs[task.evalId] = runs === 1 ? '' : [];
      allTranscripts[task.evalId] = [];
    }

    if (runs === 1) {
      outputs[task.evalId] = result.response;
    } else {
      (outputs[task.evalId] as string[]).push(result.response);
    }

    if (result.transcript) {
      allTranscripts[task.evalId].push(result.transcript);
    }

    if (!result.success && result.error) {
      errors.push({ evalId: task.evalId, run: task.runIndex, error: result.error });
    }
  }
}

// ── Write outputs and transcripts ────────────────────────────────────

await Bun.write(outPath, JSON.stringify(outputs, null, 2));
console.log(`\nWrote ${Object.keys(outputs).length} eval outputs to ${outPath}`);

// Write transcripts to a separate file
const transcriptPath = outPath.replace(/\.json$/, '-transcripts.json');
await Bun.write(transcriptPath, JSON.stringify(allTranscripts, null, 2));
console.log(`Wrote transcripts to ${transcriptPath}`);

if (errors.length > 0) {
  console.log(`\n${errors.length} errors:`);
  for (const e of errors) {
    console.log(`  ${e.evalId} run ${e.run + 1}: ${e.error}`);
  }
}

console.log(`\nNext: bun run eval --suite ${values.suite} --outputs-file ${outPath}`);
