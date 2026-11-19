/**
 * v2 orchestrator startup model notice (issue #1919).
 *
 * A new visible root can be created with a session-selected provider/model
 * that differs from the preset's configured first orchestrator entry. The
 * selected model is authoritative and stays untouched; this module only
 * reports the difference once, from the TUI, because a toast is a TUI
 * capability (`ctx.ui.toast.show`) and the server has no UI channel on V2.
 *
 * Nothing here selects a model, writes config, binds a session, injects
 * prompt content, or retries. The host already owns every lifecycle edge:
 * we observe native `session.created`/`session.deleted` events for newness
 * and the router's solid store for visibility, and read the preserved
 * expectation through the existing session-preset RPC. Hydration, resume,
 * turns, model changes, fallback and preset apply never arm a notice.
 *
 * Limits: one notice per retained creation ID per TUI process, bounded
 * memory, no durable acknowledgement. An ID evicted from the bound may be
 * re-evaluated if the host replays its creation event.
 *
 * Ordering (Q2): if a creation is observed before the server bundle builds
 * the expectation (the read returns no field), the root is still marked
 * evaluated and skipped without retry. A later-appearing expectation for
 * that root is not re-read, so a later Apply or config change cannot
 * produce a surprise startup notice for it. New roots are unaffected.
 */

import { createEffect } from 'solid-js';
import { TOAST_DURATION_MS } from '../config/constants';
import { resolveRouteSessionId, type TuiRouteView } from '../tui';
import { isRecord } from '../utils/guards';
import { log } from '../utils/logger';
import {
  readSessionPreset,
  type V2PresetManagerContext,
} from './preset-manager';
import { orchestratorExpectationSchema } from './session-presets';

/** Bounded pending/recent identity state; see the eviction note below. */
const MAX_TRACKED = 64;

export interface StartupModelNoticeContext {
  location?: { directory?: string };
  data?: {
    on?: (type: string, handler: (event: unknown) => void) => unknown;
  };
  ui?: {
    router?: { current?: () => unknown };
    /** The host's `ui.slot`; `append: 'app'` renders a component. */
    slot?: (claim: { append: string; render: () => unknown }) => unknown;
    toast?: {
      show?: (toast: {
        message: string;
        variant?: 'warning';
        duration?: number;
      }) => void;
    };
  };
  client?: unknown;
}

interface Candidate {
  directory: string;
  model: string;
  agent: string;
}

const readString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

function parseCreated(
  event: unknown,
): { sessionID: string; candidate: Candidate } | undefined {
  const envelope = isRecord(event) ? event : {};
  const data = isRecord(envelope.data) ? envelope.data : {};
  const sessionID = readString(data.sessionID);
  if (sessionID === undefined) return undefined;
  // A present parentID proves a child; only a proven root can notify.
  if (readString(data.parentID) !== undefined) return undefined;
  const directory =
    readString(
      isRecord(envelope.location) ? envelope.location.directory : undefined,
    ) ??
    readString(isRecord(data.location) ? data.location.directory : undefined);
  const agent = readString(data.agent);
  const model = isRecord(data.model) ? data.model : undefined;
  const providerID = model ? readString(model.providerID) : undefined;
  const modelID = model ? readString(model.id) : undefined;
  if (
    directory === undefined ||
    agent === undefined ||
    providerID === undefined ||
    modelID === undefined
  ) {
    return undefined;
  }
  return {
    sessionID,
    candidate: { directory, agent, model: `${providerID}/${modelID}` },
  };
}

function parseDeleted(event: unknown): string | undefined {
  const envelope = isRecord(event) ? event : {};
  const data = isRecord(envelope.data) ? envelope.data : {};
  return readString(data.sessionID);
}

function rememberEvaluated(evaluated: Set<string>, sessionID: string): void {
  evaluated.add(sessionID);
  // Bounded so a long-lived TUI cannot grow without limit. An evicted ID
  // loses the "already evaluated" guarantee: a replayed creation event may
  // produce one more notice for it. Acceptable without durable acks.
  while (evaluated.size > MAX_TRACKED) {
    const oldest = evaluated.values().next().value;
    if (oldest === undefined) break;
    evaluated.delete(oldest);
  }
}

/**
 * Register the startup notice. Returns the combined disposer, or undefined
 * when the host cannot host the notice (no known directory, event bus,
 * router, slot, toast, or preset RPC). Never throws.
 */
export function registerStartupModelNotice(
  ctx: StartupModelNoticeContext,
): (() => void) | undefined {
  const directory = ctx.location?.directory;
  const on = ctx.data?.on;
  const current = ctx.ui?.router?.current;
  const slot = ctx.ui?.slot;
  const show = ctx.ui?.toast?.show;
  const rpc = isRecord(ctx.client) ? ctx.client.rpc : undefined;
  if (
    typeof directory !== 'string' ||
    typeof on !== 'function' ||
    typeof current !== 'function' ||
    typeof slot !== 'function' ||
    typeof show !== 'function' ||
    typeof rpc !== 'function'
  ) {
    log('[v2][tui] startup model notice unavailable; skipping');
    return undefined;
  }

  let disposed = false;
  const pending = new Map<string, Candidate>();
  const active = new Map<string, Candidate>();
  const evaluated = new Set<string>();

  const visibleSessionID = (): string | undefined => {
    try {
      const route = current() as TuiRouteView | undefined;
      return route ? resolveRouteSessionId(route) : undefined;
    } catch {
      return undefined;
    }
  };
  const tuiDirectory = (): string | undefined => ctx.location?.directory;

  const isCurrent = (
    sessionID: string,
    candidate: Candidate,
    state: unknown,
  ): boolean =>
    !disposed &&
    active.get(sessionID) === candidate &&
    visibleSessionID() === sessionID &&
    tuiDirectory() === candidate.directory &&
    isRecord(state) &&
    state.sessionID === sessionID;

  const evaluate = async (
    sessionID: string,
    candidate: Candidate,
  ): Promise<void> => {
    try {
      // Same bounded-request contract as the sidebar refresh: the shared
      // helper passes `AbortSignal.timeout(SESSION_PRESET_READ_TIMEOUT_MS)`
      // and rejects a mismatched session.
      const state = await readSessionPreset(
        ctx as V2PresetManagerContext,
        sessionID,
        candidate.directory,
      );
      if (!isCurrent(sessionID, candidate, state)) return;
      const parsed = orchestratorExpectationSchema.safeParse(
        (state as { orchestratorExpectation?: unknown })
          .orchestratorExpectation,
      );
      if (!parsed.success) return;
      const expected = parsed.data;
      if (!expected.agentIDs.includes(candidate.agent)) return;
      if (expected.firstModel === candidate.model) return;
      show({
        message: `Orchestrator started with ${candidate.model}. Preset "${expected.presetName}" starts with ${expected.firstModel}. Session selection takes precedence.`,
        variant: 'warning',
        duration: TOAST_DURATION_MS,
      });
    } catch (err) {
      log('[v2][tui] startup model notice read failed', String(err));
    } finally {
      if (active.get(sessionID) === candidate) active.delete(sessionID);
    }
  };

  const observe = (sessionID: string | undefined): void => {
    if (disposed || sessionID === undefined) return;
    const candidate = pending.get(sessionID);
    if (!candidate) return;
    pending.delete(sessionID);
    if (tuiDirectory() !== candidate.directory) return;
    active.set(sessionID, candidate);
    rememberEvaluated(evaluated, sessionID);
    void evaluate(sessionID, candidate);
  };

  const onCreated = (event: unknown): void => {
    if (disposed) return;
    const parsed = parseCreated(event);
    if (!parsed) return;
    const { sessionID, candidate } = parsed;
    if (candidate.directory !== tuiDirectory()) return;
    if (
      pending.has(sessionID) ||
      active.has(sessionID) ||
      evaluated.has(sessionID)
    ) {
      return;
    }
    if (pending.size >= MAX_TRACKED) {
      const oldest = pending.keys().next().value;
      if (oldest !== undefined) pending.delete(oldest);
    }
    pending.set(sessionID, candidate);
    // The creation event may arrive before navigation, so also evaluate the
    // root the router already shows.
    observe(visibleSessionID());
  };

  const onDeleted = (event: unknown): void => {
    const sessionID = parseDeleted(event);
    if (sessionID === undefined) return;
    pending.delete(sessionID);
    // Cancels an in-flight evaluation at its post-read revalidation.
    active.delete(sessionID);
  };

  const unsubscribers: Array<() => void> = [];
  const bind = (type: string, handler: (event: unknown) => void): void => {
    try {
      const off = on.call(ctx.data, type, handler);
      if (typeof off === 'function') unsubscribers.push(off as () => void);
    } catch {
      // Best-effort subscription; a host without the event is skipped.
    }
  };

  let disposeSlot: (() => void) | undefined;
  let effectWired = false;
  try {
    const off = slot({
      append: 'app',
      render: () => {
        // The host may re-invoke render; wire the effect only once.
        if (!effectWired) {
          effectWired = true;
          createEffect(() => {
            observe(visibleSessionID());
          });
        }
        return null;
      },
    });
    if (typeof off === 'function') disposeSlot = off as () => void;
  } catch (err) {
    log('[v2][tui] startup model notice slot registration failed', String(err));
    return undefined;
  }

  bind('session.created', onCreated);
  bind('session.deleted', onDeleted);

  return () => {
    if (disposed) return;
    disposed = true;
    pending.clear();
    active.clear();
    evaluated.clear();
    for (const off of unsubscribers.splice(0)) {
      try {
        off();
      } catch {
        // Best-effort teardown.
      }
    }
    try {
      disposeSlot?.();
    } catch {
      // Best-effort teardown.
    }
  };
}
