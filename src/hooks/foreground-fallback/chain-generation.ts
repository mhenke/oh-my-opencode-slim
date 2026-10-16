import type { AgentDefinition } from '../../agents/orchestrator';
import type { RuntimeConfig } from '../../config/runtime';
import { parseModelReference } from '../../utils/session';

export type ModelChainEntry = { id: string; variant?: string };

export type DelegatedModelSelection = {
  agentName: string;
  entry: ModelChainEntry;
  /** Inherited children already start on the parent's live model. */
  inherited?: true;
};

/** Exactly what `ForegroundFallbackManager.getActiveFallback` returns. */
export interface ActiveFallbackSnapshot {
  model: string;
  downProviders: ReadonlySet<string>;
}

/**
 * Build one complete fallback-chain generation — the chain table a fresh boot
 * with `rt`'s config would publish. Precedence mirrors the registry's
 * `modelCandidates` construction (registry.ts): configured chains
 * (`rt.modelArrays`) win, then declared `_modelArray` chains (definition-set
 * names: orchestrator overrides, config arrays invisible to the getter such
 * as disabled agents), then the registry's candidates for names outside the
 * definition set (marketplace agents, aliases, display names). Publishers
 * swap the published table's contents with this result in one synchronous
 * step (see publishChainGeneration).
 */
export function buildChainGeneration(
  rt: RuntimeConfig,
  defs: readonly AgentDefinition[],
  candidates:
    | Readonly<Record<string, readonly { id: string; variant?: string }[]>>
    | undefined,
): Record<string, ModelChainEntry[]> {
  const copyEntries = (
    entries: readonly { id: string; variant?: string }[],
  ): ModelChainEntry[] =>
    entries.map(({ id, variant }) => ({
      id,
      ...(variant ? { variant } : {}),
    }));
  const table: Record<string, ModelChainEntry[]> = {};
  for (const [name, models] of Object.entries(rt.modelArrays)) {
    if (models.length > 0) table[name] = copyEntries(models);
  }
  for (const def of defs) {
    if (table[def.name] || (def._modelArray?.length ?? 0) <= 1) continue;
    table[def.name] = copyEntries(def._modelArray ?? []);
  }
  if (candidates) {
    const known = new Set(defs.map((def) => def.name));
    for (const [name, entries] of Object.entries(candidates)) {
      if (table[name] || known.has(name) || entries.length <= 1) continue;
      table[name] = copyEntries(entries);
    }
  }
  return table;
}

/**
 * Independent children leave only providers confirmed down by the parent.
 * Explicit inheritance follows the parent's live model for either error scope.
 */
export function selectDelegatedModel(input: {
  agentName: string;
  childChain: ModelChainEntry[] | undefined;
  followsParent: boolean;
  parentModel: string | undefined;
  activeFallback: ActiveFallbackSnapshot | undefined;
}): DelegatedModelSelection | undefined {
  const { agentName, childChain, parentModel, activeFallback } = input;
  if (!parentModel) return undefined;

  if (input.followsParent) {
    return {
      agentName,
      entry: childChain?.find((entry) => entry.id === parentModel) ?? {
        id: parentModel,
      },
      inherited: true,
    };
  }

  if (!childChain?.length || !activeFallback) return undefined;
  const { downProviders } = activeFallback;
  const primaryProvider = parseModelReference(childChain[0].id)?.providerID;
  if (!primaryProvider || !downProviders.has(primaryProvider)) return undefined;
  const entry = childChain.find((entry) => {
    const provider = parseModelReference(entry.id)?.providerID;
    return provider !== undefined && !downProviders.has(provider);
  });
  return entry ? { agentName, entry } : undefined;
}
