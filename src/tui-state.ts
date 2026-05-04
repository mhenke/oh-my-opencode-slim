import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

export interface TuiSnapshot {
  version: 1;
  updatedAt: number;
  agentModels: Record<string, string>;
  configInvalid: boolean;
  configInvalidByProject: Record<string, boolean>;
}

const STATE_DIR = 'oh-my-opencode-slim';
const STATE_FILE = 'tui-state.json';

function dataDir(): string {
  return (
    process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
  );
}

export function getTuiStatePath(): string {
  return path.join(dataDir(), 'opencode', 'storage', STATE_DIR, STATE_FILE);
}

/**
 * Create a normalized project key from a directory path.
 * Uses SHA-256 hash of the resolved absolute path, truncated to 16 hex chars.
 */
export function createTuiProjectKey(directory: string): string {
  const resolved = path.resolve(directory);
  return crypto
    .createHash('sha256')
    .update(resolved)
    .digest('hex')
    .slice(0, 16);
}

function parseConfigInvalidByProject(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter(([, invalid]) => typeof invalid === 'boolean'),
  ) as Record<string, boolean>;
}

/**
 * Determine whether config is invalid for a given project.
 * When projectKey is provided, checks configInvalidByProject[projectKey].
 * Falls back to legacy snapshot.configInvalid when no projectKey is given.
 */
export function isTuiConfigInvalid(
  snapshot: TuiSnapshot,
  projectKey?: string,
): boolean {
  if (projectKey) {
    return snapshot.configInvalidByProject[projectKey] ?? false;
  }
  return snapshot.configInvalid;
}

function emptySnapshot(): TuiSnapshot {
  return {
    version: 1,
    updatedAt: Date.now(),
    agentModels: {},
    configInvalid: false,
    configInvalidByProject: {},
  };
}

function parseSnapshot(value: string): TuiSnapshot {
  const parsed = JSON.parse(value) as Partial<TuiSnapshot> | undefined;
  if (parsed?.version !== 1) return emptySnapshot();

  return {
    version: 1,
    updatedAt:
      typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
    agentModels: parsed.agentModels ?? {},
    configInvalid:
      typeof parsed.configInvalid === 'boolean' ? parsed.configInvalid : false,
    configInvalidByProject: parseConfigInvalidByProject(
      parsed.configInvalidByProject,
    ),
  };
}

export function readTuiSnapshot(): TuiSnapshot {
  try {
    return parseSnapshot(fs.readFileSync(getTuiStatePath(), 'utf8'));
  } catch {
    return emptySnapshot();
  }
}

export async function readTuiSnapshotAsync(): Promise<TuiSnapshot> {
  try {
    return parseSnapshot(await fs.promises.readFile(getTuiStatePath(), 'utf8'));
  } catch {
    return emptySnapshot();
  }
}

function writeTuiSnapshot(snapshot: TuiSnapshot): void {
  try {
    const filePath = getTuiStatePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, `${JSON.stringify(snapshot)}\n`);
  } catch {
    // TUI state is best-effort only.
  }
}

function updateSnapshot(mutator: (snapshot: TuiSnapshot) => void): void {
  const snapshot = readTuiSnapshot();
  mutator(snapshot);
  snapshot.updatedAt = Date.now();
  writeTuiSnapshot(snapshot);
}

export function recordTuiAgentModels(input: {
  agentModels: Record<string, string>;
}): void {
  updateSnapshot((snapshot) => {
    snapshot.agentModels = { ...input.agentModels };
  });
}

export function recordTuiAgentModel(input: {
  agentName: string;
  model: string;
}): void {
  updateSnapshot((snapshot) => {
    snapshot.agentModels[input.agentName] = input.model;
  });
}

export function recordTuiConfigStatus(input: {
  invalid: boolean;
  projectKey?: string;
}): void {
  updateSnapshot((snapshot) => {
    if (input.projectKey) {
      snapshot.configInvalidByProject[input.projectKey] = input.invalid;
    } else {
      snapshot.configInvalid = input.invalid;
    }
  });
}
