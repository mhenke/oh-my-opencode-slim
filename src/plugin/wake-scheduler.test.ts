import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { BackgroundJobRecord } from '../utils/background-job-board';
import { registerWakeScheduler } from './wake-scheduler';

// The unit is pure wiring: every behavior lives in the option closures it
// hands to createOrchestratorWakeScheduler. Capture that options object and
// assert each closure reads the deps.

type CapturedOptions = Record<string, any>;

const fakeSchedulerSurface = () => ({
  event: async () => undefined,
  observeChatMessage: () => undefined,
  triggerStoppedJobRecovery: () => undefined,
  triggerTerminalPublicationWake: () => Promise.resolve(),
  triggerChildInputWaitWake: () => undefined,
  suppress: () => undefined,
});
let fakeScheduler: Record<string, unknown> = fakeSchedulerSurface();
const capturedOptions: CapturedOptions[] = [];

const restoreHooks = mock.module('../hooks', () => ({
  ...requireActualHooks(),
  createOrchestratorWakeScheduler: (
    _ctx: PluginInput,
    options: CapturedOptions,
  ) => {
    capturedOptions.push(options);
    return fakeScheduler;
  },
}));

// Real hooks module spread under the stubbed factory so unrelated imports
// keep working.
function requireActualHooks(): Record<string, unknown> {
  // Bun's mock.module factory runs lazily; import the real module inside.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const real = require('../hooks/index.ts');
  return { ...real };
}
void restoreHooks;

afterEach(() => {
  capturedOptions.length = 0;
  fakeScheduler = fakeSchedulerSurface();
});

const ctxStub = { directory: '/project', client: {} } as never;

const runtimeStub = {
  backgroundJobs: {
    orchestratorWake: {
      enabled: true,
      intervalMs: 60_000,
      periodicWakeEnabled: true,
    },
    boardInjection: true,
  },
};

const recordStub = (overrides: Partial<BackgroundJobRecord> = {}) =>
  ({
    taskID: 't1',
    alias: 'orchestrator',
    parentSessionID: 'p1',
    state: 'running',
    agent: 'orchestrator',
    description: 'stub record',
    generation: 1,
    terminalUnreconciled: false,
    ...overrides,
  }) as unknown as BackgroundJobRecord;

const lifecycleStub = {} as never;

function wired(
  overrides: {
    getAgent?: (sessionID: string) => string | undefined;
    hasInputWait?: (sessionID: string) => boolean;
    isFallbackInProgress?: (sessionID: string) => boolean;
    get?: (taskID: string) => BackgroundJobRecord | undefined;
    hasRunning?: (sessionID: string) => boolean;
    hasTerminalUnreconciled?: (sessionID: string) => boolean;
    resolver?: (sessionID: string) => Promise<never>;
  } = {},
) {
  return registerWakeScheduler({
    ctx: ctxStub,
    runtime: runtimeStub as never,
    hostFlavor: () => undefined,
    sessionMetadata: { getAgent: overrides.getAgent ?? (() => undefined) },
    backgroundJobCoordinator: {
      get: overrides.get ?? (() => undefined),
      hasRunning: overrides.hasRunning ?? (() => false),
      hasTerminalUnreconciled:
        overrides.hasTerminalUnreconciled ?? (() => false),
    },
    foregroundFallback: {
      isFallbackInProgress: overrides.isFallbackInProgress ?? (() => false),
    },
    lifecycleSelectionResolver:
      overrides.resolver ?? (() => Promise.resolve(undefined as never)),
    hasInputWait: overrides.hasInputWait ?? (() => false),
    coordinator: lifecycleStub,
  });
}

const options = (n = 0): CapturedOptions =>
  capturedOptions[n] as CapturedOptions;

describe('registerWakeScheduler wiring', () => {
  test('forwards scheduler config and board injection from runtime', () => {
    wired();
    const o = options(0);
    expect(o.config).toEqual(runtimeStub.backgroundJobs.orchestratorWake);
    expect(o.boardInjectionEnabled).toBe(true);
  });

  test('shouldManageSession is true only for orchestrator agents', () => {
    wired({
      getAgent: (id) => (id === 'p1' ? 'orchestrator' : 'explorer'),
    });
    const fn = options(0).shouldManageSession as (id: string) => boolean;
    expect(fn('p1')).toBeTrue();
    expect(fn('other')).toBeFalse();
  });

  test('shouldManageSession is false for undefined agents', () => {
    wired();
    const fn = options(0).shouldManageSession as (id: string) => boolean;
    expect(fn('nobody')).toBeFalse();
  });

  test('isWriterLaneTask grades the board record agent', () => {
    wired({
      get: (taskID) =>
        taskID === 'writer'
          ? recordStub({ agent: 'orchestrator' })
          : recordStub({ taskID: 'reader', agent: 'explorer' }),
    });
    const fn = options(0).isWriterLaneTask as (taskID: string) => boolean;
    expect(fn('writer')).toBeTrue();
    expect(fn('reader')).toBeFalse();
  });

  test('isWriterLaneTask with no record grades as writer (fail-safe)', () => {
    wired();
    const fn = options(0).isWriterLaneTask as (taskID: string) => boolean;
    expect(fn('missing')).toBeTrue();
  });

  test('isStoppedJobRecoveryCurrent tolerates missing generation field', () => {
    wired({ get: () => recordStub({ generation: undefined }) });
    const fn = options(0).isStoppedJobRecoveryCurrent as (
      t: string,
      g: number,
    ) => boolean;
    // undefined !== any generation → not current, and no throw.
    expect(fn('t1', 5)).toBeFalse();
  });

  test('isStoppedJobRecoveryCurrent requires generation match and stopped+unreconciled', () => {
    wired({
      get: (taskID) =>
        recordStub({
          taskID,
          state: 'stopped',
          terminalUnreconciled: true,
          generation: 2,
        }),
    });
    const fn = options(0).isStoppedJobRecoveryCurrent as (
      t: string,
      g: number,
    ) => boolean;
    expect(fn('t1', 2)).toBeTrue();
    expect(fn('t1', 3)).toBeFalse();
  });

  test('isStoppedJobRecoveryCurrent rejects running state', () => {
    wired({ get: () => recordStub({ state: 'running', generation: 2 }) });
    const fn = options(0).isStoppedJobRecoveryCurrent as (
      t: string,
      g: number,
    ) => boolean;
    expect(fn('t1', 2)).toBeFalse();
  });

  test('isChildInputWaitCurrent true for running record with live wait', () => {
    // Drive the real registry: note a wait, then the closure must see it.
    const {
      noteChildInputWait,
      resetChildInputWaitForTests,
    } = require('../hooks/task-session-manager/child-input-wait');
    resetChildInputWaitForTests();
    noteChildInputWait({
      taskID: 't1',
      parentSessionID: 'p1',
      kind: 'question',
      requestID: 'request-1',
      questions: [{ header: 'h', question: 'q', options: [{ label: 'a' }] }],
    });
    wired({ get: () => recordStub() });
    const fn = options(0).isChildInputWaitCurrent as (
      t: string,
      r: string,
    ) => boolean;
    expect(fn('t1', 'request-1')).toBeTrue();
    expect(fn('t1', 'request-missing')).toBeFalse();
    resetChildInputWaitForTests();
  });

  test('isChildInputWaitCurrent requires running state and a live wait', () => {
    wired({ get: () => recordStub() });
    const fn = options(0).isChildInputWaitCurrent as (
      t: string,
      r: string,
    ) => boolean;
    // No wait registered: even a running record is not current.
    expect(fn('t1', 'r1')).toBeFalse();
  });

  test('hasPendingDelegatedWork unions running and terminal-unreconciled', () => {
    wired({
      hasRunning: (id) => id === 'running-session',
      hasTerminalUnreconciled: (id) => id === 'blocked-session',
    });
    const fn = options(0).hasPendingDelegatedWork as (id: string) => boolean;
    expect(fn('running-session')).toBeTrue();
    expect(fn('blocked-session')).toBeTrue();
    expect(fn('idle-session')).toBeFalse();
  });

  test('isFallbackInProgress forwards to the fallback manager', () => {
    wired({ isFallbackInProgress: (id) => id === 'falling' });
    const fn = options(0).isFallbackInProgress as (id: string) => boolean;
    expect(fn('falling')).toBeTrue();
    expect(fn('steady')).toBeFalse();
  });

  test('hasInputWait forwards to the TSM probe', () => {
    wired({ hasInputWait: (id) => id === 'waiting' });
    const fn = options(0).hasInputWait as (id: string) => boolean;
    expect(fn('waiting')).toBeTrue();
    expect(fn('calm')).toBeFalse();
  });

  test('resolveSelection forwards the lifecycle resolver as-is', () => {
    const resolver = async () =>
      ({ agent: 'orchestrator', provenance: 'host-persisted' }) as never;
    wired({ resolver });
    expect(options(0).resolveSelection).toBe(resolver);
  });

  test('coordinator forwards as-is', () => {
    const coordinator = { marker: true } as never;
    const unit = registerWakeScheduler({
      ctx: ctxStub,
      runtime: runtimeStub as never,
      hostFlavor: () => undefined,
      sessionMetadata: { getAgent: () => undefined },
      backgroundJobCoordinator: {
        get: () => undefined,
        hasRunning: () => false,
        hasTerminalUnreconciled: () => false,
      },
      foregroundFallback: { isFallbackInProgress: () => false },
      lifecycleSelectionResolver: (() => undefined) as never,
      hasInputWait: () => false,
      coordinator,
    });
    expect(unit).toBe(fakeScheduler);
    expect(options(0).coordinator).toBe(coordinator);
  });
});
