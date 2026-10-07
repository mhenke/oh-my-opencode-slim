import type { Plugin } from '@opencode-ai/plugin';
import type {
  AgentModelProjection,
  AgentRuntimeProfiles,
} from '../agents';
import {
  createAgents,
  getAgentConfigsFromDefinitions,
  mergeHostAgentConfigs,
  projectAgentRuntimeState,
} from '../agents';
import type { ResolvedAgentRegistry } from '../agents/registry';
import { deepMerge, loadPluginConfig, type Preset } from '../config';
import type { ConfigLoadWarningKind } from '../config/loader';
import { RuntimeConfig } from '../config/runtime';
import { resolveDesiredMarketplacePackageIds } from '../marketplace/status';
import { delegationWording } from '../v2/delegation';
import { createDisplayNameMentionRewriter, log } from '../utils';
import { recordTuiAgentModels } from '../tui-state';

/**
 * Result of the v2-only `v2.refreshProfiles` hook. `ok: true` carries the
 * freshly resolved inference profiles plus the sidebar projection that was
 * already written; `ok: false` carries the failure reason and guarantees no
 * state was swapped.
 */
export type V2ProfileRefreshResult =
  | {
      ok: true;
      profiles: AgentRuntimeProfiles;
      projection: AgentModelProjection;
    }
  | { ok: false; reason: string };

/**
 * Config-load warning kinds that make a live profile refresh a hard failure.
 *
 * `loadPluginConfig` is deliberately non-fatal: malformed JSON or a schema
 * violation falls back to `{}` and reports through `onWarning`. A refresh
 * that ignored those warnings would report ok and swap the profile table +
 * sidebar projection to defaults (silently wiping every agent model). These
 * kinds therefore abort the refresh before any state is swapped; actionable
 * warning-only kinds (`missing-preset`, `deprecated-key`, `normalized`)
 * stay non-fatal.
 */
export const HARD_PROFILE_REFRESH_WARNING_KINDS: ReadonlySet<ConfigLoadWarningKind> =
  new Set(['invalid-json', 'invalid-schema', 'read-error']);

/** Result of the startup profile boot (config load + agent creation). */
export type BootProfileResult = ReturnType<typeof bootProfile>;/**
 * Load the plugin config, seed RuntimeConfig, reapply any persisted runtime
 * preset and build the generation's agent definitions.
 *
 * The `config` mutations below are load-bearing for legacy consumers: the
 * runtime preset (if any) wins over the config-file preset, and its agent
 * overrides are re-merged into `config.agents`. RuntimeConfig keeps the
 * pre-mutation snapshot and derives preset/runtime state through its own
 * getters.
 */
export function bootProfile(ctx: Parameters<Plugin>[0], hostFlavor: string | undefined) {
  const config = loadPluginConfig(ctx.directory, { hostFlavor });
  // Seed the per-directory runtime registry with the raw plugin file
  // config. The runtime preset reapplication below mutates `config` for
  // legacy consumers; RuntimeConfig keeps the pre-mutation snapshot and
  // derives preset/runtime state through its own getters.
  RuntimeConfig.init(ctx.directory, config, hostFlavor);

  // Safety net: instance disposal reruns the plugin factory and rebuilds
  // factory-local state, while module-level runtime preset state may persist.
  // Reapply that persisted preset so each fresh generation creates agents
  // with the correct models.
  const runtimeConfig = RuntimeConfig.get(ctx.directory);
  const previousRuntimePreset = runtimeConfig.getRuntimePreset();
  const runtimePreset = runtimeConfig.resolveRuntimePreset(config);
  if (runtimePreset) {
    config.preset = runtimePreset;
    // Re-merge runtime preset into config.agents (loadPluginConfig
    // already merged the config-file preset, not the runtime one).
    // Runtime preset is override so it wins over config-file preset.
    const presetAgents = config.presets?.[runtimePreset];
    if (!presetAgents) {
      throw new Error(
        `Resolved runtime preset '${runtimePreset}' is missing`,
      );
    }
    config.agents = deepMerge(config.agents, presetAgents);
  } else if (previousRuntimePreset) {
    // Preset was deleted from config since last switch - clear stale state
    runtimeConfig.setRuntimePreset(null);
  }

  const runtime = RuntimeConfig.get(ctx.directory);
  const activePresetName = runtime.getRuntimePreset() ?? config.preset;
  const selectedMarketplacePackageIds = resolveDesiredMarketplacePackageIds(
    config,
    activePresetName,
  );
  const rewriteDisplayNameMentions =
    createDisplayNameMentionRewriter(runtime);
  // Host flavor marker ('v2' on OpenCode v2 hosts, set by the v2 client
  // shim; absent on v1). Threads the native delegation vocabulary into
  // prompt assembly so v2 prompts say subagent(...)/agent directly.
  const delegation = delegationWording(hostFlavor);
  const agentDefs = createAgents(runtime, {
    projectDirectory: ctx.directory,
    hostFlavor,
  });
  const agents = getAgentConfigsFromDefinitions(runtime, agentDefs);

  return {
    config,
    runtime,
    agentDefs,
    agents,
    selectedMarketplacePackageIds,
    rewriteDisplayNameMentions,
    delegation,
  };
}

/**
 * Re-read the plugin config from disk and resolve ONLY the
 * inference/runtime profile fields (model, variant, temperature, provider
 * options) for each agent, plus the sidebar model projection. The v2
 * adapter consumes this through the `v2.refreshProfiles` hook when a
 * watched config file changes or a preset is applied.
 *
 * This is deliberately NOT a global agent reload: the session-frozen
 * surfaces (agent definitions, prompts, tools, permissions, skills, MCPs)
 * are never rebuilt and the host agent registry is never reloaded. It is
 * read-only on factory-local state — a throwaway `RuntimeConfig.create`
 * view resolves the fresh file against the captured host layer, so running
 * generation state (`config`, `runtime`, `agentDefs`, `agents`,
 * `finalHostAgentConfig`) is untouched. New child sessions receive the
 * refreshed inference fields through the v2 session-profile bridge; the
 * sidebar is rewritten through the existing `recordTuiAgentModels` writer.
 *
 * Returns a discriminated result; a failure never claims success and never
 * swaps state (the caller decides what to do with the reason). A config
 * load that produced `invalid-json`/`invalid-schema`/`read-error` warnings
 * is a hard failure: the loader would otherwise fall back to `{}` and the
 * "refresh" would report ok while wiping every profile/agent model.
 */
export async function refreshProfilesFromDisk(
  ctx: Parameters<Plugin>[0],
  deps: {
    runtime: RuntimeConfig;
    getRegistry: () => ResolvedAgentRegistry | undefined;
    hostFlavor: string | undefined;
  },
  options?: {
    /** Startup has no last-good table yet; use the loader's normal fallback
     * config so malformed user input remains non-fatal for this generation. */
    allowInvalidFallback?: boolean;
  },
): Promise<V2ProfileRefreshResult> {
  const { runtime, getRegistry, hostFlavor } = deps;
  try {
    // Malformed config handling: collect warnings and abort BEFORE any
    // resolution or sidebar rewrite when the load is invalid. The loader
    // falls back to `{}` for invalid JSON/schema, which would otherwise
    // report a successful "refresh" that wipes every profile/model.
    const hardWarnings: string[] = [];
    const freshConfig = loadPluginConfig(ctx.directory, {
      hostFlavor,
      silent: true,
      onWarning: (warning) => {
        if (HARD_PROFILE_REFRESH_WARNING_KINDS.has(warning.kind)) {
          hardWarnings.push(
            `${warning.kind} (${warning.path}): ${warning.message}`,
          );
        }
      },
    });
    if (hardWarnings.length > 0 && !options?.allowInvalidFallback) {
      const reason = `config load failed: ${hardWarnings.join('; ')}`;
      log('[plugin] runtime profile refresh from disk failed', reason);
      return { ok: false, reason };
    }
    const freshRuntime = RuntimeConfig.create(ctx.directory, freshConfig);
    const hostSnapshot = runtime.host();
    if (hostSnapshot) {
      freshRuntime.captureHostConfig(hostSnapshot);
    }
    // Mirror factory init: a persisted runtime preset (in-session switch)
    // survives the reload and wins over the config-file preset.
    const runtimePresetName = runtime.getRuntimePreset();
    let runtimePreset: Preset | undefined;
    if (runtimePresetName && freshConfig.presets?.[runtimePresetName]) {
      freshRuntime.setRuntimePreset(runtimePresetName);
      runtimePreset = freshConfig.presets[runtimePresetName] as Preset;
    }
    const freshAgentDefs = createAgents(freshRuntime, {
      projectDirectory: ctx.directory,
      hostFlavor,
    });
    const freshAgents = getAgentConfigsFromDefinitions(
      freshRuntime,
      freshAgentDefs,
    );
    const mergedAgents = mergeHostAgentConfigs(
      freshAgents as Record<string, Record<string, unknown>>,
      hostSnapshot?.agent,
    );
    const { profiles, projection } = projectAgentRuntimeState({
      runtime: freshRuntime,
      agentDefs: freshAgentDefs,
      agentConfigs: mergedAgents,
      runtimePreset,
    });
    // Sidebar projection must land before the profiles are reported as
    // refreshed (the caller swaps only on an ok result).
    //
    // The refresh resolves inference fields for the core agent set only:
    // `createAgents()` is marketplace-unaware, while the finalized registry
    // is the authoritative roster and already includes marketplace agents.
    // Union the fresh projection over the registry projection so a startup
    // or watcher refresh cannot shrink the roster and drop marketplace
    // agents from the sidebar; fresh core models still win.
    const registry = getRegistry();
    recordTuiAgentModels(
      {
        agentModels: {
          ...(registry?.tuiAgentModels ?? {}),
          ...projection.agentModels,
        },
        agentVariants: {
          ...(registry?.tuiAgentVariants ?? {}),
          ...projection.agentVariants,
        },
      },
      ctx.directory,
    );
    log('[plugin] runtime profiles refreshed from disk', {
      agents: Object.keys(profiles).length,
    });
    return { ok: true, profiles, projection };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    log('[plugin] runtime profile refresh from disk failed', reason);
    return { ok: false, reason };
  }
}
