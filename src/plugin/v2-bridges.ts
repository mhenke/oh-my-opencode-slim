import type { Plugin } from '@opencode-ai/plugin';
import {
  createAgents,
  getAgentConfigsFromDefinitions,
  mergeHostAgentConfigs,
  projectAgentRuntimeState,
} from '../agents';
import { buildOrchestratorPrompt } from '../agents/orchestrator';
import {
  buildResolvedAgentRegistry,
  type RegistryHostSnapshot,
  type ResolvedAgentRegistry,
} from '../agents/registry';
import type { RegistryFactoryBridge } from '../agents/registry-bridge';
import { loadPluginConfig, type Preset } from '../config';
import type { ConfigLoadWarningKind } from '../config/loader';
import { RuntimeConfig } from '../config/runtime';
import { getBuildInfo } from '../generated/build-info';
import { isCommandEnabled } from '../hooks/command-hook-utils';
import type { ForegroundFallbackManager } from '../hooks/foreground-fallback';
import { buildChainGeneration } from '../hooks/foreground-fallback/chain-generation';
import { discoverPreflightSkills } from '../marketplace/preflight';
import type { MarketplaceService } from '../marketplace/service';
import { recordTuiAgentModels } from '../tui-state';
import { log } from '../utils/logger';
import type { V2PermissionRule } from '../v2/types';

type V2PermissionRuleMap = Readonly<
  Record<string, readonly V2PermissionRule[]>
>;

/**
 * Result of the v2-only `v2.refreshProfiles` hook. `ok: true` carries the
 * freshly resolved inference profiles plus the sidebar projection that was
 * already written; `ok: false` carries the failure reason and guarantees no
 * state was swapped.
 */
export type V2ProfileRefreshResult =
  | {
      ok: true;
      profiles: import('../agents').AgentRuntimeProfiles;
      projection: import('../agents').AgentModelProjection;
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
 * warning-only kinds (`missing-preset`, `normalized`) stay non-fatal.
 */
export const HARD_PROFILE_REFRESH_WARNING_KINDS: ReadonlySet<ConfigLoadWarningKind> =
  new Set(['invalid-json', 'invalid-schema', 'read-error']);

/**
 * Registration unit for the v2 bridges: the registry factory bridge
 * (finalize / requireRegistry / prepareCommands / retire) and the
 * `v2.refreshProfiles` implementation. Every root `let` these closures read
 * or write arrives as a getter/setter so the late-binding liveness of the
 * original factory flow is preserved exactly.
 */
export function createV2Bridges(deps: {
  ctx: Parameters<Plugin>[0];
  getRuntime: () => RuntimeConfig;
  getRegistryRetired: () => boolean;
  setRegistryRetired: (retired: boolean) => void;
  getResolvedAgentRegistry: () => ResolvedAgentRegistry | undefined;
  setResolvedAgentRegistry: (registry: ResolvedAgentRegistry) => void;
  getLatestHostSnapshot: () => RegistryHostSnapshot | undefined;
  setLatestHostSnapshot: (snapshot: RegistryHostSnapshot) => void;
  getLatestNativePermissionsByAgent: () => V2PermissionRuleMap;
  setLatestNativePermissionsByAgent: (permissions: V2PermissionRuleMap) => void;
  setHostSnapshotProvenance: (provenance: 'unknown' | 'clean') => void;
  getAgentDefs: () => ReturnType<typeof createAgents>;
  getMcps: () => ReturnType<typeof import('../mcp')['createBuiltinMcps']>;
  getForegroundFallback: () => ForegroundFallbackManager;
  marketplaceService: MarketplaceService;
  selectedMarketplacePackageIds: readonly string[];
  interviewManager: ReturnType<
    typeof import('../interview')['createInterviewManager']
  >;
  deepworkCommandHook: { registerCommand(opencodeConfig: unknown): void };
  reflectCommandHook: { registerCommand(opencodeConfig: unknown): void };
  loopCommandHook: { registerCommand(opencodeConfig: unknown): void };
  getHostFlavor: () => string | undefined;
}) {
  const registryBridge: RegistryFactoryBridge = {
    marketplaceService: deps.marketplaceService,
    finalize(hostSnapshot, nativePermissionsByAgent) {
      if (deps.getRegistryRetired())
        throw new Error('Agent registry is retired');
      if (!deps.getLatestHostSnapshot()) {
        deps.setLatestHostSnapshot(structuredClone(hostSnapshot));
        deps.setLatestNativePermissionsByAgent(
          structuredClone(nativePermissionsByAgent),
        );
        deps.setHostSnapshotProvenance('clean');
      }
      let resolved = deps.getResolvedAgentRegistry();
      if (!resolved) {
        RuntimeConfig.get(deps.ctx.directory).captureHostConfig(hostSnapshot);
        resolved = buildResolvedAgentRegistry(deps.getRuntime(), {
          hostSnapshot,
          definitions: deps.getAgentDefs(),
          projectDirectory: deps.ctx.directory,
          hostFlavor: deps.getHostFlavor(),
          pluginMcps: deps.getMcps(),
          nativePermissionsByAgent,
          marketplace: {
            selectedPackageIds: deps.selectedMarketplacePackageIds,
            store: deps.marketplaceService.store,
            pluginVersion: getBuildInfo().version,
            availableSkillNames: deps.selectedMarketplacePackageIds.length
              ? discoverPreflightSkills(deps.getRuntime(), deps.ctx.directory)
              : [],
          },
          onHostModelSelected: (agentName) => {
            deps.getRuntime().everModelSwitched(agentName);
          },
        });
        deps.setResolvedAgentRegistry(resolved);
        // Publish the finalized chain generation: marketplace candidates and
        // model-switch disables are merged by the shared publisher — the same
        // path every profile refresh republishes.
        deps.getForegroundFallback().publishChainGeneration(
          buildChainGeneration(
            deps.getRuntime(),
            deps.getAgentDefs(),
            resolved.modelCandidates,
          ),
          (name) => deps.getRuntime().combinedModelInheritanceSource(name),
          (name) => deps.getRuntime().hasModelSwitched(name),
        );
      }
      return resolved;
    },
    requireRegistry() {
      if (deps.getRegistryRetired())
        throw new Error('Agent registry is retired');
      const registry = deps.getResolvedAgentRegistry();
      if (!registry) throw new Error('Agent registry has not been finalized');
      return registry;
    },
    prepareCommands(opencodeConfig) {
      const commandGate = {
        disabledCommands: deps.getRuntime().disabledCommands,
        disabledSkills: deps.getRuntime().disabledSkills,
      };
      if (
        isCommandEnabled('interview', commandGate) ||
        isCommandEnabled('implement', commandGate)
      ) {
        deps.interviewManager.registerCommand(opencodeConfig, {
          interview: isCommandEnabled('interview', commandGate),
          implement: isCommandEnabled('implement', commandGate),
        });
      }
      if (isCommandEnabled('deepwork', commandGate)) {
        deps.deepworkCommandHook.registerCommand(opencodeConfig);
      }
      if (isCommandEnabled('reflect', commandGate)) {
        deps.reflectCommandHook.registerCommand(opencodeConfig);
      }
      if (isCommandEnabled('loop', commandGate)) {
        deps.loopCommandHook.registerCommand(opencodeConfig);
      }
    },
    retire() {
      deps.setRegistryRetired(true);
    },
  };

  const refreshProfilesFromDisk = async (options?: {
    /** Startup has no last-good table yet; use the loader's normal fallback
     * config so malformed user input remains non-fatal for this generation. */
    allowInvalidFallback?: boolean;
  }): Promise<V2ProfileRefreshResult> => {
    try {
      // Malformed config handling: collect warnings and abort BEFORE any
      // resolution or sidebar rewrite when the load is invalid. The loader
      // falls back to `{}` for invalid JSON/schema, which would otherwise
      // report a successful "refresh" that wipes every profile/model.
      const hardWarnings: string[] = [];
      const freshConfig = loadPluginConfig(deps.ctx.directory, {
        hostFlavor: deps.getHostFlavor(),
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
      const runtime = deps.getRuntime();
      const freshRuntime = RuntimeConfig.create(
        deps.ctx.directory,
        freshConfig,
      );
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
        projectDirectory: deps.ctx.directory,
        hostFlavor: deps.getHostFlavor(),
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
      const registry = deps.getResolvedAgentRegistry();
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
        deps.ctx.directory,
      );
      log('[plugin] runtime profiles refreshed from disk', {
        agents: Object.keys(profiles).length,
      });
      // Chain generation: republished beside the sidebar projection, only
      // after validation succeeded — profiles and chains always come from the
      // same generation (the caller swaps the profile table on this ok
      // result; an invalid refresh keeps the last-known-good generation).
      // Manifest chains overlay the startup candidates: a user override
      // removed since startup must fall back to the package's own chain,
      // not the stale merged candidates.
      const freshCandidates = registry
        ? {
            ...registry.modelCandidates,
            ...registry.marketplaceManifestChains,
          }
        : undefined;
      deps.getForegroundFallback().publishChainGeneration(
        buildChainGeneration(runtime, freshAgentDefs, freshCandidates),
        (name) => freshRuntime.combinedModelInheritanceSource(name),
        (name) => runtime.hasModelSwitched(name),
      );
      return { ok: true, profiles, projection };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      log('[plugin] runtime profile refresh from disk failed', reason);
      return { ok: false, reason };
    }
  };

  return { registryBridge, refreshProfilesFromDisk };
}
