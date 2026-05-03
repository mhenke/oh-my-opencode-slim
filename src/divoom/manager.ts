import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { DivoomConfig } from '../config';
import { log } from '../utils/logger';

type TaskArgs = {
  subagent_type?: unknown;
};

export type DivoomSenderCall = {
  command: string;
  args: string[];
};

export type DivoomSender = (call: DivoomSenderCall) => void;

type ParentState = {
  activeCalls: Map<string, string>;
  displayedAgent?: string;
};

const AGENT_GIFS: Record<string, string> = {
  council: 'council.gif',
  councillor: 'council.gif',
  designer: 'designer.gif',
  explorer: 'explorer.gif',
  fixer: 'fixer.gif',
  intro: 'intro.gif',
  librarian: 'librarian.gif',
  oracle: 'oracle.gif',
  orchestrator: 'orchestrator.gif',
};

const DEFAULT_DIVOOM_CONFIG: DivoomConfig = {
  enabled: false,
  python:
    '/Applications/Divoom MiniToo.app/Contents/Resources/.venv/bin/python',
  script:
    '/Applications/Divoom MiniToo.app/Contents/Resources/tools/divoom_send.py',
  size: 128,
  fps: 8,
  speed: 125,
  maxFrames: 24,
  posterizeBits: 3,
};

type DivoomManagerOptions = {
  assetDir?: string | null;
  sender?: DivoomSender;
};

function resolveAssetDir(): string | null {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    moduleDir,
    path.resolve(moduleDir, 'divoom'),
    path.resolve(moduleDir, '../../src/divoom'),
    path.resolve(process.cwd(), 'src/divoom'),
  ];

  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, 'intro.gif'))) {
      return candidate;
    }
  }

  return null;
}

function normalizeAgentName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

export class DivoomManager {
  private assetDir: string | null;
  private config: DivoomConfig;
  private parentStates = new Map<string, ParentState>();
  private lastGifPath?: string;

  constructor(
    config?: Partial<DivoomConfig>,
    private sender: DivoomSender = defaultSender,
    options: DivoomManagerOptions = {},
  ) {
    this.config = {
      ...DEFAULT_DIVOOM_CONFIG,
      ...config,
      gifs: config?.gifs,
    };
    this.assetDir = options.assetDir ?? resolveAssetDir();
    if (options.sender) {
      this.sender = options.sender;
    }
  }

  onPluginLoad(): void {
    this.show('intro');
  }

  onTaskStart(input: {
    parentSessionId?: string;
    callId?: string;
    args?: unknown;
  }): void {
    if (!input.parentSessionId || !input.callId) return;
    if (!isTaskArgs(input.args)) return;

    const agent = normalizeAgentName(input.args.subagent_type);
    if (!agent) return;

    const state = this.getParentState(input.parentSessionId);
    const wasIdle = state.activeCalls.size === 0;
    state.activeCalls.set(input.callId, agent);

    if (!wasIdle || state.displayedAgent) return;

    state.displayedAgent = agent;
    this.show(agent);
  }

  onTaskEnd(input: { parentSessionId?: string; callId?: string }): void {
    if (!input.parentSessionId || !input.callId) return;

    const state = this.parentStates.get(input.parentSessionId);
    if (!state) return;

    state.activeCalls.delete(input.callId);
    if (state.activeCalls.size > 0) return;

    this.parentStates.delete(input.parentSessionId);
    this.show('orchestrator');
  }

  onOrchestratorStatus(input: {
    sessionId?: string;
    status?: string;
    isOrchestrator?: boolean;
  }): void {
    if (!input.sessionId || !input.isOrchestrator) return;

    const state = this.parentStates.get(input.sessionId);
    if (state && state.activeCalls.size > 0) return;

    if (input.status === 'busy') {
      this.show('orchestrator');
      return;
    }

    if (input.status === 'idle') {
      this.show('intro');
    }
  }

  onSessionDeleted(sessionId?: string): void {
    if (!sessionId) return;
    this.parentStates.delete(sessionId);
  }

  private getParentState(parentSessionId: string): ParentState {
    const existing = this.parentStates.get(parentSessionId);
    if (existing) return existing;

    const created: ParentState = {
      activeCalls: new Map(),
    };
    this.parentStates.set(parentSessionId, created);
    return created;
  }

  private show(agent: string): void {
    if (!this.config.enabled) return;

    if (!this.assetDir) {
      log('[divoom] asset directory not found');
      return;
    }

    const fileName =
      this.config.gifs?.[agent] ?? AGENT_GIFS[agent] ?? AGENT_GIFS.orchestrator;
    const gifPath = path.isAbsolute(fileName)
      ? fileName
      : path.join(this.assetDir, fileName);
    if (!existsSync(gifPath)) {
      log('[divoom] gif not found', { agent, gifPath });
      return;
    }

    if (gifPath === this.lastGifPath) return;
    this.lastGifPath = gifPath;

    try {
      this.sender({
        command: this.config.python,
        args: [
          this.config.script,
          gifPath,
          '--size',
          String(this.config.size),
          '--fps',
          String(this.config.fps),
          '--speed',
          String(this.config.speed),
          '--max-frames',
          String(this.config.maxFrames),
          '--posterize-bits',
          String(this.config.posterizeBits),
        ],
      });
      log('[divoom] showing gif', { agent, gifPath });
    } catch (error) {
      log('[divoom] failed to spawn sender', String(error));
    }
  }
}

function isTaskArgs(value: unknown): value is TaskArgs {
  return typeof value === 'object' && value !== null;
}

function defaultSender(call: DivoomSenderCall): void {
  const child = spawn(call.command, call.args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

export function createDivoomManager(
  config?: Partial<DivoomConfig>,
): DivoomManager {
  return new DivoomManager(config);
}
