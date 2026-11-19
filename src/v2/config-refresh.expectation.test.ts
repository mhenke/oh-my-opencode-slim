/**
 * Focused coverage for the declarative preset orchestrator expectation
 * published by `v2.refreshProfiles` (issue #1919). Split out of
 * `config-refresh.test.ts` to keep that suite bounded; the boot helpers mirror
 * its real-factory seam.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Hooks } from '@opencode-ai/plugin';
import { OhMyOpenCodeLite } from '../index';
import { makeTestEnv, type TestEnv } from './test-fixtures';

let env: TestEnv;

beforeEach(() => {
  env = makeTestEnv('omos-v2cr-exp');
});

afterEach(() => {
  env.restore();
});

type ProfilesHook = (options?: {
  allowInvalidFallback?: boolean;
  presetName?: string;
  detached?: boolean;
}) => Promise<
  | {
      ok: true;
      profiles: Record<
        string,
        {
          model?: { providerID: string; id: string; variant?: string };
          temperature?: number;
          providerOptions?: Record<string, unknown>;
          sidebarModel: string;
        }
      >;
      projection: {
        agentModels: Record<string, string>;
        agentVariants: Record<string, string>;
      };
      bundle: {
        presetName: string | null;
        orchestratorExpectation?: {
          presetName: string;
          firstModel: string;
          agentIDs: string[];
        };
      };
    }
  | { ok: false; reason: string }
>;

function createPluginClient() {
  const noop = async () => ({});
  const session = new Proxy({}, { get: () => noop }) as Record<string, unknown>;
  return new Proxy(
    { app: { log: noop }, session },
    {
      get: (target, property) =>
        property in target
          ? target[property as keyof typeof target]
          : new Proxy({}, { get: () => noop }),
    },
  );
}

interface TestFactory {
  hooks: Hooks;
  refresh: ProfilesHook;
}

async function bootFactory(
  hostConfig: Record<string, unknown> = {},
  hostFlavor?: 'v2',
): Promise<TestFactory> {
  const hooks = await OhMyOpenCodeLite({
    client: createPluginClient(),
    directory: env.projectDir,
    worktree: env.projectDir,
    serverUrl: new URL('http://127.0.0.1:4096'),
    hostFlavor,
  } as never);
  // The host calls the config hook once at init; mirror that so the initial
  // registry/tui-state snapshot exists. `hostConfig.agent.<name>.model`
  // simulates a host-persisted /model pick (see index.test.ts).
  await hooks.config?.(hostConfig as never);
  const refresh = (hooks as unknown as { 'v2.refreshProfiles'?: ProfilesHook })[
    'v2.refreshProfiles'
  ];
  if (!refresh) throw new Error('v2.refreshProfiles hook missing');
  return { hooks, refresh };
}

/** Boots the factory, runs `body`, and always disposes the hooks. */
async function withFactory(
  body: (fac: TestFactory) => Promise<void>,
  hostConfig: Record<string, unknown> = {},
  hostFlavor?: 'v2',
): Promise<void> {
  const fac = await bootFactory(hostConfig, hostFlavor);
  try {
    await body(fac);
  } finally {
    await fac.hooks.dispose?.();
  }
}

describe('v2 orchestrator expectation', () => {
  test('publishes the resolved preset head before a host pin can mask it', async () => {
    env.writeUserConfig({
      preset: 'base',
      presets: {
        base: { orchestrator: { model: ['census/alpha', 'census/beta'] } },
        child: { extends: 'base' },
        scalar: { orchestrator: { model: 'census/scalar' } },
        missing: { oracle: { model: 'census/oracle' } },
      },
    });

    await withFactory(
      async ({ refresh }) => {
        const refreshed = await refresh();
        expect(refreshed.ok).toBe(true);
        if (!refreshed.ok) throw new Error(refreshed.reason);
        // The host pin is the final profile and clears the runtime chain; the
        // declarative head survives.
        expect(refreshed.profiles.orchestrator?.model?.id).toBe('beta');
        expect(refreshed.bundle.chains.orchestrator).toEqual([]);
        expect(refreshed.bundle.orchestratorExpectation).toEqual({
          presetName: 'base',
          firstModel: 'census/alpha',
          agentIDs: expect.arrayContaining(['orchestrator']),
        });

        const inherited = await refresh({
          presetName: 'child',
          detached: true,
        });
        expect(inherited.ok).toBe(true);
        if (!inherited.ok) throw new Error(inherited.reason);
        expect(inherited.bundle.orchestratorExpectation).toEqual({
          presetName: 'child',
          firstModel: 'census/alpha',
          agentIDs: expect.arrayContaining(['orchestrator']),
        });

        const scalar = await refresh({ presetName: 'scalar', detached: true });
        expect(scalar.ok).toBe(true);
        if (!scalar.ok) throw new Error(scalar.reason);
        expect(scalar.bundle.orchestratorExpectation).toMatchObject({
          presetName: 'scalar',
          firstModel: 'census/scalar',
        });

        const missing = await refresh({
          presetName: 'missing',
          detached: true,
        });
        expect(missing.ok).toBe(true);
        if (!missing.ok) throw new Error(missing.reason);
        expect(missing.bundle).not.toHaveProperty('orchestratorExpectation');
      },
      { agent: { orchestrator: { model: 'census/beta' } } },
      'v2',
    );
  });

  test('captures the configured display alias as an orchestrator identity', async () => {
    env.writeUserConfig({
      preset: 'base',
      agents: {
        orchestrator: { displayName: 'Lead', model: 'census/alpha' },
      },
      presets: { base: { orchestrator: { model: 'census/alpha' } } },
    });

    await withFactory(
      async ({ refresh }) => {
        const refreshed = await refresh();
        expect(refreshed.ok).toBe(true);
        if (!refreshed.ok) throw new Error(refreshed.reason);
        expect(refreshed.bundle.orchestratorExpectation).toMatchObject({
          presetName: 'base',
          firstModel: 'census/alpha',
          agentIDs: expect.arrayContaining(['orchestrator', 'Lead']),
        });
      },
      {},
      'v2',
    );
  });

  test('strips an inline variant suffix from the preset head', async () => {
    env.writeUserConfig({
      preset: 'base',
      presets: {
        base: { orchestrator: { model: 'census/alpha#high' } },
      },
    });

    await withFactory(
      async ({ refresh }) => {
        const refreshed = await refresh();
        expect(refreshed.ok).toBe(true);
        if (!refreshed.ok) throw new Error(refreshed.reason);
        // Model identity only: a variant-only difference must not reach the
        // comparison surface.
        expect(refreshed.bundle.orchestratorExpectation).toMatchObject({
          presetName: 'base',
          firstModel: 'census/alpha',
        });
      },
      {},
      'v2',
    );
  });

  test('omits the expectation without a named preset', async () => {
    env.writeUserConfig({
      presets: { base: { orchestrator: { model: 'census/alpha' } } },
    });

    await withFactory(
      async ({ refresh }) => {
        const refreshed = await refresh();
        expect(refreshed.ok).toBe(true);
        if (!refreshed.ok) throw new Error(refreshed.reason);
        expect(refreshed.bundle).not.toHaveProperty('orchestratorExpectation');
      },
      {},
      'v2',
    );
  });
});
