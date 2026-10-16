import type { Plugin } from '@opencode-ai/plugin';
import {
  buildResolvedAgentRegistry,
  type RegistryHostSnapshot,
  type ResolvedAgentRegistry,
} from '../agents/registry';
import { loadPluginConfig } from '../config';
import { RuntimeConfig } from '../config/runtime';
import { getBuildInfo } from '../generated/build-info';
import { discoverPreflightSkills } from '../marketplace/preflight';
import { MarketplaceService } from '../marketplace/service';
import { resolveDesiredMarketplacePackageIds } from '../marketplace/status';
import { createBuiltinMcps } from '../mcp';
import type { V2PermissionRule } from '../v2/types';

/**
 * Registration unit for the marketplace service. Extracted from
 * src/index.ts: every root `let` the closures read arrives as a getter so
 * the late-binding liveness (values assigned by registry finalize, config
 * hooks, and the v2 bridge after this construction) is preserved exactly.
 */
export function registerMarketplace(deps: {
  ctx: Parameters<Plugin>[0];
  getHostFlavor: () => string | undefined;
  getRuntime: () => RuntimeConfig;
  getRegistryRetired: () => boolean;
  getResolvedAgentRegistry: () => ResolvedAgentRegistry | undefined;
  requireRegistry: () => ResolvedAgentRegistry;
  getHostSnapshotProvenance: () => 'unknown' | 'clean';
  getLatestHostSnapshot: () => RegistryHostSnapshot | undefined;
  getLatestNativePermissionsByAgent: () => Readonly<
    Record<string, readonly V2PermissionRule[]>
  >;
}) {
  const marketplaceService = new MarketplaceService({
    projectDir: deps.ctx.directory,
    hostFlavor: deps.getHostFlavor(),
    pluginVersion: getBuildInfo().version,
    getLivePackages: () => {
      if (deps.getRegistryRetired() || !deps.getResolvedAgentRegistry())
        return undefined;
      return deps.requireRegistry().marketplacePackages;
    },
    getPresetOverride: () => deps.getRuntime().getRuntimePreset() ?? undefined,
    getDesiredState: (packageInspection) => {
      const freshConfig = loadPluginConfig(deps.ctx.directory, {
        silent: true,
        hostFlavor: deps.getHostFlavor(),
      });
      const runtimePreset = deps.getRuntime().resolveRuntimePreset(freshConfig);
      const desiredPackageIds = resolveDesiredMarketplacePackageIds(
        freshConfig,
        runtimePreset ?? undefined,
      );
      const latestHostSnapshot = deps.getLatestHostSnapshot();
      if (deps.getHostSnapshotProvenance() !== 'clean' || !latestHostSnapshot) {
        return {
          packageIds: desiredPackageIds,
          error:
            'The current host agent snapshot is not trustworthy for desired marketplace status',
        };
      }
      if (
        packageInspection.lockfileError ||
        packageInspection.operationalError
      ) {
        return {
          packageIds: desiredPackageIds,
          error:
            packageInspection.lockfileError ??
            packageInspection.operationalError ??
            'Marketplace package inspection is incomplete',
        };
      }
      const installedPackages = new Map(
        packageInspection.packages.map((stored) => [
          stored.manifest.id,
          stored,
        ]),
      );
      const readOnlyActivationStore = {
        loadSelected(ids: readonly string[]) {
          const packages = new Map();
          const errors = new Map<string, Error>();
          for (const id of ids) {
            const stored = installedPackages.get(id);
            if (stored) packages.set(id, stored);
            else
              errors.set(id, new Error(`${id} is not installed or verified`));
          }
          return { packages, errors };
        },
      };
      const freshRuntime = RuntimeConfig.createDetached(
        deps.ctx.directory,
        freshConfig,
        deps.getHostFlavor(),
      );
      freshRuntime.captureHostConfig(latestHostSnapshot ?? {});
      if (runtimePreset) freshRuntime.setRuntimePreset(runtimePreset);
      const freshPluginMcps = createBuiltinMcps(freshRuntime.disabledMcps);
      try {
        const freshRegistry = buildResolvedAgentRegistry(freshRuntime, {
          hostSnapshot: latestHostSnapshot,
          nativePermissionsByAgent: deps.getLatestNativePermissionsByAgent(),
          projectDirectory: deps.ctx.directory,
          hostFlavor: deps.getHostFlavor(),
          pluginMcps: freshPluginMcps,
          marketplace: {
            selectedPackageIds: desiredPackageIds,
            store: readOnlyActivationStore,
            pluginVersion: getBuildInfo().version,
            availableSkillNames: discoverPreflightSkills(
              freshRuntime,
              deps.ctx.directory,
            ),
          },
        });
        return {
          packageIds: desiredPackageIds,
          packages: freshRegistry.marketplacePackages,
        };
      } catch (error) {
        return {
          packageIds: desiredPackageIds,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  });
  return { marketplaceService };
}
