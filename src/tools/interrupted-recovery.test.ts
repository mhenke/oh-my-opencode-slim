/**
 * Merge-bar proof for #1061: a host-reported interruption publishes a
 * `stopped` row (never error), wakes the parent through the terminal
 * publication channel, and the retained session resumes by the SAME task ID
 * with generation+1 — through v1 task_revive and through v2 native
 * subagent(sessionID, prompt). A stopped row converts to cancelled through
 * the existing fenced cancellation path with no second abort.
 *
 * Every stopped row here comes from a real gate publication driven by a host
 * `interrupted` outcome; no fixture seeds terminal state.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  mock,
  spyOn,
  test,
} from 'bun:test';
import { createPendingCallTracker } from '../hooks/task-session-manager/pending-call-tracker';
import { createRevivedRunTracker } from '../hooks/task-session-manager/revived-run-tracker';
import { createSessionRecovery } from '../hooks/task-session-manager/session-recovery';
import {
  handleToolExecuteBefore,
  registerDelegatedLaunchFromStructured,
} from '../hooks/task-session-manager/tool-execute-hooks';
import {
  BackgroundJobBoard,
  type BackgroundJobRecord,
} from '../utils/background-job-board';
import {
  type BackgroundJobTerminalGate,
  createBackgroundJobTerminalGate,
  type GateResult,
} from '../utils/background-job-terminal-gate';
import * as opencodeClient from '../utils/opencode-client';
import { createTimerHarness } from '../utils/test-timers';
import { createToolExecuteBridges } from '../v2/setup';
import { createCancelTaskTool } from './cancel-task';
import { createTaskReviveTool } from './task-revive';

const PARENT = 'parent-1';
const CHILD = 'ses_1';

const gates: BackgroundJobTerminalGate[] = [];
const disposables: Array<{ dispose(): void }> = [];

beforeEach(() => {
  spyOn(opencodeClient, 'getClient').mockImplementation(
    (input) => input.client,
  );
});

afterEach(() => {
  for (const tracker of disposables.splice(0)) tracker.dispose();
  for (const gate of gates.splice(0)) gate.dispose();
  mock.restore();
});

/**
 * Drive a real host `interrupted` outcome through the terminal gate: the
 * host exposes a session.get outcome but no transcript source, so the
 * outcome path attributes the interruption to the running generation and
 * publishes it. Returns the publication result plus every terminal
 * publication the board fanned out (the parent-wake channel).
 */
async function publishInterruption(
  board: BackgroundJobBoard,
  generation: number,
  idle: number,
  clock: number,
): Promise<{ result: GateResult; wakes: BackgroundJobRecord[] }> {
  const wakes: BackgroundJobRecord[] = [];
  board.addTerminalOutcomeListener((record) => {
    wakes.push(record);
  });
  const timers = createTimerHarness();
  const gate = createBackgroundJobTerminalGate({
    backgroundJobBoard: board,
    baselineFor: () => undefined,
    readTerminalEvidence: async () => undefined,
    hostOutcomeClock: 'shared-unix-ms',
    graceMs: 5,
    now: () => clock,
    setTimeout: timers.setTimeout,
    clearTimeout: timers.clearTimeout,
    input: {
      client: {
        session: {
          get: async () => ({
            data: { outcome: 'interrupted', time: { idle } },
          }),
        },
      },
    } as never,
  });
  gates.push(gate);
  const run = { taskID: CHILD, generation };
  const token = gate.capture(run);
  if (!token) throw new Error('missing observation');
  gate.observe(token, {
    kind: 'quiescent',
    origin: 'test',
    readStartedAt: token.readStartedAt,
  });
  const result = await gate.reconcile(run);
  return { result, wakes };
}

function launch(board: BackgroundJobBoard, now: number) {
  return board.registerLaunch({
    taskID: CHILD,
    parentSessionID: PARENT,
    agent: 'explorer',
    background: true,
    now,
  });
}

function assertInterruptedPublication(
  board: BackgroundJobBoard,
  result: GateResult,
  wakes: BackgroundJobRecord[],
  generation: number,
) {
  expect(result.kind).toBe('committed');
  expect(board.get(CHILD)).toMatchObject({
    taskID: CHILD,
    state: 'stopped',
    generation,
    resultSummary: 'Host reported outcome: interrupted.',
    terminalUnreconciled: true,
  });
  expect(wakes.at(-1)).toMatchObject({ taskID: CHILD, state: 'stopped' });
}

describe('interrupted recovery end to end (#1061)', () => {
  test('a host interruption publishes stopped, wakes the parent, and revives through v1 task_revive with generation+1', async () => {
    const board = new BackgroundJobBoard();
    const gen1 = launch(board, 10).generation;

    const { result, wakes } = await publishInterruption(board, gen1, 50, 60);
    assertInterruptedPublication(board, result, wakes, gen1);

    const abort = mock(async () => ({}));
    const status = mock(async () => ({ data: { [CHILD]: { type: 'idle' } } }));
    const promptAsync = mock(async () => ({}));
    const input = {
      directory: '/test/project',
      client: { session: { abort, status, promptAsync } },
    } as never;
    const gate = createBackgroundJobTerminalGate({
      backgroundJobBoard: board,
      input,
    });
    gates.push(gate);
    const tracker = createRevivedRunTracker({
      input,
      backgroundJobBoard: board,
      terminalGate: gate,
    });
    disposables.push(tracker);
    const onLaunch = mock(() => {});
    const { task_revive: taskRevive } = createTaskReviveTool({
      input,
      backgroundJobBoard: board,
      shouldManageSession: () => true,
      verifyAbortMs: 10,
      abortRetryIntervalMs: 0,
      stableStoppedMs: 0,
      revivedRunTracker: tracker,
      recoverRetainedSession: createSessionRecovery({
        input,
        backgroundJobBoard: board,
        liveStatusTimeoutMs: 10,
      }),
      backgroundJobSupervisor: { onLaunch } as never,
    });

    const output = await taskRevive.execute(
      { task_id: CHILD, prompt: 'continue after the interruption' },
      { sessionID: PARENT } as never,
    );

    expect(String(output)).toContain('state: running');
    expect(promptAsync).toHaveBeenCalledTimes(1);
    expect(board.get(CHILD)).toMatchObject({
      taskID: CHILD,
      state: 'running',
      generation: gen1 + 1,
      parentSessionID: PARENT,
    });
    expect(board.list(PARENT)).toHaveLength(1);
  });

  test('a host interruption publishes stopped, wakes the parent, and resumes through v2 native continuation with generation+1', async () => {
    const board = new BackgroundJobBoard();
    const gen1 = launch(board, 10).generation;

    const { result, wakes } = await publishInterruption(board, gen1, 50, 60);
    assertInterruptedPublication(board, result, wakes, gen1);

    const pendingCallTracker = createPendingCallTracker();
    const deps = {
      shouldManageSession: () => true,
      backgroundJobBoard: board,
      pendingCallTracker,
      taskContextTracker: { pendingManagedTaskIds: new Set<string>() },
      hostFlavor: 'v2',
      recoverRetainedSession: (async () => {
        throw new Error('recovery must not run for a tracked row');
      }) as never,
    };
    const bridges = createToolExecuteBridges(
      (hookInput, output) => handleToolExecuteBefore(hookInput, output, deps),
      undefined,
    );
    const callInput = {
      tool: 'subagent',
      sessionID: PARENT,
      id: 'call_interrupted',
      input: {
        agent: 'explorer',
        sessionID: CHILD,
        prompt: 'continue after the interruption',
        description: 'continue',
        background: true,
      },
    };

    await bridges.beforeBridge(callInput);

    expect(callInput.input.sessionID).toBe(CHILD);
    const pending = pendingCallTracker.peekByCallId('call_interrupted', PARENT);
    expect(pending).toMatchObject({
      resumedTaskId: CHILD,
      relaunchLease: { kind: 'relaunch' },
    });
    if (!pending) throw new Error('missing continuation pending call');

    const resumed = await registerDelegatedLaunchFromStructured(
      {
        callID: 'call_interrupted',
        parentSessionID: PARENT,
        childTaskID: CHILD,
        state: 'running',
        background: true,
        exactCallConfirmed: true,
        pending,
        handledByWrapper: true,
      },
      {
        directory: '/tmp',
        backgroundJobBoard: board,
        terminalGate: { reconcile: async () => undefined } as never,
        taskContextTracker: {
          pendingManagedTaskIds: new Set<string>(),
          contextFilesForPrompt: () => [],
        },
      },
    );

    expect(resumed).toMatchObject({
      taskID: CHILD,
      state: 'running',
      generation: gen1 + 1,
    });
    expect(board.list(PARENT)).toHaveLength(1);
  });

  test('task_cancel on a stopped row converts to cancelled without a second abort', async () => {
    const board = new BackgroundJobBoard();
    const gen1 = launch(board, 10).generation;

    const { result, wakes } = await publishInterruption(board, gen1, 50, 60);
    assertInterruptedPublication(board, result, wakes, gen1);

    const abort = mock(async () => ({}));
    const input = {
      directory: '/test/project',
      client: { session: { abort } },
    } as never;
    const { task_cancel: taskCancel } = createCancelTaskTool({
      input,
      backgroundJobBoard: board,
      shouldManageSession: () => true,
      verifyAbortMs: 10,
      abortRetryIntervalMs: 0,
      stableStoppedMs: 0,
    });

    const output = await taskCancel.execute(
      { task_id: CHILD, reason: 'obsolete' },
      { sessionID: PARENT } as never,
    );

    expect(String(output)).toContain('state: cancelled');
    expect(abort).not.toHaveBeenCalled();
    expect(board.get(CHILD)).toMatchObject({
      taskID: CHILD,
      state: 'cancelled',
      cancellationRequested: true,
    });
  });
});
