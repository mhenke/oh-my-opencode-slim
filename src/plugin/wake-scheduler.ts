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
    config: deps.runtime.backgroundJobs.orchestratorWake,
    boardInjectionEnabled: deps.runtime.backgroundJobs.boardInjection,
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
      return (
        record?.generation === generation &&
        record.state === 'stopped' &&
        record.terminalUnreconciled
      );
    },
    isChildInputWaitCurrent: (taskID, requestID) => {
      const record = deps.backgroundJobCoordinator.get(taskID);
      return (
        record?.state === 'running' &&
        getChildInputWait(taskID, requestID) !== undefined
      );
    },
    hasPendingDelegatedWork: (sessionID) =>
      deps.backgroundJobCoordinator.hasRunning(sessionID) ||
      deps.backgroundJobCoordinator.hasTerminalUnreconciled(sessionID),
    coordinator: deps.coordinator,
  });
}

export type { ChildInputWaitRecord };
export type WakeScheduler = ReturnType<typeof createOrchestratorWakeScheduler>;
