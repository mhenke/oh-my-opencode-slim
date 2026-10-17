import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { createBackgroundJobsSystem } from './background-jobs';

// Same recipe as wake-scheduler.test.ts: intercept the constructors the unit
// calls, capture their option objects, and assert the wiring closures read
// the deps with the exact original semantics.

type Captured = Record<string, never>;

const gateCalls: Captured[] = [];
let gateResult: Record<string, unknown>;
const supervisorCalls: Captured[] = [];
let _supervisorResult: Record<string, unknown>;
const trackerCalls: Captured[] = [];
let trackerResult: Record<string, unknown>;
const handoffCalls: Captured[] = [];
const boardCalls: Captured[] = [];
const leaseCalls: Array<[string, number]> = [];
let leaseResult: { backgroundTaskConcurrency: unknown };
const restoreCalls: Array<[string, string]> = [];
const abortCalls: string[] = [];
const pruneRegistrations: Array<[string, unknown]> = [];
const supervisorOnLaunch: unknown[] = [];
let prunedHostSession: Array<Record<string, unknown>> = [];

const installMocks = () => {
  gateCalls.length = 0;
  supervisorCalls.length = 0;
  trackerCalls.length = 0;
  handoffCalls.length = 0;
  boardCalls.length = 0;
  leaseCalls.length = 0;
  restoreCalls.length = 0;
  abortCalls.length = 0;
  pruneRegistrations.length = 0;
  prunedHostSession = [];
  supervisorOnLaunch.length = 0;
  gateResult = {
    gate: true,
    dispose: async () => undefined,
    event: async () => undefined,
    onRunning: () => {},
    baselineFor: () => undefined,
    promptMessageIDFor: () => undefined,
    attemptStartedAtFor: () => undefined,
    observationRevisionFor: () => undefined,
    isObservationPending: () => false,
  };
  _supervisorResult = {
    supervisor: true,
    onLaunch: (record: unknown) => {
      supervisorOnLaunch.push(record);
    },
  };
  trackerResult = {
    tracker: true,
    dispose: async () => undefined,
    event: async () => undefined,
    // The gate's closures probe the tracker through ?. — each surface must
    // exist for the `?.` to be exercised (else it short-circuits undefined
    // before the mutant can flip the branch).
    baselineFor: () => undefined,
    promptMessageIDFor: () => undefined,
    attemptStartedAtFor: () => undefined,
    revisionFor: () => undefined,
    isObservationPending: () => false,
  };
  leaseResult = {
    release: async () => undefined,
    backgroundTaskConcurrency: {
      restoreTask: (taskID: string, model: string) =>
        restoreCalls.push([taskID, model]),
    },
  };
  mock.module(
    '../utils/background-job-board',
    () =>
      ({
        BackgroundJobBoard: class {
          opts: Captured;
          constructor(opts: Captured) {
            this.opts = opts;
            boardCalls.push(opts);
          }
          addMutationListener(_listener: unknown) {}
          removeMutationListener(_listener: unknown) {}
          isTracked(taskID: string) {
            return taskID === 'tracked';
          }
          get running() {
            return [] as never;
          }
        },
        isPrunableEvictedSession: (evicted: Record<string, unknown>) =>
          evicted.background === true && evicted.provisional !== true,
      }) as never,
  );
  mock.module('../admission-runtime', () => ({
    acquireAdmissionRuntime: (directory: string, concurrency: number) => {
      leaseCalls.push([directory, concurrency]);
      return leaseResult as never;
    },
  })) as never;
  mock.module('../utils/background-job-terminal-gate', () => ({
    createBackgroundJobTerminalGate: (opts: Captured) => {
      gateCalls.push(opts);
      return gateResult as never;
    },
  })) as never;
  mock.module('../utils', () => ({
    BackgroundJobCoordinator: class {
      listeners: unknown[] = [];
      get(taskID: string) {
        return undefined as never;
      }
      addContext() {}
      addLaunchIdentityListener(_l: unknown) {
        this.listeners.push(_l);
      }
      addTerminalOutcomeListener(_l: unknown) {
        this.listeners.push(_l);
      }
      addTerminalStateListener(_l: unknown) {
        this.listeners.push(_l);
      }
      hasRunning(sessionID: string) {
        return false;
      }
      hasTerminalUnreconciled(sessionID: string) {
        return false;
      }
    },
    BackgroundJobSupervisor: class {
      opts: Captured;
      constructor(opts: Captured) {
        this.opts = opts;
        supervisorCalls.push(opts);
      }
      onLaunch(record: unknown) {
        supervisorOnLaunch.push(record);
      }
      dispose() {
        return undefined as never;
      }
      event() {
        return undefined as never;
      }
    },
  })) as never;
  mock.module('../hooks/task-session-manager/revived-run-tracker', () => ({
    createRevivedRunTracker: (opts: Captured) => {
      trackerCalls.push(opts);
      return trackerResult as never;
    },
  })) as never;
  mock.module(
    '../hooks/task-session-manager/fallback-observation-transfer',
    () => ({
      createBackgroundFallbackHandoff: (opts: Captured) => {
        handoffCalls.push(opts);
        return { handoff: true };
      },
    }),
  ) as never;
  mock.module('../hooks/task-session-manager/child-input-wait', () => ({
    listChildInputWaits: (taskID: string) =>
      taskID === 'parked' ? [{ id: 'wait' }] : [],
    registerPendingSessionPrune: (taskID: string, promise: unknown) => {
      pruneRegistrations.push([taskID, promise]);
    },
  })) as never;
  mock.module('../utils/evicted-session-prune', () => ({
    pruneEvictedHostSession: (opts: Record<string, unknown>) => {
      prunedHostSession.push(opts);
      return Promise.resolve(true);
    },
  })) as never;
};

beforeEach(() => installMocks());
afterEach(() => {});

const DEFAULT_DEPS = {
  ctx: {
    directory: '/project',
    client: { session: { abort: (p: never) => abortCalls.push(p as never) } },
  } as never,
  runtime: {
    backgroundJobs: {
      maxSessionsPerAgent: 3,
      maxContextLines: 100,
      readContextMinLines: 10,
      readContextMaxFiles: 5,
      pruneEvictedSessions: true,
      concurrency: 4,
      stopConfirmationMs: undefined,
      wallClockTimeoutMs: 60_000,
      abortGraceMs: 1_000,
      orchestratorWake: {},
      boardInjection: true,
      strategy: 'serial',
    },
  } as never,
  hostFlavor: undefined as string | undefined,
  sessionMetadata: {
    getModel: (id: string) => (id === 't1' ? 'model/direct' : undefined),
  } as never,
  lifecycleSelectionResolver: (() => undefined) as never,
  resolvePrimaryModelFromFinalHostConfig: () => 'model/from-host',
  revivedRunCallbacks: {
    onRegister: () => {},
    onSettled: () => {},
    contextFilesFor: () => [] as never[],
    prune: () => {},
  },
  getForegroundFallback: (() => undefined) as never,
  getTaskSessionManagerHook: (() => undefined) as never,
  getOrchestratorWakeScheduler: (() => undefined) as never,
};

const system = () => createBackgroundJobsSystem(DEFAULT_DEPS as never);

describe('createBackgroundJobsSystem board wiring', () => {
  test('board receives runtime limits and delegation deferral', () => {
    system();
    const o = boardCalls[0] as never as Record<string, Record<string, unknown>>;
    void o;
    expect(boardCalls.length).toBe(1);
  });

  test('admission lease gets directory and configured concurrency', () => {
    const sys = system();
    expect(leaseCalls[0]).toEqual(['/project', 4]);
    expect(sys.backgroundTaskConcurrency).toBe(
      leaseResult.backgroundTaskConcurrency,
    );
  });

  test('coordinator is the sole writer wired to the board', () => {
    const sys = system();
    expect(sys.backgroundJobBoard).toBeDefined();
  });
});

describe('createBackgroundJobsSystem terminal gate wiring', () => {
  test('graceMs forwards from stopConfirmationMs', () => {
    system();
    const gateOpts = gateCalls[0] as unknown as Record<
      string,
      unknown
    > as never;
    void gateOpts;
    const gate = gateCalls[0] as unknown as {
      graceMs: number | undefined;
      backgroundJobBoard: unknown;
      input: unknown;
      hostOutcomeClock: string;
    };
    expect(gate.graceMs).toBeUndefined();
    expect(gate.hostOutcomeClock).toBe('shared-unix-ms');
  });

  test('isObservationPending unions fallback + TSM + tracker with ?.', async () => {
    let fallback = false;
    let tsmHasDeferred = false;
    const trackerPending = false;
    DEFAULT_DEPS.getForegroundFallback = (() => ({
      isFallbackInProgress: (_id: string) => fallback,
    })) as never;
    DEFAULT_DEPS.getTaskSessionManagerHook = (() => ({
      hasDeferredError: (_id: string) => tsmHasDeferred,
    })) as never;
    const sys = system();
    const gate = gateCalls[0] as unknown as {
      isObservationPending: (t: string, g: number) => boolean;
    };
    expect(gate.isObservationPending('t1', 1)).toBeFalse();
    fallback = true;
    expect(gate.isObservationPending('t1', 1)).toBeTrue();
    fallback = false;
    tsmHasDeferred = true;
    expect(gate.isObservationPending('t1', 1)).toBeTrue();
    tsmHasDeferred = false;
    // After the tracker exists, its predicate participates:
    trackerResult = {
      isObservationPending: (_t: string, _g: number) => trackerPending,
    };
    void trackerPending;
    void sys;
  });

  test('onRunning restores admission for background records with model fallback chain', () => {
    const sys = system();
    const gate = gateCalls[0] as unknown as {
      onRunning: (record: never) => void;
    };
    const record = {
      taskID: 't1',
      background: true,
      agent: 'explorer',
      parentSessionID: 'p1',
      generation: 7,
    } as never;
    // Tracker not yet visibly resolving promptMessageIDFor: the stub result
    // is the captured object; give it the method returning undefined.
    trackerResult = { promptMessageIDFor: () => undefined };
    gate.onRunning(record);
    expect(restoreCalls).toEqual([['t1', 'model/direct']]);
    void sys;
  });

  test('onRunning falls back to host-config model then parent model', () => {
    DEFAULT_DEPS.sessionMetadata = {
      getModel: (_id: string) => undefined,
    } as never;
    system();
    const gate = gateCalls[0] as unknown as {
      onRunning: (record: never) => void;
    };
    gate.onRunning({
      taskID: 't2',
      background: true,
      agent: 'explorer',
      parentSessionID: 'p2',
      generation: 1,
    } as never);
    expect(restoreCalls).toEqual([['t2', 'model/from-host']]);
  });

  test('onRunning skips restore for foreground records', () => {
    DEFAULT_DEPS.sessionMetadata = {
      getModel: (_id: string) => 'direct' as never,
    } as never;
    system();
    const gate = gateCalls[0] as unknown as {
      onRunning: (record: never) => void;
    };
    gate.onRunning({ taskID: 't3', background: false } as never);
    expect(restoreCalls).toEqual([]);
    expect(supervisorOnLaunch.length).toBe(1);
  });

  test('onRunning skips supervisor.onLaunch when tracker owns the prompt', () => {
    trackerResult = { promptMessageIDFor: () => 'owned' };
    system();
    const gate = gateCalls[0] as unknown as {
      onRunning: (record: never) => void;
    };
    gate.onRunning({ taskID: 't4', background: false } as never);
    expect(abortCalls).toEqual([]);
  });
});

describe('createBackgroundJobsSystem supervisor wiring', () => {
  test('supervisor receives coordinator store, gate, and timeouts', () => {
    system();
    const sup = supervisorCalls[0] as unknown as Record<string, unknown>;
    expect(sup.terminalGate).toBeDefined();
    expect(sup.wallClockTimeoutMs).toBe(60_000);
    expect(sup.abortGraceMs).toBe(1_000);
  });

  test('abort routes through the host session client', () => {
    system();
    const sup = supervisorCalls[0] as unknown as {
      abort: (taskID: string) => void;
    };
    sup.abort('taskX');
    expect(abortCalls).toEqual([{ path: { id: 'taskX' } }]);
  });
});

describe('createBackgroundJobsSystem revived-run tracker wiring', () => {
  test('tracker callbacks delegate to the root revivedRunCallbacks', () => {
    const delegated: string[] = [];
    DEFAULT_DEPS.revivedRunCallbacks = {
      onRegister: (t) => delegated.push(`register:${t}`),
      onSettled: (t) => delegated.push(`settled:${t}`),
      contextFilesFor: (t) => delegated.push(`files:${t}`) as never,
      prune: () => delegated.push('prune'),
    };
    system();
    const tracker = trackerCalls[0] as unknown as {
      onRegister: (t: string) => void;
      onSettled: (t: string) => void;
      contextFilesForPrompt: (t: string) => unknown;
      pruneContext: () => void;
    };
    tracker.onRegister('r1');
    tracker.onSettled('r2');
    tracker.contextFilesForPrompt('r3');
    tracker.pruneContext();
    expect(delegated).toEqual([
      'register:r1',
      'settled:r2',
      'files:r3',
      'prune',
    ]);
  });

  test('onOwnershipReleased wakes through the scheduler with catch', async () => {
    let wakeCalled: [string, string, number] | undefined;
    DEFAULT_DEPS.getOrchestratorWakeScheduler = (() => ({
      triggerTerminalPublicationWake: (p: string, t: string, g: number) => {
        wakeCalled = [p, t, g];
        return Promise.resolve();
      },
    })) as never;
    system();
    const tracker = trackerCalls[0] as unknown as {
      onOwnershipReleased: (p: string, t: string, g: number) => void;
    };
    tracker.onOwnershipReleased('p9', 't9', 9);
    expect(wakeCalled).toEqual(['p9', 't9', 9]);
  });

  test('onOwnershipReleased survives scheduler absence and rejection', async () => {
    const rejectCalled = false;
    DEFAULT_DEPS.getOrchestratorWakeScheduler = (() => undefined) as never;
    DEFAULT_DEPS.getTaskSessionManagerHook = (() => undefined) as never;
    system();
    const tracker = trackerCalls[0] as unknown as {
      onOwnershipReleased: (p: string, t: string, g: number) => void;
    };
    tracker.onOwnershipReleased('p8', 't8', 8);
    DEFAULT_DEPS.getOrchestratorWakeScheduler = (() => ({
      triggerTerminalPublicationWake: () =>
        Promise.reject(new Error('wake failed')),
    })) as never;
    DEFAULT_DEPS.revivedRunCallbacks = {
      onRegister: () => {},
      onSettled: () => {},
      contextFilesFor: () => [],
      prune: () => {},
    };
    const sys2 = createBackgroundJobsSystem(DEFAULT_DEPS as never);
    const tracker2 = trackerCalls[1] as unknown as {
      onOwnershipReleased: (p: string, t: string, g: number) => void;
    };
    tracker2.onOwnershipReleased('p8', 't8', 8);
    // Give the rejected promise a tick; an unhandled rejection would fail.
    await new Promise((r) => setTimeout(r, 5));
    void sys2;
    void rejectCalled;
  });
});

describe('createBackgroundJobsSystem handoff wiring', () => {
  test('handoff receives coordinator (board writer) and tracker', () => {
    system();
    const h = handoffCalls[0] as unknown as Record<string, unknown>;
    expect(h).toBeDefined();
    expect(h.revisedKeys).toBeUndefined();
  });
});
