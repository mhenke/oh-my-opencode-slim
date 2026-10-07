import type { Plugin } from '@opencode-ai/plugin';
import {
  type AdmissionRuntimeLease,
  acquireAdmissionRuntime,
} from '../admission-runtime';
import type { RuntimeConfig } from '../config/runtime';
import {
  createOrchestratorWakeScheduler,
  createTaskSessionManagerHook,
  ForegroundFallbackManager,
  type ForegroundFallbackModel,
  formatChildInputWaitDelta,
  formatStoppedJobDelta,
  SessionLifecycle,
  stoppedJobRecoveryReason,
} from '../hooks';
import { clearAllWakeSessions } from '../hooks/orchestrator-wake/wake-gate';
import type { ChildInputWaitRecord } from '../hooks/task-session-manager/child-input-wait';
import {
  clearChildInputWaitsForSession,
  getChildInputWait,
  listChildInputWaits,
} from '../hooks/task-session-manager/child-input-wait';
import { createBackgroundFallbackHandoff } from '../hooks/task-session-manager/fallback-observation-transfer';
import { createRevivedRunTracker } from '../hooks/task-session-manager/revived-run-tracker';
import {
  createAliasAuthority,
  createSessionRecovery,
} from '../hooks/task-session-manager/session-recovery';
import {
  clearTuiSessionAlias,
  recordTuiSessionParent,
  updateTuiSessionDetails,
} from '../tui-state';
import {
  BackgroundJobBoard,
  BackgroundJobCoordinator,
  BackgroundJobSupervisor,
  type BackgroundTaskConcurrency,
} from '../utils';
import type {
  BackgroundJobEvictedSession,
  BackgroundJobRecord,
  ContextFile,
} from '../utils/background-job-board';
import { isPrunableEvictedSession } from '../utils/background-job-board';
import {
  type BackgroundJobTerminalGate,
  createBackgroundJobTerminalGate,
} from '../utils/background-job-terminal-gate';
import { hasLiveInstances } from '../utils/event-directory-scope';
import { pruneEvictedHostSession } from '../utils/evicted-session-prune';
import { log } from '../utils/logger';
import { registerPendingSessionPrune } from '../utils/pending-session-prunes';
import { DEFAULT_RUNTIME_SESSION_STATUS_TIMEOUT_MS } from '../utils/session-runtime-status';
import {
  createTuiReusableProjection,
  type ProjectorHandle,
} from '../utils/tui-reusable-projection';
import type { delegationWording } from '../v2/delegation';
import type { SessionState } from './session-state';

/**
 * Owns the plugin's background-job machinery: the job board, admission
 * lease, coordinator, TUI projection, terminal gate, supervisor, revived-run
 * tracker, session lifecycle coordinator, foreground fallback manager,
 * task-session-manager hook and orchestrator wake scheduler.
 *
 * Construction order inside this factory mirrors the original plugin-factory
 * statement order; the returned facade is consumed by the plugin factory's
 * hooks object and by the tools module.
 */
export function createBackgroundJobs(
  ctx: Parameters<Plugin>[0],
  deps: {
    runtime: RuntimeConfig;
    hostFlavor: string | undefined;
    delegation: ReturnType<typeof delegationWording>;
    sessionState: SessionState;
    isDisposed: () => boolean;
  },
) {
  const { runtime, hostFlavor, delegation, isDisposed } = deps;
  const {
    sessionMetadata,
    compactingSessionIds,
    lifecycleSelectionResolver,
    resolvePrimaryModelFromFinalHostConfig,
    resolveDelegatedModelForParent,
    markTuiAgentInactive,
    tuiActivityDirectory,
  } = deps.sessionState;

  // Slots rebound once the task-session-manager hook exists; listeners
  // registered earlier read them through these bindings (mirrors the former
  // factory lets).
  let markRevivedRunPending: (taskID: string) => void = () => {};
  let markRevivedRunSettled: (taskID: string) => void = () => {};
  let getRevivedContextFiles = (_taskID: string): ContextFile[] => [];
  let pruneRevivedContext = () => {};

  // The wake scheduler is created AFTER the task-session-manager hook (see
  // below): the hook's onChildInputWait closes over
  // queueChildInputWaitWake, which drops notifications that arrive before
  // the scheduler exists. The ask stays recorded in the sidecar and
  // task_status still surfaces it, so the parent can answer via task_reply.
  // In practice the scheduler is created synchronously in the same init,
  // before any host event can arrive.
  let orchestratorWakeScheduler:
    | ReturnType<typeof createOrchestratorWakeScheduler>
    | undefined;
  function queueChildInputWaitWake(
    record: BackgroundJobRecord,
    wait: ChildInputWaitRecord,
  ): void {
    orchestratorWakeScheduler?.triggerChildInputWaitWake(
      record.parentSessionID,
      formatChildInputWaitDelta({
        alias: record.alias,
        taskID: record.taskID,
        kind: wait.kind,
        requestID: wait.requestID,
        detail: formatChildInputWaitDetail(wait),
      }),
      `${record.taskID}:${wait.requestID}`,
    );
  }

  /**
   * Inline detail lines for a child input-wait wake delta: the ask content
   * the parent needs to answer (question text + options, or permission
   * summary).
   */
  function formatChildInputWaitDetail(wait: ChildInputWaitRecord): string {
    const lines = [`request: ${wait.requestID}`, `kind: ${wait.kind}`];
    if (wait.kind === 'permission') {
      lines.push(`permission: ${wait.permission ?? 'unknown'}`);
      if (wait.patterns && wait.patterns.length > 0) {
        lines.push(`patterns: ${wait.patterns.join(', ')}`);
      }
      return lines.join('\n');
    }
    if (!wait.questions || wait.questions.length === 0) {
      lines.push('(no question text captured)');
      return lines.join('\n');
    }
    for (const entry of wait.questions) {
      lines.push(`question: ${entry.question || entry.header}`);
      for (const option of entry.options) {
        lines.push(
          `option: ${option.label}${option.description ? ` — ${option.description}` : ''}`,
        );
      }
    }
    return lines.join('\n');
  }

  let terminalGate: BackgroundJobTerminalGate | undefined;
  let admissionRuntimeLease: AdmissionRuntimeLease | undefined;
  let tuiReusableProjection: ProjectorHandle | undefined;

  // Init-catch teardown: today's plugin-factory catch disposes the terminal
  // gate and releases the admission lease for anything constructed so far.
  const abort = (): void => {
    terminalGate?.dispose();
    admissionRuntimeLease?.release();
  };

  let backgroundJobBoard: BackgroundJobBoard;
  let backgroundJobSupervisor: BackgroundJobSupervisor;
  let backgroundTaskConcurrency: BackgroundTaskConcurrency;
  let foregroundFallbackChains: Record<string, ForegroundFallbackModel[]>;
  let foregroundFallback: ForegroundFallbackManager;
  let sessionLifecycle: SessionLifecycle;
  let revivedRunTracker: ReturnType<typeof createRevivedRunTracker>;
  let taskSessionManagerHook: ReturnType<typeof createTaskSessionManagerHook>;
  let aliasAuthority: ReturnType<typeof createAliasAuthority>;
  let recoverRetainedSession: ReturnType<typeof createSessionRecovery>;
  let backgroundJobCoordinator: BackgroundJobCoordinator;

  try {
    backgroundJobBoard = new BackgroundJobBoard({
      maxReusablePerAgent: runtime.backgroundJobs.maxSessionsPerAgent,
      maxContextLines: runtime.backgroundJobs.maxContextLines,
      readContextMinLines: runtime.backgroundJobs.readContextMinLines,
      readContextMaxFiles: runtime.backgroundJobs.readContextMaxFiles,
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
      ...(runtime.backgroundJobs.pruneEvictedSessions
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
                  session: ctx.client.session,
                  directory: ctx.directory,
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
    admissionRuntimeLease = acquireAdmissionRuntime(
      ctx.directory,
      runtime.backgroundJobs.concurrency,
    );
    backgroundTaskConcurrency = admissionRuntimeLease.backgroundTaskConcurrency;

    // Initialize coordinator as the sole writer to the board
    backgroundJobCoordinator = new BackgroundJobCoordinator(backgroundJobBoard);
    // Project launch identity (alias↔session) into TUI state so the
    // clickable sidebar can label active subagent sessions. Best-effort:
    // a failed tui-state write must never fail a launch.
    //
    // Each generation must retract its own projected sections on dispose:
    // a reload reuses this PID, so the startup dead-owner sweep retains
    // the previous generation's entries until explicitly removed.
    tuiReusableProjection = createTuiReusableProjection({
      board: backgroundJobBoard,
      projectDir: ctx.directory,
    });
    backgroundJobCoordinator.addLaunchIdentityListener((event) => {
      const directory = tuiActivityDirectory(event.taskID);
      if (event.kind === 'registered') {
        if (event.parentSessionID && event.parentSessionID !== event.taskID) {
          recordTuiSessionParent(
            event.taskID,
            event.parentSessionID,
            directory,
          );
        }
        updateTuiSessionDetails(
          event.taskID,
          { alias: event.alias },
          directory,
        );
      } else {
        clearTuiSessionAlias(event.taskID, directory);
      }
    });
    terminalGate = createBackgroundJobTerminalGate({
      backgroundJobBoard: backgroundJobCoordinator,
      input: ctx,
      // Configurable stop-confirmation grace (backgroundJobs.
      // stopConfirmationMs); the default equals
      // STOP_CONFIRMATION_GRACE_MS, so unset config keeps v1 behavior.
      graceMs: runtime.backgroundJobs.stopConfirmationMs,
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
      isObservationPending: (taskID, generation) =>
        revivedRunTracker?.isObservationPending(taskID, generation) ?? false,
      onRunning: (record) => {
        if (record.background)
          backgroundTaskConcurrency.restoreTask(
            record.taskID,
            sessionMetadata.getModel(record.taskID) ??
              resolvePrimaryModelFromFinalHostConfig(record.agent) ??
              sessionMetadata.getModel(record.parentSessionID),
          );
        if (
          !revivedRunTracker?.promptMessageIDFor(
            record.taskID,
            record.generation,
          )
        )
          backgroundJobSupervisor?.onLaunch(record);
      },
    });
    backgroundJobSupervisor = new BackgroundJobSupervisor({
      backgroundJobStore: backgroundJobCoordinator,
      terminalGate,
      wallClockTimeoutMs: runtime.backgroundJobs.wallClockTimeoutMs,
      abortGraceMs: runtime.backgroundJobs.abortGraceMs,
      abort: (taskID) =>
        ctx.client.session.abort({
          path: { id: taskID },
        }),
    });
    backgroundJobCoordinator.addTerminalOutcomeListener((record) => {
      const current = backgroundJobCoordinator.get(record.taskID);
      if (
        current?.generation !== record.generation ||
        current.terminalRevision !== record.terminalRevision ||
        current.state === 'running'
      )
        return;
      backgroundJobCoordinator.addContext(
        record.taskID,
        getRevivedContextFiles(record.taskID),
      );
      markRevivedRunSettled(record.taskID);
      pruneRevivedContext();
      backgroundJobSupervisor.onTerminal(record);
      backgroundTaskConcurrency.releaseTask(record.taskID);
    });
    revivedRunTracker = createRevivedRunTracker({
      input: ctx,
      backgroundJobBoard: backgroundJobCoordinator,
      terminalGate,
      backgroundJobSupervisor,
      resolveSelection: lifecycleSelectionResolver,
      onRegister: (taskID) => markRevivedRunPending(taskID),
      onSettled: (taskID) => markRevivedRunSettled(taskID),
      contextFilesForPrompt: (taskID) => getRevivedContextFiles(taskID),
      pruneContext: () => pruneRevivedContext(),
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
        void orchestratorWakeScheduler
          ?.triggerTerminalPublicationWake(parentSessionID, taskID, generation)
          ?.catch(() => undefined);
      },
    });
    backgroundJobCoordinator.addTerminalOutcomeListener((record) => {
      revivedRunTracker.onTerminal(record);
      markTuiAgentInactive(record.taskID);
    });
    // Pane lifecycle runs in the client (TUI) process, never here: the server
    // entry only keeps its own sidebar activity bookkeeping.
    backgroundJobCoordinator.addTerminalStateListener((taskID) => {
      markTuiAgentInactive(taskID);
    });

    sessionLifecycle = new SessionLifecycle(log);
    sessionLifecycle.onSessionDeleted((sessionID) => {
      compactingSessionIds.delete(sessionID);
    });

    // Initialize foreground fallback manager for runtime model switching.
    // Agents without a chain (e.g. councillor, owned by CouncilManager) are
    // left alone — FG only aborts/re-prompts when it has a model to switch to.
    // The observation handoff brackets the re-prompt admission for
    // BACKGROUND children (false-stop incident): prepare() defers the stop
    // gate before the await, admit() enrolls the run tracker after host
    // acceptance, reject() withdraws on failure; see
    // fallback-observation-transfer.ts.
    const backgroundFallbackHandoff = createBackgroundFallbackHandoff({
      backgroundJobBoard: backgroundJobCoordinator,
      revivedRunTracker,
    });
    // The current v2 host interface has no per-turn/atomic conditional
    // switch, so an in-flight REPLAY (abort + re-prompt) can commit on the
    // host after a newer user turn has taken over — the replay path stays
    // disabled on v2 (a3ac0bee). The retry-hook steering path performs no
    // replay: it mutates the host's in-flight retry decision and switches
    // the model in place via session.switchModel, so the a3ac0bee race
    // cannot occur. Steering is host-agnostic (only v2 hosts invoke the
    // hook) and follows the same user switches as the replay path
    // (fallback.enabled / disabled_hooks).
    const fallbackUserEnabled =
      runtime.fallback.enabled !== false &&
      !runtime.disabledHooks.has('foreground-fallback');
    const fallbackEnabled = fallbackUserEnabled && hostFlavor !== 'v2';
    const v2RetryEnabled = fallbackUserEnabled;
    if (fallbackUserEnabled && hostFlavor === 'v2') {
      // Deterministic notice: no timestamps or per-call ids. Do not log when
      // the user explicitly disabled fallback, including via disabled_hooks.
      log(
        '[foreground-fallback] v2 replay fallback disabled (no atomic per-turn model switch); retry-hook steering active',
      );
    }
    foregroundFallbackChains = runtime.modelArrays;
    foregroundFallback = new ForegroundFallbackManager(
      foregroundFallbackChains,
      fallbackEnabled,
      ctx,
      runtime.fallback.maxRetries,
      sessionLifecycle,
      // A managed background-task session switching models mid-flight must
      // move its admission accounting (provider/model caps) to the new
      // model. No-op for unknown/non-task sessions; idempotent per model.
      (sessionID, model) =>
        backgroundTaskConcurrency.migrateTask(sessionID, model),
      runtime.fallback.initialRetryDelayMs,
      runtime.fallback.retryDelayMs,
      backgroundFallbackHandoff,
      // Generation fence captured BEFORE any await in the fallback
      // preparation, and ONLY for confirmed BACKGROUND children:
      // undefined for foreground/unmanaged sessions means "observation
      // handoff not applicable" — never a wildcard — so a stale-
      // generation rejection can be distinguished from a legitimate
      // foreground fallback.
      (sessionID) => {
        const record = backgroundJobCoordinator.get(sessionID);
        return record?.state === 'running' && record.background === true
          ? record.generation
          : undefined;
      },
      (sessionID) => backgroundJobCoordinator.hasRunning(sessionID),
      v2RetryEnabled,
    );

    recoverRetainedSession = createSessionRecovery({
      input: ctx,
      backgroundJobBoard: backgroundJobCoordinator,
      isDisposed,
      hostFlavor,
    });
    aliasAuthority = createAliasAuthority({
      input: ctx,
      board: backgroundJobBoard,
      isDisposed,
    });
    taskSessionManagerHook = createTaskSessionManagerHook(ctx, {
      terminalGate,
      strategy: runtime.backgroundJobs.strategy,
      maxSessionsPerAgent: runtime.backgroundJobs.maxSessionsPerAgent,
      maxRetainedSnapshots: runtime.backgroundJobs.maxRetainedSnapshots,
      readContextMinLines: runtime.backgroundJobs.readContextMinLines,
      readContextMaxFiles: runtime.backgroundJobs.readContextMaxFiles,
      boardInjection: runtime.backgroundJobs.boardInjection,
      backgroundJobBoard: backgroundJobCoordinator,
      backgroundJobSupervisor,
      backgroundTaskConcurrency,
      pendingCallTracker: admissionRuntimeLease.pendingCallTracker,
      getModelForAgent: (agentType: string, parentSessionID?: string) => {
        const delegated = resolveDelegatedModelForParent(
          agentType,
          parentSessionID,
        );
        if (delegated) return delegated.entry.id;

        // Admission must use the config after the host has merged all of its
        // agent layers. The direct lookup preserves display-name keys; the
        // resolved lookup handles canonical names and legacy aliases.
        return (
          resolvePrimaryModelFromFinalHostConfig(agentType) ??
          (parentSessionID
            ? sessionMetadata.getModel(parentSessionID)
            : undefined)
        );
      },
      sameProviderPolicy: runtime.backgroundJobs.sameProviderPolicy,
      getSessionModel: (sessionID) =>
        foregroundFallback.getActiveFallbackModel(sessionID) ??
        sessionMetadata.getModel(sessionID),
      hostFlavor,
      recoverRetainedSession,
      resolveCanonicalTaskRef: aliasAuthority.resolveCanonical,
      isDisposed,
      shouldManageSession: (sessionID) =>
        sessionMetadata.getAgent(sessionID) === 'orchestrator' ||
        sessionMetadata.isTaskManaged(sessionID),
      registerSessionAsOrchestrator: (sessionID) => {
        // Membership in task management, not a selection rewrite (#1079).
        sessionMetadata.markTaskManaged(sessionID);
      },
      isFallbackInProgress: (sessionID) =>
        foregroundFallback.isFallbackInProgress(sessionID),
      willAttemptFallback: (sessionID) =>
        foregroundFallback.willAttemptFallback(sessionID),
      coordinator: sessionLifecycle,
      revivedRunTracker,
      onChildInputWait: (notification) => {
        if (runtime.backgroundJobs.childInputWake === false) return;
        const record = backgroundJobCoordinator.get(notification.taskID);
        if (record?.state !== 'running') {
          return;
        }
        const wait = getChildInputWait(
          notification.taskID,
          notification.requestID,
        );
        if (!wait) return;
        queueChildInputWaitWake(record, wait);
      },
    });
    markRevivedRunPending = taskSessionManagerHook.markRevivedRunPending;
    markRevivedRunSettled = taskSessionManagerHook.clearRevivedRunPending;
    getRevivedContextFiles = taskSessionManagerHook.contextFilesForTask;
    pruneRevivedContext = taskSessionManagerHook.pruneTaskContext;

    orchestratorWakeScheduler = createOrchestratorWakeScheduler(ctx, {
      config: runtime.backgroundJobs.orchestratorWake,
      boardInjectionEnabled: runtime.backgroundJobs.boardInjection,
      shouldManageSession: (sessionID) =>
        sessionMetadata.getAgent(sessionID) === 'orchestrator',
      hasInputWait: (sessionID) =>
        taskSessionManagerHook.hasInputWait(sessionID),
      isFallbackInProgress: (sessionID) =>
        foregroundFallback.isFallbackInProgress(sessionID),
      resolveSelection: lifecycleSelectionResolver,
      isStoppedJobRecoveryCurrent: (taskID, generation) => {
        const record = backgroundJobCoordinator.get(taskID);
        return (
          record?.generation === generation &&
          record.state === 'stopped' &&
          record.terminalUnreconciled
        );
      },
      isChildInputWaitCurrent: (taskID, requestID) => {
        const record = backgroundJobCoordinator.get(taskID);
        return (
          record?.state === 'running' &&
          getChildInputWait(taskID, requestID) !== undefined
        );
      },
      hasPendingDelegatedWork: (sessionID) =>
        backgroundJobCoordinator.hasRunning(sessionID) ||
        backgroundJobCoordinator.hasTerminalUnreconciled(sessionID),
      coordinator: sessionLifecycle,
    });
    backgroundJobCoordinator.addTerminalOutcomeListener((record) => {
      // A placeholder is not delegated work; its stop is not recoverable
      // by the parent until a task launch has attributed the session.
      if (record.provisional === true) return;
      // A child's terminal state resolves any of its open input waits: the
      // ask is gone with the run, so a queued wake must not fire for it.
      clearChildInputWaitsForSession(record.taskID);
      if (record.state !== 'stopped' || !record.terminalUnreconciled) return;
      // Symmetric tracker suppression (M4): when the revived-run tracker
      // owns this generation's delivery — it already delivered the run's
      // terminal <task> notification — a recovery wake beside it would
      // queue a second admission for a lineage the parent already heard
      // from. Scoped like the publication listener's check: a stop that
      // is the generation's FIRST publication has no tracker delivery
      // beside it (the tracker only delivers completed/error), so the
      // recovery wake stays that stop's one and only notification.
      if (
        record.terminalRevision > 1 &&
        revivedRunTracker.willNotifyParent(record.taskID, record.generation)
      ) {
        log('[orchestrator-wake] stopped-job recovery wake skipped', {
          sessionID: record.parentSessionID,
          taskID: record.taskID,
          generation: record.generation,
          trigger: 'stopped-job-recovery',
          verdict: 'skipped',
          reason: 'revived-tracker-owns-delivery',
        });
        return;
      }
      orchestratorWakeScheduler?.triggerStoppedJobRecovery(
        record.parentSessionID,
        // Self-contained stop facts: the recovery wake is an
        // internal-initiator message, so under `checkpoint-compatible` it
        // cannot create a board snapshot and any retained snapshot predates
        // this stop (issue #1051).
        formatStoppedJobDelta({
          alias: record.alias,
          taskID: record.taskID,
          generation: record.generation,
          state: record.state,
          reason: stoppedJobRecoveryReason(record),
        }),
        `${record.taskID}:${record.generation}`,
      );
    });
    // Terminal-publication wake: completed/error publications reaching an
    // IDLE parent (state-disjoint from the stopped recovery listener
    // above — stopped+terminalUnreconciled vs completed|error). A busy
    // parent is skipped inside the trigger: the native steer already
    // delivered the first completion, so a queued wake would
    // double-notify.
    backgroundJobCoordinator.addTerminalOutcomeListener((record) => {
      if (record.state !== 'completed' && record.state !== 'error') return;
      // Revived-run ownership: when the tracker will deliver this run's
      // <task> result itself (notifyParent), a publication wake beside
      // it would queue a SECOND admission to the idle parent — the
      // double-notify the exactly-once notification contract forbids.
      // Scoped to the exact (taskID, generation) the tracker owns;
      // non-revived publications are unaffected.
      if (
        revivedRunTracker.willNotifyParent(record.taskID, record.generation)
      ) {
        log('[orchestrator-wake] terminal publication wake skipped', {
          sessionID: record.parentSessionID,
          taskID: record.taskID,
          generation: record.generation,
          trigger: 'terminal-publication',
          verdict: 'skipped',
          reason: 'revived-tracker-owns-delivery',
        });
        return;
      }
      // First-publication ownership (live-verified on a 2.0.8 host): the
      // native notifier delivers a run's FIRST terminal publication to
      // the parent even while it sits idle, so a plugin wake beside it
      // would double-notify. On v2 EVERY plugin task launch AND relaunch
      // is a host `subagent` tool call that arms the host's native
      // background notifier — a relaunch re-arms it with a fresh
      // `started_at`, defeating the notify dedupe — so the native
      // contract covers the FIRST publication (terminalRevision 1) of
      // EVERY generation, not just the original launch. Only later
      // revisions of the same generation (rev>1: a child
      // self-continuation, a direct prompt to the child session) have no
      // native notifier and remain the plugin's to deliver (v1 behaves
      // the same: the native task tool arms notifyBackgroundResult per
      // background call). Edge: if a native delivery is ever lost
      // host-side, the job falls back to the passive display channel on
      // the parent's next activity — board injection when enabled, or
      // nothing until the next task_status/task_result pull otherwise.
      if (record.terminalRevision === 1) {
        log('[orchestrator-wake] terminal publication wake skipped', {
          sessionID: record.parentSessionID,
          taskID: record.taskID,
          generation: record.generation,
          trigger: 'terminal-publication',
          verdict: 'skipped',
          reason: 'first-publication-native-owned',
        });
        return;
      }
      void orchestratorWakeScheduler
        ?.triggerTerminalPublicationWake(
          record.parentSessionID,
          record.taskID,
          record.generation,
        )
        ?.catch(() => undefined);
    });
  } catch (err) {
    abort();
    throw err;
  }

  return {
    coordinator: backgroundJobCoordinator,
    board: backgroundJobBoard,
    terminalGate,
    supervisor: backgroundJobSupervisor,
    revivedRunTracker,
    wakeScheduler: orchestratorWakeScheduler,
    taskSessionManagerHook,
    foregroundFallback,
    // Mutable chains map shared with the registry bridge: the bridge writes
    // finalized model candidates into this object after initialization.
    chains: foregroundFallbackChains,
    sessionLifecycle,
    admissionLease: admissionRuntimeLease,
    tuiReusableProjection,
    backgroundTaskConcurrency,
    aliasAuthority,
    recoverRetainedSession,
    abort,
    dispose: async () => {
      terminalGate?.dispose();
      // Cancel pending initial-delay fallback timers so a reloaded
      // generation cannot observe one stale fallback call.
      foregroundFallback.dispose();
      await taskSessionManagerHook.event({
        event: { type: 'server.instance.disposed' },
      });
      await orchestratorWakeScheduler.event({
        event: { type: 'server.instance.disposed' },
      });
      // The wake gate is process-global (globalThis + Symbol.for) and survives
      // module re-entry, so a reloaded generation would otherwise inherit the
      // previous generation's no-progress caps. Clear it only when this was the
      // last live instance: disposing one of several locations must not wipe
      // the other locations' wake state.
      if (!hasLiveInstances()) clearAllWakeSessions();
    },
    disposeProjection: () => {
      tuiReusableProjection?.dispose();
    },
    disposeLease: () => {
      // Release only this generation's ownership. The admission runtime
      // defers final scheduler/tracker teardown by one macrotask so an
      // immediate config-update re-init can retain active and queued calls.
      admissionRuntimeLease?.release();
    },
  };
}

export type BackgroundJobs = ReturnType<typeof createBackgroundJobs>;
