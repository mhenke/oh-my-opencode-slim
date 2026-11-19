import { describe, expect, test } from 'bun:test';
import { testRender } from '@opentui/solid';
import { createSignal } from 'solid-js';
import { TOAST_DURATION_MS } from '../config/constants';
import {
  registerStartupModelNotice,
  type StartupModelNoticeContext,
} from './startup-model-notice';

const DIR = '/proj';
const FIRST = 'provider-a/model-a';
const SELECTED = 'provider-b/model-b';
const COPY = (selected: string, preset: string, first: string): string =>
  `Orchestrator started with ${selected}. Preset "${preset}" starts with ${first}. Session selection takes precedence.`;

async function flush(): Promise<void> {
  for (let i = 0; i < 30; i += 1) await Promise.resolve();
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve: (value: T) => void = () => {};
  let reject: (error: unknown) => void = () => {};
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type Caps = Partial<
  Record<'data' | 'router' | 'slot' | 'toast' | 'rpc', boolean>
>;

function presetState(overrides: Record<string, unknown> = {}): unknown {
  return {
    sessionID: 'root-1',
    status: 'bound',
    presetName: 'P',
    affects: 'future-children-only',
    orchestratorExpectation: {
      presetName: 'P',
      firstModel: FIRST,
      agentIDs: ['orchestrator'],
    },
    ...overrides,
  };
}

function makeHarness(
  caps: Caps = {},
  readImpl: (sessionID: string) => Promise<unknown> = async () => presetState(),
) {
  const types: string[] = [];
  const unsubscribed: string[] = [];
  const created: Array<(event: unknown) => void> = [];
  const deleted: Array<(event: unknown) => void> = [];
  const slotClaims: Array<{ append?: string; render?: () => unknown }> = [];
  const toasts: Array<{
    message: string;
    variant?: string;
    duration?: number;
  }> = [];
  const reads: Array<{ sessionID: string; options: unknown }> = [];
  const applies: unknown[] = [];
  const [route, setRoute] = createSignal<unknown>({ type: 'home' });
  let slotDisposed = 0;
  let read = readImpl;

  const ctx = {
    location: { directory: DIR },
    ...(caps.data === false
      ? {}
      : {
          data: {
            on: (type: string, handler: (event: unknown) => void) => {
              types.push(type);
              if (type === 'session.created') created.push(handler);
              if (type === 'session.deleted') deleted.push(handler);
              return () => {
                unsubscribed.push(type);
                if (type === 'session.created') created.splice(0);
                if (type === 'session.deleted') deleted.splice(0);
              };
            },
          },
        }),
    ui: {
      ...(caps.router === false ? {} : { router: { current: route } }),
      ...(caps.slot === false
        ? {}
        : {
            slot: (claim: { append?: string; render?: () => unknown }) => {
              slotClaims.push(claim);
              return () => {
                slotDisposed += 1;
              };
            },
          }),
      ...(caps.toast === false
        ? {}
        : {
            toast: {
              show: (toast: (typeof toasts)[number]) => toasts.push(toast),
            },
          }),
    },
    ...(caps.rpc === false
      ? {}
      : {
          client: {
            rpc: () => ({
              read: (input: { sessionID: string }, options: unknown) => {
                reads.push({ sessionID: input.sessionID, options });
                return read(input.sessionID);
              },
              apply: (...args: unknown[]) => {
                applies.push(args);
                return Promise.resolve(undefined);
              },
            }),
          },
        }),
  } as StartupModelNoticeContext;

  const emitCreated = (
    overrides: {
      sessionID?: string;
      providerID?: string | null;
      modelID?: string | null;
      variant?: string;
      agent?: string | null;
      directory?: string | null;
      parentID?: string;
    } = {},
  ): void => {
    const {
      sessionID = 'root-1',
      providerID = 'provider-b',
      modelID = 'model-b',
      variant,
      agent = 'orchestrator',
      directory = DIR,
      parentID,
    } = overrides;
    const location = directory === null ? undefined : { directory };
    const model =
      providerID === null || modelID === null
        ? undefined
        : {
            providerID,
            id: modelID,
            ...(variant === undefined ? {} : { variant }),
          };
    const data = {
      sessionID,
      ...(agent === null ? {} : { agent }),
      ...(model === undefined ? {} : { model }),
      ...(parentID === undefined ? {} : { parentID }),
      ...(location === undefined ? {} : { location }),
    };
    for (const handler of [...created]) {
      handler({
        type: 'session.created',
        ...(location === undefined ? {} : { location }),
        data,
      });
    }
  };

  const emitDeleted = (sessionID = 'root-1'): void => {
    for (const handler of [...deleted]) {
      handler({ type: 'session.deleted', data: { sessionID } });
    }
  };

  const mount = async () => {
    const claim = slotClaims[0];
    if (!claim?.render) throw new Error('notice slot missing');
    const screen = await testRender(() => claim.render?.() as never, {
      width: 80,
      height: 24,
    });
    await screen.renderOnce();
    await flush();
    return screen;
  };

  return {
    ctx,
    types,
    unsubscribed,
    slotClaims,
    toasts,
    reads,
    applies,
    setRoute,
    setRead: (next: (sessionID: string) => Promise<unknown>) => {
      read = next;
    },
    emitCreated,
    emitDeleted,
    mount,
    slotDisposed: () => slotDisposed,
  };
}

describe('startup model notice', () => {
  test('warns once when the created root selects a different provider/model', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    expect(dispose).toBeTypeOf('function');
    expect(h.types).toEqual(['session.created', 'session.deleted']);

    // Creation arrives before navigation.
    h.emitCreated();
    const screen = await h.mount();
    expect(h.toasts).toEqual([]);

    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();

    expect(h.reads).toHaveLength(1);
    expect(h.reads[0]?.sessionID).toBe('root-1');
    const options = h.reads[0]?.options as {
      location?: unknown;
      signal?: unknown;
    };
    expect(options.location).toEqual({ directory: DIR });
    // Same bounded-request contract as readSessionPreset: an unavailable
    // server must not stall the notice.
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(h.toasts).toEqual([
      {
        message: COPY(SELECTED, 'P', FIRST),
        variant: 'warning',
        duration: TOAST_DURATION_MS,
      },
    ]);
    // Selection is never written.
    expect(h.applies).toEqual([]);

    // A later replay does not re-arm.
    h.emitCreated();
    h.setRoute({ type: 'home' });
    await screen.renderOnce();
    await flush();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toHaveLength(1);
    expect(h.toasts).toHaveLength(1);

    dispose?.();
    screen.renderer.destroy();
  });

  test('the matched model and variant-only differences do not warn', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    h.setRead(async () => presetState());
    h.emitCreated({
      providerID: 'provider-a',
      modelID: 'model-a',
      variant: 'high',
    });
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toHaveLength(1);
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('reads a visible candidate once even with duplicate creation events', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const pending = deferred<unknown>();
    h.setRead(() => pending.promise);
    h.emitCreated();
    h.emitCreated();
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    // In-flight duplicate creation is ignored.
    h.emitCreated();
    await flush();
    expect(h.reads).toHaveLength(1);
    pending.resolve(presetState());
    await flush();
    expect(h.toasts).toHaveLength(1);
    dispose?.();
    screen.renderer.destroy();
  });

  test('children, other primary agents and missing identities are skipped', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const screen = await h.mount();
    h.emitCreated({ sessionID: 'child', parentID: 'root-1' });
    h.emitCreated({ sessionID: 'no-model', providerID: null });
    h.emitCreated({ sessionID: 'no-agent', agent: null });
    h.emitCreated({ sessionID: 'other-agent', agent: 'build' });
    h.setRoute({ type: 'session', sessionID: 'child' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toEqual([]);
    // A visible other-primary root is read but does not warn.
    h.setRoute({ type: 'session', sessionID: 'other-agent' });
    await screen.renderOnce();
    await flush();
    expect(h.reads.map((read) => read.sessionID)).toEqual(['other-agent']);
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('unknown and foreign event directories are skipped', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const screen = await h.mount();
    h.emitCreated({ sessionID: 'foreign', directory: '/elsewhere' });
    h.emitCreated({ sessionID: 'unknown', directory: null });
    h.setRoute({ type: 'session', sessionID: 'foreign' });
    await screen.renderOnce();
    await flush();
    h.setRoute({ type: 'session', sessionID: 'unknown' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toEqual([]);
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('a route change during the async read cancels the notice', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const pending = deferred<unknown>();
    h.setRead(() => pending.promise);
    h.emitCreated();
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    h.setRoute({ type: 'session', sessionID: 'root-2' });
    await screen.renderOnce();
    await flush();
    pending.resolve(presetState());
    await flush();
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('a location change during the async read cancels the notice', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const pending = deferred<unknown>();
    h.setRead(() => pending.promise);
    h.emitCreated();
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    h.ctx.location = { directory: '/other' };
    pending.resolve(presetState());
    await flush();
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('deletion drops a pending root and cancels an in-flight read', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const pending = deferred<unknown>();
    h.setRead(() => pending.promise);
    h.emitCreated({ sessionID: 'deleted-before' });
    h.emitDeleted('deleted-before');
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'deleted-before' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toEqual([]);

    h.emitCreated({ sessionID: 'deleted-during' });
    h.setRoute({ type: 'session', sessionID: 'deleted-during' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toHaveLength(1);
    h.emitDeleted('deleted-during');
    pending.resolve(presetState({ sessionID: 'deleted-during' }));
    await flush();
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('dispose clears pending state and no later notice is delivered', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const pending = deferred<unknown>();
    h.setRead(() => pending.promise);
    h.emitCreated();
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    dispose?.();
    expect(h.unsubscribed.sort()).toEqual([
      'session.created',
      'session.deleted',
    ]);
    expect(h.slotDisposed()).toBe(1);
    pending.resolve(presetState());
    await flush();
    expect(h.toasts).toEqual([]);
    screen.renderer.destroy();
  });

  test('unknown expectation, mismatched state and read errors skip without retry', async () => {
    for (const [name, read] of [
      [
        'missing expectation',
        async () => presetState({ orchestratorExpectation: undefined }),
      ],
      ['mismatched session', async () => presetState({ sessionID: 'other' })],
      [
        'read error',
        async () => {
          throw new Error('rpc failed');
        },
      ],
    ] as const) {
      const h = makeHarness();
      const dispose = registerStartupModelNotice(h.ctx);
      h.setRead(read);
      h.emitCreated();
      const screen = await h.mount();
      h.setRoute({ type: 'session', sessionID: 'root-1' });
      await screen.renderOnce();
      await flush();
      expect({ name, toasts: h.toasts }).toEqual({ name, toasts: [] });
      // Evaluated even on failure: a replay does not retry.
      h.emitCreated();
      h.setRoute({ type: 'home' });
      await screen.renderOnce();
      h.setRoute({ type: 'session', sessionID: 'root-1' });
      await screen.renderOnce();
      await flush();
      expect({ name, reads: h.reads }).toEqual({ name, reads: [h.reads[0]] });
      expect(h.reads).toHaveLength(1);
      dispose?.();
      screen.renderer.destroy();
    }
  });

  test('a creation observed before the expectation exists is skipped and never re-read', async () => {
    // Q2 ordering bound: creation arriving before the server bundle builds
    // the expectation must not silently defer, wrong-notify later, or
    // deadlock — it is evaluated once, skipped, and a later-appearing
    // expectation for the same root is not re-read.
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    // Expectation missing at creation time (bundle not yet built).
    h.setRead(async () => presetState({ orchestratorExpectation: undefined }));
    h.emitCreated();
    const screen = await h.mount();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toHaveLength(1);
    expect(h.toasts).toEqual([]);

    // The expectation appears later for the same root, but no re-read occurs:
    // route re-observation and replayed creation events stay silent.
    h.setRead(async () => presetState({ orchestratorExpectation: undefined }));
    h.emitCreated();
    h.setRoute({ type: 'home' });
    await screen.renderOnce();
    h.setRoute({ type: 'session', sessionID: 'root-1' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toHaveLength(1);
    expect(h.toasts).toEqual([]);
    dispose?.();
    screen.renderer.destroy();
  });

  test('caps pending creation state', async () => {
    const h = makeHarness();
    const dispose = registerStartupModelNotice(h.ctx);
    const screen = await h.mount();
    for (let i = 0; i < 70; i += 1) {
      h.emitCreated({ sessionID: `root-${i}` });
    }
    h.setRoute({ type: 'session', sessionID: 'root-0' });
    await screen.renderOnce();
    await flush();
    expect(h.reads).toEqual([]);
    h.setRoute({ type: 'session', sessionID: 'root-69' });
    await screen.renderOnce();
    await flush();
    expect(h.reads.map((read) => read.sessionID)).toEqual(['root-69']);
    dispose?.();
    screen.renderer.destroy();
  });

  test('missing capabilities skip registration', () => {
    for (const capability of [
      'data',
      'router',
      'slot',
      'toast',
      'rpc',
    ] as const) {
      const h = makeHarness({ [capability]: false });
      expect({
        capability,
        dispose: registerStartupModelNotice(h.ctx),
      }).toEqual({ capability, dispose: undefined });
    }
    const noDirectory = makeHarness();
    noDirectory.ctx.location = undefined;
    expect(registerStartupModelNotice(noDirectory.ctx)).toBeUndefined();
  });
});
