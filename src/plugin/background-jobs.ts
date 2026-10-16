import type { Plugin } from '@opencode-ai/plugin';
import { acquireAdmissionRuntime } from '../admission-runtime';
import type { RuntimeConfig } from '../config/runtime';
import type { ForegroundFallbackManager } from '../hooks/foreground-fallback';
import { listChildInputWaits } from '../hooks/task-session-manager/child-input-wait';
import { createBackgroundFallbackHandoff } from '../hooks/task-session-manager/fallback-observation-transfer';
import { createRevivedRunTracker } from '../hooks/task-session-manager/revived-run-tracker';
import {
  BackgroundJobBoard,
  BackgroundJobCoordinator,
  BackgroundJobSupervisor,
} from '../utils';
import {
  type BackgroundJobEvictedSession,
  type BackgroundJobRecord,
  type ContextFile,
  isPrunableEvictedSession,
} from '../utils/background-job-board';
import { createBackgroundJobTerminalGate } from '../utils/background-job-terminal-gate';
import { pruneEvictedHostSession } from '../utils/evicted-session-prune';
import { registerPendingSessionPrune } from '../utils/pending-session-prunes';
import type { SessionMetadataStore } from '../utils/session-metadata';
import { DEFAULT_RUNTIME_SESSION_STATUS_TIMEOUT_MS } from '../utils/session-runtime-status';
import type { SessionSelection } from '../utils/session-selection';
import { delegationWording } from '../v2/delegation';

/**
 * Registration unit for the background-jobs subsystem: board, admission
 * lease/concurrency, coordinator, terminal gate, supervisor, revived-run
 * tracker, and the fallback observation handoff.
 *
 * Construction order is load-bearing and preserved from src/index.ts: the
 * terminal gate is built before the supervisor (which needs it) and before
 * the foreground-fallback manager + task-session-manager hook (which the
 * root constructs later — reached through getters, matching the original
 * `?.` tolerances). The revived-run tracker's TSM-facing callbacks arrive
 * as `revivedRunCallbacks`; they late-bind root `let`s that are assigned
 * when the task-session-manager hook exists.
 */
export function createBackgroundJobsSystem(deps: {
  ctx: Parameters<Plugin>[0];
  runtime: Pick<RuntimeConfig, 'backgroundJobs'>;
  /** Snapshot at call time — same flow position as the original wiring. */
  hostFlavor: string | undefined;
  sessionMetadata: Pick<SessionMetadataStore, 'getModel'>;
  lifecycleSelectionResolver: (sessionID: string) => Promise<SessionSelection>;
  resolvePrimaryModelFromFinalHostConfig: (
    agentType: string,
  ) => string | undefined;
  revivedRunCallbacks: {
    onRegister(taskID: string): void;
    onSettled(taskID: string): void;
    contextFilesFor(taskID: string): ContextFile[];
    prune(): void;
  };
  getForegroundFallback: () => ForegroundFallbackManager | undefined;
  getTaskSessionManagerHook: () =>
    | { hasDeferredError(taskID: string): boolean }
    | undefined;
  getOrchestratorWakeScheduler: () =>
    | {
        triggerTerminalPublicationWake(
          parentSessionID: string,
          taskID: string,
          generation: number,
        ): Promise<unknown> | undefined;
      }
    | undefined;
}) {
  const delegation = delegationWording(deps.hostFlavor);
  const backgroundJobBoard = new BackgroundJobBoard({
    maxReusablePerAgent: deps.runtime.backgroundJobs.maxSessionsPerAgent,
    delegationTool: delegation.tool,
    deferNumberedAliases: true,
    // Terminal-session GC (#1387 P2): when a retention trim evicts a
    // terminal or retained-stopped record, remove the underlying host
    // child session — but only a background, non-provisional child this
    // plugin launched itself (never foreground children, unattributed
    // placeholders, or adopted/restored/rehydrated sessions), and only
    // after bounded host reads confirm its parentID still matches the
    // record's parent and it is idle, and the board does not track it
    // again. A parked child-input wait blocks removal. The prune is
    // fire-and-forget so the synchronous board never awaits it; the
    // delete has a deadline so the pending-prune fence always settles.
    ...(deps.runtime.backgroundJobs.pruneEvictedSessions
      ? {
          onEvictedSession: (evicted: BackgroundJobEvictedSession) => {
            if (!isPrunableEvictedSession(evicted)) return;
            if (listChildInputWaits(evicted.taskID).length > 0) return;
            // Same-tick: the prune (parent read + delete) starts and is
            // registered in one synchronous step with no await in
            // between, so a task_revive can never observe a
            // started-but-unregistered prune and adopt the session the
            // delete is about to remove (#1387 race).
            registerPendingSessionPrune(
              evicted.taskID,
              pruneEvictedHostSession({
                session: deps.ctx.client.session,
                directory: deps.ctx.directory,
                evicted,
                readTimeoutMs: DEFAULT_RUNTIME_SESSION_STATUS_TIMEOUT_MS,
                deleteTimeoutMs: DEFAULT_RUNTIME_SESSION_STATUS_TIMEOUT_MS,
                isTracked: (taskID) => backgroundJobBoard.isTracked(taskID),
              }),
            );
          },
        }
      : {}),
  });
  const admissionRuntimeLease = acquireAdmissionRuntime(
    deps.ctx.directory,
    deps.runtime.backgroundJobs.concurrency,
  );
  const backgroundTaskConcurrency =
    admissionRuntimeLease.backgroundTaskConcurrency;

  // Initialize coordinator as the sole writer to the board
  const backgroundJobCoordinator = new BackgroundJobCoordinator(
    backgroundJobBoard,
  );

  let supervisorRef: BackgroundJobSupervisor | undefined;
  let revivedRunTracker: ReturnType<typeof createRevivedRunTracker> | undefined;
  const terminalGate = createBackgroundJobTerminalGate({
    backgroundJobBoard: backgroundJobCoordinator,
    input: deps.ctx,
    // Configurable stop-confirmation grace (backgroundJobs.
    // stopConfirmationMs); the default equals
    // STOP_CONFIRMATION_GRACE_MS, so unset config keeps v1 behavior.
    graceMs: deps.runtime.backgroundJobs.stopConfirmationMs,
    // Stryker disable OptionalChaining: the tracker is constructed AFTER the
    // gate on purpose — these probes run pre- and post-tracker-time; direct
    // tests exercise the absent side, the tracker's suite the defined side.
    baselineFor: (taskID, generation) =>
      revivedRunTracker?.baselineFor(taskID, generation),
    promptMessageIDFor: (taskID, generation) =>
      revivedRunTracker?.promptMessageIDFor(taskID, generation),
    // Local in-process integration: host and plugin timestamps share Unix ms.
    hostOutcomeClock: 'shared-unix-ms',
    attemptStartedAtFor: (taskID, generation) =>
      revivedRunTracker?.attemptStartedAtFor(taskID, generation),
    observationRevisionFor: (taskID, generation) =>
      revivedRunTracker?.revisionFor(taskID, generation),
    /* Stryker restore */
    isObservationPending: (taskID, generation) =>
      (deps.getForegroundFallback()?.isFallbackInProgress(taskID) ?? false) ||
      (deps.getTaskSessionManagerHook()?.hasDeferredError(taskID) ?? false) ||
      (revivedRunTracker?.isObservationPending(taskID, generation) ?? false),
    onRunning: (record: BackgroundJobRecord) => {
      if (record.background)
        backgroundTaskConcurrency.restoreTask(
          record.taskID,
          deps.sessionMetadata.getModel(record.taskID) ??
            deps.resolvePrimaryModelFromFinalHostConfig(record.agent) ??
            deps.sessionMetadata.getModel(record.parentSessionID),
        );
      if (
        !revivedRunTracker?.promptMessageIDFor(record.taskID, record.generation)
      )
        supervisorRef?.onLaunch(record);
    },
  });
  const backgroundJobSupervisor = new BackgroundJobSupervisor({
    backgroundJobStore: backgroundJobCoordinator,
    terminalGate,
    wallClockTimeoutMs: deps.runtime.backgroundJobs.wallClockTimeoutMs,
    abortGraceMs: deps.runtime.backgroundJobs.abortGraceMs,
    abort: (taskID) =>
      deps.ctx.client.session.abort({
        path: { id: taskID },
      }),
  });
  supervisorRef = backgroundJobSupervisor;
  revivedRunTracker = createRevivedRunTracker({
    input: deps.ctx,
    backgroundJobBoard: backgroundJobCoordinator,
    terminalGate,
    backgroundJobSupervisor,
    resolveSelection: deps.lifecycleSelectionResolver,
    onRegister: (taskID) => deps.revivedRunCallbacks.onRegister(taskID),
    onSettled: (taskID) => deps.revivedRunCallbacks.onSettled(taskID),
    contextFilesForPrompt: (taskID) =>
      deps.revivedRunCallbacks.contextFilesFor(taskID),
    pruneContext: () => deps.revivedRunCallbacks.prune(),
    // Degraded-fallback wiring (revived-lineage strand): when every
    // tracker notification attempt has failed, the publication this
    // tracker suppressed in the terminal-outcome listener would
    // otherwise never reach the idle parent. Re-emit it DIRECTLY
    // through the wake scheduler — never through the listener's
    // suppression chain: a revived lineage has no native notifier, so
    // the first-publication-native-owned (and tracker-owned) skips
    // must not apply to this fallback. The scheduler's own guards
    // (canSchedule, one-flight wake gate, publication throttle) still
    // apply, correctly.
    onOwnershipReleased: (parentSessionID, taskID, generation) => {
      void deps
        .getOrchestratorWakeScheduler()
        ?.triggerTerminalPublicationWake(parentSessionID, taskID, generation)
        ?.catch(() => undefined);
    },
  });
  const backgroundFallbackHandoff = createBackgroundFallbackHandoff({
    backgroundJobBoard: backgroundJobCoordinator,
    revivedRunTracker,
  });
  return {
    backgroundJobBoard,
    admissionRuntimeLease,
    backgroundTaskConcurrency,
    backgroundJobCoordinator,
    terminalGate,
    backgroundJobSupervisor,
    revivedRunTracker,
    backgroundFallbackHandoff,
  };
}
