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
import {
  loadEvalSuite,
  loadEvalSuites,
  type Transcript,
} from '../evals/runner';

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
    delay: { type: 'string' },
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
const delayMs = values.delay ? parseInt(values.delay, 10) : 30_000;

// ── Connect to OpenCode ──────────────────────────────────────────────

console.log(
  `\nSuite: ${suite.name} (${suite.evals.length} cases × ${runs} runs)`,
);
console.log(`Output: ${outPath}`);
console.log(`Timeout: ${timeoutMs / 1000}s per prompt`);
console.log(`Concurrency: ${concurrency}`);
console.log(`Delay between batches: ${delayMs}ms`);
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

/**
 * Read the completed session transcript and extract the response text,
 * tool calls, and agent invocations. Called after the blocking prompt
 * resolves, so the full transcript (including the final text answer)
 * is already present.
 */
async function collectTranscript(
  sessionId: string,
): Promise<{ response: string; transcript: Transcript }> {
  // Now read messages
  const finalResult = await client.session
    .messages({
      path: { id: sessionId },
      query: { directory },
    })
    .catch(() => null);

  const rawMessages = (finalResult?.data ?? []) as Array<{
    info: { role: string };
    parts: unknown[];
  }>;

  // Find last assistant message with text content
  let responseText = '';
  for (const msg of [...rawMessages].reverse()) {
    if (msg.info?.role !== 'assistant') continue;
    const parts = msg.parts ?? [];
    const textParts = parts.filter((p: unknown) => {
      const part = p as { type?: string; text?: string };
      return part?.type === 'text' && part?.text;
    }) as Array<{ type: 'text'; text: string }>;
    if (textParts.length > 0) {
      responseText = textParts.map((p) => p.text).join('\n');
      break;
    }
  }

  // Extract tool calls and agent invocations from ALL messages
  const allToolCalls: Array<{ name: string; args: unknown; result?: unknown }> =
    [];
  const agentInvocations: Array<{ agent: string; sessionId?: string }> = [];

  for (const msg of rawMessages) {
    for (const p of msg.parts ?? []) {
      const part = p as {
        type?: string;
        name?: string;
        tool?: string;
        args?: unknown;
        result?: unknown;
        state?: { input?: Record<string, unknown> };
        metadata?: Record<string, unknown>;
      };
      if (part.type === 'tool') {
        const toolName = part.name ?? part.tool ?? 'unknown';
        const callArgs =
          (part.args as Record<string, unknown> | undefined) ??
          part.state?.input;
        allToolCalls.push({
          name: toolName,
          args: callArgs,
          result: part.result,
        });

        // Detect agent task invocations (delegation)
        if (toolName === 'task') {
          const agentName = (
            callArgs as { subagent_type?: string } | undefined
          )?.subagent_type;
          const sessionId = (part.metadata?.sessionId ??
            part.metadata?.sessionID) as string | undefined;
          if (agentName) {
            agentInvocations.push({ agent: agentName, sessionId });
          }
        }
      }
    }
  }

  const transcript: Transcript = {
    messages: [
      { role: 'user', content: '' }, // original prompt not in messages API
      { role: 'assistant', content: responseText, toolCalls: allToolCalls },
    ],
    toolCallCount: allToolCalls.length,
    turnCount: rawMessages.length,
    agentInvocations,
  };

  return { response: responseText, transcript };
}

async function runOneEval(
  evalId: string,
  prompt: string,
  agent: string,
  runIndex: number,
): Promise<{
  success: boolean;
  response: string;
  transcript?: Transcript;
  error?: string;
}> {
  const label = `  [${evalId}] run ${runIndex + 1}/${runs}`;

  try {
    // Create a fresh session
    const createResult = await client.session.create({
      body: { title: `eval: ${evalId}#${runIndex}` },
      query: { directory },
    });

    if (createResult.error) {
      const err = createResult.error as {
        data?: { message?: string };
        message?: string;
      };
      const msg =
        err.data?.message ?? err.message ?? JSON.stringify(createResult.error);
      console.log(`${label} — session create failed: ${msg}`);
      return { success: false, response: '', error: msg };
    }

    const sessionId = createResult.data.id;
    console.log(`${label} — session ${sessionId}, prompting...`);

    // Blocking prompt wrapped in a timeout race. Avoids the fragile
    // poll-for-completion heuristic that returned empty output for any
    // eval where the agent used tools before answering.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    );

    let promptResult: any;
    try {
      promptResult = await Promise.race([
        client.session.prompt({
          path: { id: sessionId },
          body: {
            parts: [{ type: 'text', text: prompt }],
            agent,
          },
          query: { directory },
        }),
        timeoutPromise,
      ]);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`${label} — prompt failed: ${msg}`);
      await client.session.delete({ path: { id: sessionId } }).catch(() => {});
      return { success: false, response: '', error: msg };
    }

    if (promptResult?.error) {
      const err = promptResult.error as { message?: string };
      const msg = err.message ?? JSON.stringify(promptResult.error);
      console.log(`${label} — prompt failed: ${msg}`);
      await client.session.delete({ path: { id: sessionId } }).catch(() => {});
      return { success: false, response: '', error: msg };
    }

    // Session is complete; read the full transcript (now includes final text).
    const { response, transcript } = await collectTranscript(sessionId);

    console.log(
      `${label} — ${response.length} chars, ${transcript.toolCallCount ?? 0} tool calls, ${transcript.agentInvocations?.length ?? 0} agents`,
    );

    // Clean up session
    await client.session.delete({ path: { id: sessionId } }).catch(() => {});

    return { success: true, response, transcript };
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
console.log(
  `Starting ${tasks.length} tasks (${suite.evals.length} evals × ${runs} runs), batches of ${concurrency}`,
);
let completedCount = 0;
for (let i = 0; i < tasks.length; i += concurrency) {
  const batch = tasks.slice(i, i + concurrency);
  console.log(
    `Batch ${Math.floor(i / concurrency) + 1}/${Math.ceil(tasks.length / concurrency)} (tasks ${i + 1}-${Math.min(i + concurrency, tasks.length)} of ${tasks.length})`,
  );
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
      errors.push({
        evalId: task.evalId,
        run: task.runIndex,
        error: result.error,
      });
    }

    completedCount++;
    console.log(`[${task.evalId}] done (${completedCount}/${tasks.length})`);
  }

  // Delay between batches to avoid rate limits
  if (delayMs > 0 && i + concurrency < tasks.length) {
    console.log(`  Waiting ${delayMs}ms before next batch...`);
    await new Promise((r) => setTimeout(r, delayMs));
  }
}

// ── Write outputs and transcripts ────────────────────────────────────

await Bun.write(outPath, JSON.stringify(outputs, null, 2));
console.log(
  `\nWrote ${Object.keys(outputs).length} eval outputs to ${outPath}`,
);

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

console.log(
  `\nNext: bun run eval --suite ${values.suite} --outputs-file ${outPath}`,
);
