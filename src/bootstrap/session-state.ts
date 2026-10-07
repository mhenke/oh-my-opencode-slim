import type { Plugin } from '@opencode-ai/plugin';
import { resolvePrimaryModelValue } from '../agents';
import type { ResolvedAgentRegistry } from '../agents/registry';
import { DEFAULT_MAX_SESSION_METADATA_ENTRIES } from '../config/constants';
import type { RuntimeConfig } from '../config/runtime';
import type { ForegroundFallbackManager } from '../hooks';
import {
  clearTuiAgentActivities,
  readTuiSnapshot,
  recordTuiAgentActivity,
  recordTuiSessionParent,
  type TuiSessionDetails,
} from '../tui-state';
import type { BackgroundJobBoard } from '../utils';
import { log } from '../utils/logger';
import { resolveRuntimeAgentName } from '../utils';
import { SessionMetadataStore } from '../utils/session-metadata';
import {
  createSessionSelectionReader,
  resolveCurrentSelection,
} from '../utils/session-selection';

type ModelChainEntry = { id: string; variant?: string };

type DelegatedModelSelection = {
  agentName: string;
  entry: ModelChainEntry;
  /** The parent runs a real fallback that should move this child. */
  route: boolean;
  /** Inherited children already start on the parent's live model. */
  inherited?: true;
};

function modelProvider(model: string): string | undefined {
  const separator = model.indexOf('/');
  return separator > 0 ? model.slice(0, separator) : undefined;
}

/**
 * Pick the child-chain entry that best matches a parent's live fallback.
 * Once the parent has moved past its primary, exact model matches win,
 * then the working provider, then the first child entry outside the
 * providers already exhausted by the parent. Explicit inheritance stays live.
 */
function selectDelegatedModel(input: {
  agentName: string;
  childChain: ModelChainEntry[] | undefined;
  followsParent: boolean;
  parentModel: string | undefined;
  parentChain: ModelChainEntry[] | undefined;
}): DelegatedModelSelection | undefined {
  const { agentName, childChain, parentChain, parentModel } = input;
  if (!parentModel) return undefined;
  const parentIndex =
    parentChain?.findIndex((entry) => entry.id === parentModel) ?? -1;
  const exact =
    childChain?.findIndex((entry) => entry.id === parentModel) ?? -1;

  if (input.followsParent) {
    return {
      agentName,
      entry: childChain?.[exact] ?? { id: parentModel },
      route: parentIndex > 0,
      inherited: true,
    };
  }

  if (!childChain?.length || !parentChain || parentIndex <= 0) return undefined;

  if (exact >= 0) {
    return { agentName, entry: childChain[exact], route: exact > 0 };
  }

  const activeProvider = modelProvider(parentModel);
  if (activeProvider) {
    const sameProvider = childChain.findIndex(
      (entry) => modelProvider(entry.id) === activeProvider,
    );
    if (sameProvider >= 0) {
      return {
        agentName,
        entry: childChain[sameProvider],
        route: sameProvider > 0,
      };
    }
  }

  const exhaustedProviders = new Set(
    parentChain
      .slice(0, parentIndex)
      .map((entry) => modelProvider(entry.id))
      .filter((provider): provider is string => provider !== undefined),
  );
  if (activeProvider) exhaustedProviders.delete(activeProvider);
  const viable = childChain.findIndex((entry) => {
    const provider = modelProvider(entry.id);
    return provider === undefined || !exhaustedProviders.has(provider);
  });
  return viable >= 0
    ? { agentName, entry: childChain[viable], route: viable > 0 }
    : undefined;
}

/**
 * Factory-lets thunks: the plugin factory constructs the runtime, the
 * foreground fallback manager, the background job board, the resolved agent
 * registry and the final host agent config AFTER this module's state, so
 * they are read lazily through these accessors. Before `bind()` (and before
 * the factory assigns them) the getters report undefined exactly like the
 * former `let` declarations did.
 */
export type SessionStateDeps = {
  getRuntime: () => RuntimeConfig;
  getForegroundFallback: () => ForegroundFallbackManager | undefined;
  getBoard: () => BackgroundJobBoard | undefined;
  getRegistry: () => ResolvedAgentRegistry | undefined;
  getFinalHostAgentConfig: () => Record<string, unknown> | undefined;
};

export function createSessionState(ctx: Parameters<Plugin>[0]) {
  // v1 task() has no model override. Prompts claim these bounded intentions
  // from host state, never from asynchronous session.created delivery.
  const MAX_PENDING_V1_DELEGATED_INTENTS = 32;
  const v1DelegatedIntents: {
    parentID: string;
    agentName: string;
    childID?: string;
  }[] = [];
  const v1InternalSelectionOverrides = new Map<
    string,
    {
      agent?: string;
      model?: { providerID: string; modelID: string };
      modelText?: string;
      variant?: string;
    }
  >();
  const sessionMetadata = new SessionMetadataStore({
    maxEntries: DEFAULT_MAX_SESSION_METADATA_ENTRIES,
    onEvict: (sessionID) => {
      v1InternalSelectionOverrides.delete(sessionID);
      log('[session] evicted oldest session metadata', {
        threshold: DEFAULT_MAX_SESSION_METADATA_ENTRIES,
        droppedSessionId: sessionID,
      });
    },
  });
  const compactingSessionIds = new Set<string>();
  // smartfetch's temporary secondary-model sessions run under the default
  // agent; they must never reach the sidebar, metadata or session hooks.
  const internalSessionIds = new Set<string>();
  const ownedTuiActivitySessions = new Map<string, string>();
  // #1079: lifecycle continuations (orchestrator wake, terminal
  // notifications) resolve the session's CURRENT agent/model at send
  // time instead of hardcoding `orchestrator`. Host-persisted selection
  // normally wins; when a v1 unpinned internal continuation has temporarily
  // overwritten it, preserve the exact policy-selected continuation until
  // the next real operator admission.
  const lifecycleSelectionReader = createSessionSelectionReader(
    ctx.client,
    ctx.directory,
  );
  const lifecycleSelectionResolver = async (sessionID: string) => {
    const resolved = await resolveCurrentSelection(
      sessionID,
      lifecycleSelectionReader,
      sessionMetadata,
    );
    const internalOverride = v1InternalSelectionOverrides.get(sessionID);
    if (!internalOverride) return resolved;

    // v1 computes an unpinned synthetic continuation from the static agent
    // primary and persists that choice before chat.message runs. While that
    // host selection is known to be internal, preserve the exact selection
    // chosen for that continuation. A later external admission clears the
    // override and makes the host authoritative again.
    const agent = internalOverride.agent ?? resolved.agent;
    const modelText = internalOverride.modelText;
    const model = internalOverride.model ?? resolved.model;
    return {
      ...(agent ? { agent } : {}),
      ...(model ? { model } : {}),
      ...(internalOverride.variant
        ? { variant: internalOverride.variant }
        : modelText && agent
          ? { variant: resolveTuiVariantForModel(agent, modelText) }
          : resolved.variant
            ? { variant: resolved.variant }
            : {}),
      provenance: 'observed-external' as const,
    };
  };
  // Busy/retry arrived before the session's agent was known. chat.message
  // latches the agent and flushes these so the spinner still starts. The
  // observed status is kept so the flushed activation records the right
  // sidebar detail (busy vs retry).
  const pendingTuiBusySessions = new Map<string, 'busy' | 'retry'>();
  const tuiActivityDirectory = (sessionID: string): string => {
    return sessionMetadata.getDirectory(sessionID) ?? ctx.directory;
  };
  // Sidebar activity scoping (#1147): every active session and the visible
  // route session resolve their conversation root against the persistent
  // sessionParents index at render time. The recorder only persists the
  // child→parent links; roots are never stored per-activity, so a
  // late-learned link re-roots everything consistently. Process identity
  // cannot scope this because v2 daemons are shared across windows.
  const markTuiAgentActive = (
    sessionID: string,
    agentName: string,
    status?: 'busy' | 'retry',
  ): void => {
    const directory = tuiActivityDirectory(sessionID);
    // Alias from an already-registered board record (launch may have
    // arrived before or after busy; both orders converge here or via the
    // coordinator's identity listener).
    const alias = requireDeps().getBoard()?.get(sessionID)?.alias;
    const details: TuiSessionDetails = {
      ...(alias ? { alias } : {}),
      ...(status ? { status } : {}),
    };
    recordTuiAgentActivity(
      {
        sessionID,
        agentName,
        active: true,
        ...(Object.keys(details).length > 0 ? { details } : {}),
      },
      directory,
    );
    ownedTuiActivitySessions.set(sessionID, directory);
    void hydrateTuiSessionParent(sessionID, directory);
  };
  // Sessions whose child→parent link is missing ask the host and walk up
  // to a confirmed root. Only confirmed roots and in-flight lookups stay
  // in this set; a valid response without parentID is a final answer
  // (top-level chat).
  const hydratedTuiParents = new Set<string>();
  const hydrateTuiSessionParent = async (
    startSessionID: string,
    directory: string,
  ): Promise<void> => {
    const sessionApi = (ctx as { client?: { session?: { get?: unknown } } })
      .client?.session;
    if (typeof sessionApi?.get !== 'function') return;
    const lookup = sessionApi.get as (input: {
      path: { id: string };
      query: { directory: string };
    }) => Promise<{ data?: unknown; error?: unknown; parentID?: unknown }>;
    const visited = new Set<string>();
    let current = startSessionID;
    while (!visited.has(current)) {
      visited.add(current);
      const snapshot = readTuiSnapshot(directory);
      const known = snapshot.sessionParents[current];
      if (known !== undefined) {
        current = known; // Persisted link; keep walking toward the root.
        continue;
      }
      if (hydratedTuiParents.has(current)) return;
      hydratedTuiParents.add(current);
      let parentID: unknown;
      try {
        // Call with the session object as receiver: the SDK's generated
        // method reads `this._client` (#595 class of regression).
        const response = await lookup.call(sessionApi, {
          path: { id: current },
          query: { directory },
        });
        if (response?.error !== undefined) {
          // HTTP error resolved instead of thrown: release the slot so a
          // later activity can retry.
          hydratedTuiParents.delete(current);
          return;
        }
        const info = response?.data;
        if (info === null || typeof info !== 'object') {
          // Malformed response outside the host contract: release the
          // slot rather than caching "confirmed root" on garbage.
          hydratedTuiParents.delete(current);
          return;
        }
        parentID = (info as { parentID?: unknown }).parentID;
      } catch {
        hydratedTuiParents.delete(current);
        return;
      }
      if (typeof parentID === 'string' && parentID !== current) {
        recordTuiSessionParent(current, parentID, directory);
        hydratedTuiParents.delete(current);
        current = parentID;
        continue;
      }
      if (parentID !== undefined && parentID !== null) {
        // Malformed non-string parent: release the slot so a later
        // activity can retry instead of caching a false confirmed root.
        hydratedTuiParents.delete(current);
      }
      // Valid response without a parent: confirmed root, stop.
      return;
    }
  };
  const markTuiAgentInactive = (sessionID: string): void => {
    pendingTuiBusySessions.delete(sessionID);
    const directory =
      ownedTuiActivitySessions.get(sessionID) ??
      tuiActivityDirectory(sessionID);
    recordTuiAgentActivity({ sessionID, active: false }, directory);
    ownedTuiActivitySessions.delete(sessionID);
  };
  const clearTuiActivities = (): void => {
    for (const [sessionID, directory] of ownedTuiActivitySessions) {
      recordTuiAgentActivity({ sessionID, active: false }, directory);
    }
    ownedTuiActivitySessions.clear();
  };
  clearTuiAgentActivities(ctx.directory);

  function resolveTuiVariantForModel(
    agentName: string,
    model: string,
  ): string | undefined {
    const configEntry = requireDeps().getRuntime().agents()[agentName];
    const defaultVariant =
      typeof configEntry?.variant === 'string'
        ? configEntry.variant
        : undefined;
    const chain = requireDeps().getRuntime().modelArrays[agentName];
    if (chain) {
      const match = chain.find((entry) => entry.id === model);
      return (
        match?.variant ?? (chain[0]?.id === model ? defaultVariant : undefined)
      );
    }

    if (
      typeof configEntry?.model === 'string' &&
      configEntry.model === model &&
      defaultVariant
    ) {
      return defaultVariant;
    }

    return undefined;
  }

  const resolvePrimaryModelFromFinalHostConfig = (
    agentType: string,
  ): string | undefined => {
    const readModel = (entry: unknown): string | undefined => {
      if (entry === null || typeof entry !== 'object') return undefined;
      return resolvePrimaryModelValue((entry as Record<string, unknown>).model);
    };

    // v2 finalizes the host snapshot directly through the registry bridge, so
    // it does not run the v1 config() projection assignment below. Prefer the
    // generation-local finalized projection in both runtimes; the config-hook
    // projection remains a fallback only before registry finalization.
    const finalAgentConfig =
      requireDeps().getRegistry()?.finalAgentConfig ??
      requireDeps().getFinalHostAgentConfig();
    const directModel = readModel(finalAgentConfig?.[agentType]);
    if (directModel) return directModel;

    const resolvedName = resolveRuntimeAgentName(
      requireDeps().getRuntime(),
      agentType,
    );
    return readModel(finalAgentConfig?.[resolvedName]);
  };

  const resolveDelegatedModelForParent = (
    agentType: string,
    parentSessionID?: string,
  ): DelegatedModelSelection | undefined => {
    const deps = requireDeps();
    const runtime = deps.getRuntime();
    if (!parentSessionID) return undefined;
    const agentName = resolveRuntimeAgentName(runtime, agentType);
    const parentAgentRaw = sessionMetadata.getAgent(parentSessionID);
    const parentAgent = parentAgentRaw
      ? resolveRuntimeAgentName(runtime, parentAgentRaw)
      : undefined;
    const inheritance = runtime.agent(agentName)?.inheritModelFrom;
    const followsParent =
      inheritance === 'orchestrator' || inheritance === 'session';
    return selectDelegatedModel({
      agentName,
      childChain: runtime.modelArrays[agentName],
      followsParent,
      // External-selection metadata deliberately ignores internal fallback
      // replays (#1079). Delegation needs the opposite view: the model
      // actually executing this parent turn, or children will be launched
      // back onto the provider the parent just escaped.
      parentModel:
        deps.getForegroundFallback()?.getActiveFallbackModel(parentSessionID) ??
        sessionMetadata.getModel(parentSessionID),
      parentChain: parentAgent ? runtime.modelArrays[parentAgent] : undefined,
    });
  };

  const registerV1DelegatedIntent = (
    parentID: string,
    childID: string | undefined,
    agentType: string,
  ) => {
    const selected = resolveDelegatedModelForParent(agentType, parentID);
    if (selected?.route && (childID || !selected.inherited)) {
      // A resume retry replaces its own unclaimed intention.
      const stale = v1DelegatedIntents.findIndex(
        (intent) => childID && intent.childID === childID,
      );
      if (stale >= 0) v1DelegatedIntents.splice(stale, 1);
      v1DelegatedIntents.push({
        parentID,
        agentName: selected.agentName,
        ...(childID ? { childID } : {}),
      });
      if (v1DelegatedIntents.length > MAX_PENDING_V1_DELEGATED_INTENTS)
        v1DelegatedIntents.shift();
    }
  };

  let deps: SessionStateDeps | undefined;
  const requireDeps = (): SessionStateDeps => {
    if (!deps) throw new Error('session-state bind() has not been called');
    return deps;
  };

  return {
    bind(next: SessionStateDeps) {
      deps = next;
    },
    sessionMetadata,
    v1InternalSelectionOverrides,
    v1DelegatedIntents,
    compactingSessionIds,
    internalSessionIds,
    ownedTuiActivitySessions,
    pendingTuiBusySessions,
    tuiActivityDirectory,
    markTuiAgentActive,
    markTuiAgentInactive,
    clearTuiActivities,
    lifecycleSelectionResolver,
    resolvePrimaryModelFromFinalHostConfig,
    resolveDelegatedModelForParent,
    registerV1DelegatedIntent,
    resolveTuiVariantForModel,
  };
}

export type SessionState = ReturnType<typeof createSessionState>;
