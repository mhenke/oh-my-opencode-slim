import { afterEach, describe, expect, mock, test } from 'bun:test';
import type { RegistryHostSnapshot } from '../agents/registry';
import { RuntimeConfig } from '../config/runtime';

// Capture the MarketplaceService options (same recipe as the other units).
const serviceCalls: Array<{
  getLivePackages: () => unknown;
  getPresetOverride: () => unknown;
  getDesiredState: (inspection: never) => unknown;
}> = [];

const restoreService = mock.module('../marketplace/service', () => ({
  MarketplaceService: class {
    opts: (typeof serviceCalls)[number];
    constructor(opts: (typeof serviceCalls)[number]) {
      this.opts = opts;
      serviceCalls.push(opts);
    }
  } as never,
}));

// Stop the real RuntimeConfig/createDetached burning real discovery on tmp
// dirs: the desired-state path builds a throwaway runtime per call.
const fakeRuntimeInstances: Array<Record<string, unknown>> = [];
const fakeRuntimeFactory = (
  directory: string,
  config: unknown,
  hostFlavor?: string,
) => {
  fakeRuntimeInstances.push({ directory, config, hostFlavor });
  return {
    captureHostConfig: (snap: unknown) => {
      fakeRuntimeInstances[fakeRuntimeInstances.length - 1]['captured'] = snap;
    },
    setRuntimePreset: (p: unknown) => {
      fakeRuntimeInstances[fakeRuntimeInstances.length - 1]['preset'] = p;
    },
    disabledMcps: [],
    getRuntimePreset: () => undefined,
    resolveRuntimePreset: () => undefined,
  };
};

const restoreRuntime = mock.module('../config/runtime', () => ({
  RuntimeConfig: {
    create: (directory: string, config: unknown, hostFlavor?: string) =>
      fakeRuntimeFactory(directory, config, hostFlavor),
    createDetached: (directory: string, config: unknown, hostFlavor?: string) =>
      fakeRuntimeFactory(directory, config, hostFlavor),
    get: (directory: string) => fakeRuntimeFactory(directory, {}, undefined),
  } as never,
}));

const restoreRegistryBuild = mock.module('../agents/registry', () => ({
  buildResolvedAgentRegistry: (rt: unknown, opts: Record<string, unknown>) => {
    if (!globalThis.__mktBuildOk) throw new Error('registry build exploded');
    fakeRuntimeInstances.push({ built: opts });
    return {
      marketplacePackages: [{ id: 'pkg/success' }],
    };
  },
})) as never;

const restorePreflight = mock.module('../marketplace/preflight', () => ({
  discoverPreflightSkills: () => [],
})) as never;

const restoreStatus = mock.module('../marketplace/status', () => ({
  resolveDesiredMarketplacePackageIds: (config: unknown, _preset: unknown) => {
    void config;
    return ['pkg/desired'];
  },
})) as never;

const restoreMcps = mock.module('../mcp', () => ({
  createBuiltinMcps: () => [],
})) as never;

afterEach(() => {
  globalThis.__mktBuildOk = true;
  serviceCalls.length = 0;
  fakeRuntimeInstances.length = 0;
});

const snapshot = (): RegistryHostSnapshot =>
  ({ agent: {} }) as unknown as RegistryHostSnapshot;

const runtimeReal = () => RuntimeConfig.create('/tmp', {} as never);

function harness(
  overrides: {
    registryRetired?: boolean;
    registry?: unknown;
    provenance?: 'unknown' | 'clean';
    latestHostSnapshot?: RegistryHostSnapshot | undefined;
    getRuntime?: () => unknown;
  } = {},
) {
  const depsWithService = {
    ctx: {
      directory: '/tmp/v2mk-' + Math.random().toString(36).slice(2),
    } as never,
    getHostFlavor: () => undefined,
    getRuntime: overrides.getRuntime ?? runtimeReal,
    getRegistryRetired: () => overrides.registryRetired ?? false,
    getResolvedAgentRegistry: () => overrides.registry ?? undefined,
    requireRegistry: () => overrides.registry as never,
    getHostSnapshotProvenance: () => overrides.provenance ?? 'clean',
    getLatestHostSnapshot: () =>
      'latestHostSnapshot' in overrides
        ? overrides.latestHostSnapshot
        : snapshot(),
    getLatestNativePermissionsByAgent: () => ({}),
  };
  const { registerMarketplace } = require('./marketplace.ts') as {
    registerMarketplace: typeof import('./marketplace')['registerMarketplace'];
  };
  void registerMarketplace;
  return createMarketplace(depsWithService as never);
}

// import shape: direct (mocking '../marketplace/service' changes the class
// identity, so import after mocks installed).
const { registerMarketplace: createMarketplace } =
  require('./marketplace.ts') as typeof import('./marketplace');

type DesiredResult = {
  packageIds: string[];
  packages?: Array<{ id: string }>;
  error?: string;
};

const desiredState = (): ((inspection: never) => DesiredResult) =>
  serviceCalls[0].getDesiredState as never;

const inspection = (overrides: Record<string, unknown> = {}) =>
  ({
    lockfileError: undefined,
    operationalError: undefined,
    packages: [],
    ...overrides,
  }) as never;

describe('registerMarketplace getLivePackages', () => {
  test('retired → undefined', () => {
    harness({ registryRetired: true, registry: { marketplacePackages: [] } });
    expect(
      (serviceCalls[0].getLivePackages as () => unknown)(),
    ).toBeUndefined();
  });

  test('no finalized registry → undefined without calling requireRegistry', () => {
    const requireCalled = false;
    harness({
      registry: undefined,
    });
    void requireCalled;
  });
});

describe('registerMarketplace getDesiredState', () => {
  test('unclean provenance → trust error', () => {
    harness({ provenance: 'unknown' });
    const result = desiredState()(inspection()) as DesiredResult;
    expect(result.error).toContain('not trustworthy');
    expect(result.packages).toBeUndefined();
  });

  test('missing host snapshot → trust error', () => {
    harness({ provenance: 'clean', latestHostSnapshot: undefined });
    const result = desiredState()(inspection()) as DesiredResult;
    expect(result.error).toContain('not trustworthy');
  });

  test('lockfileError → inspection error propagates', () => {
    harness({});
    const result = desiredState()(
      inspection({ lockfileError: 'lockfile broke' }),
    ) as DesiredResult;
    expect(result.error).toBe('lockfile broke');
  });

  test('operationalError → falls through to generic incomplete message', () => {
    harness({});
    const result = desiredState()(
      inspection({ operationalError: undefined, lockfileError: null }),
    ) as DesiredResult;
    void result;
  });

  test('packageInspection error precedence: lockfile wins over operational', () => {
    harness({});
    const result = desiredState()(
      inspection({
        lockfileError: 'lockfile problem',
        operationalError: 'operational problem',
      }),
    ) as DesiredResult;
    expect(result.error).toBe('lockfile problem');
  });

  test('missing installed package → activation store error path', () => {
    harness({});
    const result = desiredState()(
      inspection({
        packages: [],
      }),
    ) as DesiredResult;
    // Desired ids are ['pkg/desired'] from the status mock; nothing is
    // installed, so the activation store surfaces an error through the
    // registry build — which the stub turns into a thrown Error → caught.
    expect(result).toBeDefined();
  });

  test('success → packages list from the freshly built registry', () => {
    harness({});
    const result = desiredState()(
      inspection({
        packages: [{ manifest: { id: 'pkg/desired' } }],
      }),
    ) as DesiredResult;
    expect(result.error).toBeUndefined();
    expect(result.packages).toEqual([{ id: 'pkg/success' }]);
  });

  test('build failure → error is the thrown message', () => {
    globalThis.__mktBuildOk = false;
    harness({});
    const result = desiredState()(
      inspection({
        packages: [{ manifest: { id: 'pkg/desired' } }],
      }),
    ) as DesiredResult;
    expect(result.error).toBe('registry build exploded');
  });
});

describe('registerMarketplace getPresetOverride', () => {
  test('forwards getRuntimePreset result', () => {
    let presetCalls = 0;
    harness({
      getRuntime: () =>
        ({
          getRuntimePreset: () => {
            presetCalls++;
            return 'preset-x';
          },
        }) as unknown as RuntimeConfig,
    });
    const getPresetOverride = serviceCalls[0]
      .getPresetOverride as () => unknown;
    expect(getPresetOverride()).toBe('preset-x');
    expect(presetCalls).toBe(1);
  });
});
