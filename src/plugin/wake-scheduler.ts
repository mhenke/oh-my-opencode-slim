import { roleHasWriteCapability } from '../agents/role-definitions';
import type { RuntimeConfig } from '../config/runtime';
import { createOrchestratorWakeScheduler } from '../hooks';
import type { ForegroundFallbackManager } from '../hooks/foreground-fallback';
import type { SessionLifecycle } from '../hooks/session-lifecycle';
import {
  type ChildInputWaitRecord,
  getChildInputWait,
} from '../hooks/task-session-manager/child-input-wait';
import type { BackgroundJobRecord } from '../utils/background-job-board';
import type { SessionMetadataStore } from '../utils/session-metadata';
import type { SessionSelection } from '../utils/session-selection';

/**
 * Registration unit for the orchestrator wake scheduler. Extracted from
 * src/index.ts: the closures it builds are the wiring; ordering (after the
 * task-session-manager hook exists) is the root's responsibility.
 */
export function registerWakeScheduler(deps: {
  ctx: Parameters<typeof createOrchestratorWakeScheduler>[0];
  runtime: Pick<RuntimeConfig, 'backgroundJobs'>;
  hostFlavor: () => string | undefined;
  sessionMetadata: Pick<SessionMetadataStore, 'getAgent'>;
  backgroundJobCoordinator: {
    get(taskID: string): BackgroundJobRecord | undefined;
    hasRunning(sessionID: string): boolean;
    hasTerminalUnreconciled(sessionID: string): boolean;
  };
  foregroundFallback: Pick<ForegroundFallbackManager, 'isFallbackInProgress'>;
  lifecycleSelectionResolver: (sessionID: string) => Promise<SessionSelection>;
  hasInputWait: (sessionID: string) => boolean;
  coordinator: SessionLifecycle;
}) {
  return createOrchestratorWakeScheduler(deps.ctx, {
    // Upstream master semantics (merge of origin/master): v2 hosts deliver
    // each run's first terminal publication natively, so the periodic idle
    // evaluation is structurally off there; event-driven wakes keep their
    // own keys.
    config: {
      ...deps.runtime.backgroundJobs.orchestratorWake,
      periodicWakeEnabled: deps.hostFlavor() === 'v2'
        ? false
        : deps.runtime.backgroundJobs.orchestratorWake.periodicWakeEnabled ??
          true,
    },
    // Honoured switch: wake annotations follow the board the parent sees —
    // rendered on v1 unless boardInjection is false.
    boardInjectionEnabled: deps.runtime.backgroundJobs.boardInjection,
    childInputWakeKinds: deps.runtime.backgroundJobs.childInputWakeKinds,
    shouldManageSession: (sessionID) =>
      deps.sessionMetadata.getAgent(sessionID) === 'orchestrator',
    hasInputWait: (sessionID) => deps.hasInputWait(sessionID),
    isFallbackInProgress: (sessionID) =>
      deps.foregroundFallback.isFallbackInProgress(sessionID),
    resolveSelection: deps.lifecycleSelectionResolver,
    // C2 writer-lane predicate: the queued child's agent from the board
    // record, graded by its role's write permission data. A missing
    // record/agent reads as writer (fail-safe, verdict defaults to
    // attaching the verification sentence).
    isWriterLaneTask: (taskID) =>
      roleHasWriteCapability(deps.backgroundJobCoordinator.get(taskID)?.agent),
    isStoppedJobRecoveryCurrent: (taskID, generation) => {
      const record = deps.backgroundJobCoordinator.get(taskID);
      // Stryker disable OptionalChaining,ConditionalExpression: the record is
      // undefined on any untracked task (main path, covered by the
      // isWriterLaneTask no-record case) — assert-once semantics, not
      // verifiable through the deps' recording layer.
      return (
        record?.generation === generation &&
        record.state === 'stopped' &&
        record.terminalUnreconciled
      );
      // Stryker restore
    },
    isChildInputWaitCurrent: (taskID, requestID) => {
      const record = deps.backgroundJobCoordinator.get(taskID);
      // Stryker disable OptionalChaining,ConditionalExpression: same
      // record-undefined tolerance as above — the live-wait positive path is
      // covered by the registry-driven test.
      return (
        record?.state === 'running' &&
        getChildInputWait(taskID, requestID) !== undefined
      );
      // Stryker restore
    },
    hasPendingDelegatedWork: (sessionID) =>
      deps.backgroundJobCoordinator.hasRunning(sessionID) ||
      deps.backgroundJobCoordinator.hasTerminalUnreconciled(sessionID),
    coordinator: deps.coordinator,
  });
}

export type { ChildInputWaitRecord };
export type WakeScheduler = ReturnType<typeof createOrchestratorWakeScheduler>;
