import { describe, expect, test } from 'bun:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import type { Plugin } from '@opencode-ai/plugin';
import type {
  RegistryHostSnapshot,
  ResolvedAgentRegistry,
} from '../agents/registry';
import { RuntimeConfig } from '../config/runtime';
import {
  createV2Bridges,
  HARD_PROFILE_REFRESH_WARNING_KINDS,
} from './v2-bridges';

// The unit reads only narrow surfaces of its collaborators; stubs with the
// used members keep these direct unit tests decoupled from the factory.
const snapshot = (): RegistryHostSnapshot =>
  ({ agent: {} }) as unknown as RegistryHostSnapshot;

const registryStub = (overrides: Record<string, unknown> = {}) =>
  ({
    modelCandidates: { orch: [{ id: 'a/one' }] },
    marketplaceManifestChains: {},
    tuiAgentModels: {},
    tuiAgentVariants: {},
    marketplacePackages: [],
    ...overrides,
  }) as unknown as ResolvedAgentRegistry;

const runtimeStub = (overrides: Record<string, unknown> = {}) =>
  ({
    disabledCommands: new Set<string>(),
    disabledSkills: [] as readonly string[],
    getRuntimePreset: () => undefined,
    hasModelSwitched: () => false,
    everModelSwitched: () => {},
    host: () => undefined,
    combinedModelInheritanceSource: () => undefined,
    resolveRuntimePreset: () => undefined,
    disabledMcps: [],
    ...overrides,
  }) as unknown as RuntimeConfig;

const ctxStub = (root: string) =>
  ({ directory: root, client: {} }) as unknown as Parameters<Plugin>[0];

const RUNTIME_DIR = mkdtempSync('/tmp/v2b-runtime-');

function makeUnit(
  overrides: {
    runtime?: RuntimeConfig;
    registry?: ResolvedAgentRegistry | undefined;
    registryRetired?: boolean;
    latestHostSnapshot?: RegistryHostSnapshot | undefined;
    publishCalls?: unknown[];
    getBuildInfoVersion?: string;
    commandSpies?: Record<string, () => void>;
  } = {},
) {
  const publishCalls: unknown[] = [];
  const state = {
    registryRetired: overrides.registryRetired ?? false,
    registry: overrides.registry ?? undefined,
    latestHostSnapshot:
      'latestHostSnapshot' in overrides
        ? overrides.latestHostSnapshot
        : snapshot(),
    provenance: 'unknown' as 'unknown' | 'clean',
    permissions: {},
  };
  const agentDefs: never[] = [];
  const mcps = {};
  const unit = createV2Bridges({
    ctx: ctxStub(RUNTIME_DIR),
    getRuntime: () =>
      (overrides.runtime ??
        RuntimeConfig.create(RUNTIME_DIR, {} as never)) as RuntimeConfig,
    getRegistryRetired: () => state.registryRetired,
    setRegistryRetired: (retired) => {
      state.registryRetired = retired;
    },
    getResolvedAgentRegistry: () => state.registry,
    setResolvedAgentRegistry: (registry) => {
      state.registry = registry;
    },
    getLatestHostSnapshot: () => state.latestHostSnapshot,
    setLatestHostSnapshot: (snap) => {
      state.latestHostSnapshot = snap;
    },
    getLatestNativePermissionsByAgent: () => state.permissions,
    setLatestNativePermissionsByAgent: (permissions) => {
      state.permissions = permissions as never;
    },
    setHostSnapshotProvenance: (provenance) => {
      state.provenance = provenance;
    },
    getAgentDefs: () => agentDefs,
    getMcps: () => mcps,
    getForegroundFallback: () => {
      return {
        publishChainGeneration: (next, ...rest) => {
          publishCalls.push({ next, rest });
        },
      } as never;
    },
    marketplaceService: { store: {} } as never,
    selectedMarketplacePackageIds: [],
    interviewManager: {
      registerCommand: () => overrides.commandSpies?.interview?.(),
    } as never,
    deepworkCommandHook: {
      registerCommand: () => overrides.commandSpies?.deepwork?.(),
    },
    reflectCommandHook: {
      registerCommand: () => overrides.commandSpies?.reflect?.(),
    },
    loopCommandHook: {
      registerCommand: () => overrides.commandSpies?.loop?.(),
    },
    getHostFlavor: () => undefined,
  });
  return { unit, publishCalls, state };
}

describe('createV2Bridges finalize', () => {
  test('retired → throws', () => {
    const { unit } = makeUnit({ registryRetired: true });
    expect(() => unit.registryBridge.finalize(snapshot(), {})).toThrow(
      'Agent registry is retired',
    );
  });

  test('first finalize captures snapshot + provenance and builds the registry', () => {
    const { unit, state } = makeUnit({ latestHostSnapshot: undefined });
    const registry = unit.registryBridge.finalize(snapshot(), { a: [] });
    expect(registry).toBeDefined();
    expect(state.latestHostSnapshot).toBeDefined();
    expect(state.provenance).toBe('clean');
  });

  test('second finalize keeps the captured snapshot and returns the built registry', () => {
    const { unit, state } = makeUnit();
    const first = unit.registryBridge.finalize(snapshot(), { a: [] });
    const before = state.latestHostSnapshot;
    const second = unit.registryBridge.finalize(snapshot(), { a: [] });
    expect(state.latestHostSnapshot).toBe(before);
    expect(second).toBe(first);
  });
});

describe('createV2Bridges requireRegistry', () => {
  test('unfinalized → throws', () => {
    const { unit } = makeUnit({ registry: undefined });
    expect(() => unit.registryBridge.requireRegistry()).toThrow(
      'Agent registry has not been finalized',
    );
  });

  test('finalized → returns the registry', () => {
    const reg = registryStub();
    const { unit } = makeUnit({ registry: reg });
    expect(unit.registryBridge.requireRegistry()).toBe(reg);
  });

  test('retired → throws even when finalized', () => {
    const { unit } = makeUnit({ registryRetired: true });
    expect(() => unit.registryBridge.requireRegistry()).toThrow();
  });
});

describe('createV2Bridges retire', () => {
  test('sets the retired flag', () => {
    const { unit } = makeUnit();
    unit.registryBridge.retire();
    expect(() => unit.registryBridge.requireRegistry()).toThrow(
      'Agent registry is retired',
    );
  });
});

describe('createV2Bridges prepareCommands', () => {
  test('registers all commands when nothing is disabled', () => {
    const hooks: string[] = [];
    const { unit } = makeUnit({
      commandSpies: {
        interview: () => hooks.push('interview'),
        deepwork: () => hooks.push('deepwork'),
        reflect: () => hooks.push('reflect'),
        loop: () => hooks.push('loop'),
      },
    });
    unit.registryBridge.prepareCommands({} as never);
    expect(hooks).toContain('interview');
    expect(hooks).toContain('deepwork');
    expect(hooks).toContain('reflect');
    expect(hooks).toContain('loop');
  });

  test('honors disabled commands', () => {
    const hooks: string[] = [];
    const { unit } = makeUnit({
      runtime: runtimeStub({
        disabledCommands: new Set(['deepwork', 'loop']),
      }),
      commandSpies: {
        interview: () => hooks.push('interview'),
        deepwork: () => hooks.push('deepwork'),
        reflect: () => hooks.push('reflect'),
        loop: () => hooks.push('loop'),
      },
    });
    unit.registryBridge.prepareCommands({} as never);
    expect(hooks).not.toContain('deepwork');
    expect(hooks).not.toContain('loop');
    expect(hooks).toContain('interview');
    expect(hooks).toContain('reflect');
  });
});

describe('createV2Bridges refreshProfilesFromDisk', () => {
  test('hard config warning aborts the refresh', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2b-'));
    fs.mkdirSync(path.join(dir, '.opencode'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.opencode', 'oh-my-opencode-slim.json'),
      '{ invalid',
    );
    const { unit: unused } = makeUnit();
    void unused;
    // Rebuild against the temp directory so loadPluginConfig reads the
    // malformed file there.
    const malformedUnit = createV2Bridges({
      ctx: ctxStub(dir),
      getRuntime: () => runtimeStub(),
      getRegistryRetired: () => false,
      setRegistryRetired: () => {},
      getResolvedAgentRegistry: () => undefined,
      setResolvedAgentRegistry: () => {},
      getLatestHostSnapshot: () => undefined,
      setLatestHostSnapshot: () => {},
      getLatestNativePermissionsByAgent: () => ({}),
      setLatestNativePermissionsByAgent: () => {},
      setHostSnapshotProvenance: () => {},
      getAgentDefs: () => [],
      getMcps: () => ({}),
      getForegroundFallback: () =>
        ({ publishChainGeneration: () => {} }) as never,
      marketplaceService: { store: {} } as never,
      selectedMarketplacePackageIds: [],
      interviewManager: { registerCommand: () => {} } as never,
      deepworkCommandHook: { registerCommand: () => {} },
      reflectCommandHook: { registerCommand: () => {} },
      loopCommandHook: { registerCommand: () => {} },
      getHostFlavor: () => undefined,
    });
    const result = await malformedUnit.refreshProfilesFromDisk();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('config load failed');
      expect(result.reason).toContain('invalid-json');
    }
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('successful refresh publishes a generation and returns profiles', async () => {
    const fs = require('node:fs');
    const os = require('node:os');
    const path = require('node:path');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2b-'));
    fs.mkdirSync(path.join(dir, '.opencode'), { recursive: true });
    fs.writeFileSync(
      path.join(dir, '.opencode', 'oh-my-opencode-slim.json'),
      '{}',
    );
    const publishCalls: unknown[] = [];
    const reg = registryStub();
    const wired = createV2Bridges({
      ctx: ctxStub(dir),
      getRuntime: () => runtimeStub(),
      getRegistryRetired: () => false,
      setRegistryRetired: () => {},
      getResolvedAgentRegistry: () => reg,
      setResolvedAgentRegistry: () => {},
      getLatestHostSnapshot: () => snapshot(),
      setLatestHostSnapshot: () => {},
      getLatestNativePermissionsByAgent: () => ({}),
      setLatestNativePermissionsByAgent: () => {},
      setHostSnapshotProvenance: () => {},
      getAgentDefs: () => [],
      getMcps: () => ({}),
      getForegroundFallback: () =>
        ({
          publishChainGeneration: (...args: unknown[]) =>
            publishCalls.push(args),
        }) as never,
      marketplaceService: { store: {} } as never,
      selectedMarketplacePackageIds: [],
      interviewManager: { registerCommand: () => {} } as never,
      deepworkCommandHook: { registerCommand: () => {} },
      reflectCommandHook: { registerCommand: () => {} },
      loopCommandHook: { registerCommand: () => {} },
      getHostFlavor: () => undefined,
    });
    const result = await wired.refreshProfilesFromDisk();
    expect(result.ok).toBe(true);
    expect(publishCalls.length).toBe(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('HARD_PROFILE_REFRESH_WARNING_KINDS covers the hard kinds', () => {
    expect(HARD_PROFILE_REFRESH_WARNING_KINDS.has('invalid-json')).toBeTrue();
    expect(HARD_PROFILE_REFRESH_WARNING_KINDS.has('read-error')).toBeTrue();
    expect(
      HARD_PROFILE_REFRESH_WARNING_KINDS.has('missing-preset'),
    ).toBeFalse();
  });
});
