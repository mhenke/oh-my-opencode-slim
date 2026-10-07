import type { Plugin, ToolDefinition } from '@opencode-ai/plugin';
import type { RuntimeConfig } from '../config/runtime';
import { createBuiltinMcps } from '../mcp';
import {
  ast_grep_replace,
  ast_grep_search,
  createAcpRunTool,
  createCancelTaskTool,
  createTaskMessageTool,
  createTaskReplyTool,
  createTaskResultTool,
  createTaskReviveTool,
  createTaskStatusTool,
  createWaitForUserTool,
  createWebfetchTool,
} from '../tools';
import { pickAgentModelRef } from '../tools/smartfetch/secondary-model';
import type { TaskActivityTracker } from '../tools/task-activity';
import { resolveRuntimeAgentName } from '../utils';
import type { BackgroundJobs } from './background-jobs';
import type { SessionState } from './session-state';

/**
 * Builds the tool surface: built-in MCPs, the ACP run tool, webfetch, the
 * task tool family (cancel/message/reply/result/revive/status), the
 * wait-for-user tool, and the final assembly with the disabled-tools filter
 * applied.
 *
 * Construction mirrors the original plugin-factory statement order. `mcps`
 * is returned by reference: the registry bridge passes it as pluginMcps and
 * the config hook prunes/re-merges its keys in place.
 */
export function createTools(
  ctx: Parameters<Plugin>[0],
  deps: {
    runtime: RuntimeConfig;
    jobs: BackgroundJobs;
    sessionState: SessionState;
    taskActivityTracker: TaskActivityTracker;
    hostFlavor: string | undefined;
    isDisposed: () => boolean;
  },
): {
  tools: Record<string, ToolDefinition>;
  mcps: ReturnType<typeof createBuiltinMcps>;
  toolCount: number;
} {
  const {
    runtime,
    jobs,
    sessionState,
    taskActivityTracker,
    hostFlavor,
    isDisposed,
  } = deps;
  const { sessionMetadata, registerV1DelegatedIntent } = sessionState;

  const mcps = createBuiltinMcps(runtime.disabledMcps);
  const acpRunTools: Record<
    string,
    ReturnType<typeof createAcpRunTool>
  > = Object.keys(runtime.acpAgents ?? {}).length > 0
    ? { acp_run: createAcpRunTool(runtime.acpAgents) }
    : {};
  const webfetchModel = runtime.webfetch?.model;
  const webfetchModels = (() => {
    if (!webfetchModel) return undefined;
    const entries = Array.isArray(webfetchModel)
      ? webfetchModel
      : [webfetchModel];
    type ModelRefInput = string | { id: string; variant?: string };
    const models: Array<{ id: string; variant?: string }> = [];
    for (const entry of entries as ModelRefInput[]) {
      const id = typeof entry === 'string' ? entry : entry.id;
      if (!id) continue;
      models.push({
        id,
        ...(typeof entry === 'object' && entry.variant
          ? { variant: entry.variant }
          : {}),
      });
    }
    return models.length > 0 ? models : undefined;
  })();
  const webfetch = createWebfetchTool(ctx, {
    binaryDir: undefined,
    imageRouting: () => runtime.imageRouting,
    webfetchModels,
    explorerModel: pickAgentModelRef(runtime.agent('explorer')?.model),
    librarianModel: pickAgentModelRef(runtime.agent('librarian')?.model),
    smallModelRef: () => runtime.smallModel(),
  });

  const taskCancelTools = createCancelTaskTool({
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    terminalGate: jobs.terminalGate,
    shouldManageSession: (sessionID) =>
      sessionMetadata.getAgent(sessionID) === 'orchestrator' ||
      sessionMetadata.isTaskManaged(sessionID),
    recoverRetainedSession: jobs.recoverRetainedSession,
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
    isDisposed,
  });
  const taskMessageTools = createTaskMessageTool({
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    promptMessageIDFor: (taskID, generation) =>
      jobs.revivedRunTracker.promptMessageIDFor(taskID, generation),
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
    isDisposed,
  });
  const taskReplyTools = createTaskReplyTool({
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
    isDisposed,
  });
  const taskResultTools = createTaskResultTool({
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    terminalGate: jobs.terminalGate,
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
    isDisposed,
  });
  const taskReviveTools = createTaskReviveTool({
    ...(hostFlavor !== 'v2' && { registerIntent: registerV1DelegatedIntent }),
    terminalGate: jobs.terminalGate,
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    shouldManageSession: (sessionID) =>
      sessionMetadata.getAgent(sessionID) === 'orchestrator' ||
      sessionMetadata.isTaskManaged(sessionID),
    backgroundJobSupervisor: jobs.supervisor,
    revivedRunTracker: jobs.revivedRunTracker,
    recoverRetainedSession: jobs.recoverRetainedSession,
    isDisposed,
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
  });
  const taskStatusTools = createTaskStatusTool({
    input: ctx,
    backgroundJobBoard: jobs.coordinator,
    activityTracker: taskActivityTracker,
    resolveCanonicalTaskRef: jobs.aliasAuthority.resolveCanonical,
    isDisposed,
  });
  const waitForUserTools = createWaitForUserTool({
    shouldManageSession: (sessionID) =>
      sessionMetadata.getAgent(sessionID) === 'orchestrator' ||
      sessionMetadata.isTaskManaged(sessionID),
    resolveAgentName: (agent) => resolveRuntimeAgentName(runtime, agent),
    registerSessionAsOrchestrator: (sessionID) => {
      sessionMetadata.markTaskManaged(sessionID);
    },
    beginUserWait: (sessionID) => {
      jobs.taskSessionManagerHook.beginUserWait(sessionID);
      jobs.wakeScheduler?.suppress(sessionID);
    },
    waitForUserGuardEnabled: runtime.backgroundJobs.waitForUserGuard,
    hasOutstandingBackgroundTasks: (sessionID) =>
      runtime.backgroundJobs.orchestratorWake.enabled &&
      jobs.coordinator.hasRunning(sessionID),
  });

  const shouldRegisterWebfetch = runtime.webfetch.enabled !== false;
  let tools: Record<string, ToolDefinition> = {
    ...taskCancelTools,
    ...taskMessageTools,
    ...taskReplyTools,
    ...taskResultTools,
    ...taskReviveTools,
    ...taskStatusTools,
    ...waitForUserTools,
    ...acpRunTools,
    ...(shouldRegisterWebfetch ? { webfetch } : {}),
    ast_grep_search,
    ast_grep_replace,
  };
  if (runtime.disabledTools.length > 0) {
    const disabledTools = new Set(runtime.disabledTools);
    tools = Object.fromEntries(
      Object.entries(tools).filter(([name]) => !disabledTools.has(name)),
    );
  }

  const toolCount =
    Object.keys(tools).length +
    ['marketplace_inspect', 'marketplace_manage'].filter(
      (name) => !runtime.disabledTools.includes(name),
    ).length;

  return { tools, mcps, toolCount };
}
