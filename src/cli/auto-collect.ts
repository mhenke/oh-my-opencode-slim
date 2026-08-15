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
const timeoutMs = values.timeout ? parseInt(values.timeout, 10) : 60_000; // 60s default; --timeout overrides
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
 * Read the session transcript and extract the response text, tool calls,
 * and agent invocations. Called repeatedly while polling; once the session
 * reports a terminal idle status the final transcript (including the final
 * text answer) is captured here.
 *
 * Uses the real SDK part shapes:
 * - ToolPart: `{ type: 'tool', tool, state: { status, input, output, error } }`
 * - delegation: `{ type: 'subtask', agent, prompt, description }`
 */
// Race a promise against a timeout so a hung SDK call cannot stall the
// poll loop forever (the outer timeoutMs only wraps promptAsync).
function withCallTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error('sdk call timeout')), ms),
    ),
  ]);
}

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

  // Find last assistant message with text content. Reversed scan picks the
  // final assistant text (not the first partial part) once the session is
  // idle; text parts are joined in order.
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

  // Extract tool calls and agent invocations from ALL messages.
  const allToolCalls: Array<{ name: string; args: unknown; result?: unknown }> =
    [];
  const agentInvocations: Array<{ agent: string; sessionId?: string }> = [];

  for (const msg of rawMessages) {
    for (const p of msg.parts ?? []) {
      const part = p as {
        type?: string;
        tool?: string;
        agent?: string;
        state?: {
          status?: string;
          input?: Record<string, unknown>;
          output?: string;
          error?: string;
        };
        sessionID?: string;
      };

      // ToolPart: name is `tool`, args/results live in `state`.
      if (part.type === 'tool') {
        // Count only terminal tool calls; pending/running parts are not
        // evidence of completion and must not satisfy the poll's
        // completion signal.
        if (
          part.state?.status !== 'completed' &&
          part.state?.status !== 'error'
        ) {
          continue;
        }
        const toolName = part.tool ?? 'unknown';
        const callArgs = part.state?.input;
        const result =
          part.state?.status === 'error'
            ? part.state.error
            : part.state?.output;
        allToolCalls.push({ name: toolName, args: callArgs, result });
      }

      // Delegation is a `subtask` part carrying `agent` directly.
      if (part.type === 'subtask' && part.agent) {
        agentInvocations.push({
          agent: part.agent,
          sessionId: part.sessionID,
        });
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

    // Use promptAsync so the foreground fallback system can intercept
    // empty responses and retry with a working model, just like a real
    // user prompt would.
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timeout')), timeoutMs),
    );

    try {
      await Promise.race([
        client.session.promptAsync({
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

    // Poll until the session is terminal/idle and we have a non-empty
    // response, giving the fallback chain time to retry with a working
    // model.
    const pollStart = Date.now();
    const pollInterval = 1000;
    let response: string = '';
    let emptyIdleFailure = false;
    let consecutiveIdle = 0;
    let transcript: Transcript = {
      messages: [
        { role: 'user', content: '' },
        { role: 'assistant', content: '', toolCalls: [] },
      ],
      toolCallCount: 0,
      turnCount: 0,
      agentInvocations: [],
    };

    while (Date.now() - pollStart < timeoutMs) {
      // Status must be read for the same directory as the session (the
      // eval worktree); otherwise we read a status map for the default
      // directory and never see this session's transitions.
      const status = (await withCallTimeout(
        client.session.status({ query: { directory } }).catch(() => null),
        30_000,
      )) as {
        data?: Record<string, { type?: 'busy' | 'idle' | 'retry' }>;
      } | null;

      // SDK returns a map keyed by session ID; the per-session value uses
      // a `type` discriminator ('busy' | 'idle' | 'retry'). A session is
      // only done once it reports a terminal 'idle' status; busy/retry
      // sessions are still working, so a partial transcript (e.g. a stray
      // newline or a mid-flight tool update) must not end the poll early.
      // A session with no status entry is not known to be done either, so
      // we keep polling until it reports idle or the timeout elapses.
      const sessionStatus = status?.data?.[sessionId];
      const isIdle = sessionStatus?.type === 'idle';
      const result = await withCallTimeout(
        collectTranscript(sessionId),
        30_000,
      );
      response = result.response;
      transcript = result.transcript;

      if (isIdle) {
        // Only a non-empty final text response counts as completion. A
        // mid-flight idle (e.g. between a tool call and its result) must
        // not end the poll early, or we capture a partial transcript.
        if (response.length > 0) {
          break;
        }
        consecutiveIdle += 1;
        // ~3s of idle with no output bounds the empty-completion spin
        // (covers the ~2.8s foreground-fallback replay window) and lets
        // us record a clean failure instead of hanging to timeout.
        if (consecutiveIdle >= 3) {
          emptyIdleFailure = true;
          break;
        }
      } else {
        consecutiveIdle = 0;
      }

      await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }

    console.log(
      `${label} — ${response.length} chars, ${transcript.toolCallCount ?? 0} tool calls, ${transcript.agentInvocations?.length ?? 0} agents`,
    );

    // Clean up session
    await client.session.delete({ path: { id: sessionId } }).catch(() => {});

    if (emptyIdleFailure) {
      return {
        success: false,
        response,
        transcript,
        error: 'session idle with empty output',
      };
    }

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
