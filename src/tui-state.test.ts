import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createTuiProjectKey,
  isTuiConfigInvalid,
  readTuiSnapshot,
  recordTuiAgentModel,
  recordTuiAgentModels,
  recordTuiConfigStatus,
} from './tui-state';

let previousXdgDataHome: string | undefined;
let tempDir: string;

beforeEach(() => {
  previousXdgDataHome = process.env.XDG_DATA_HOME;
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'omos-tui-state-'));
  process.env.XDG_DATA_HOME = tempDir;
});

afterEach(() => {
  if (previousXdgDataHome === undefined) {
    delete process.env.XDG_DATA_HOME;
  } else {
    process.env.XDG_DATA_HOME = previousXdgDataHome;
  }

  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('tui-state persistence', () => {
  test('persists enabled agent models', () => {
    recordTuiAgentModels({
      agentModels: {
        explorer: 'openai/gpt-5.4-mini',
        fixer: 'openai/gpt-5.4-mini',
      },
    });

    const snapshot = readTuiSnapshot();

    expect(snapshot.agentModels).toEqual({
      explorer: 'openai/gpt-5.4-mini',
      fixer: 'openai/gpt-5.4-mini',
    });
  });

  test('updates a single live agent model without dropping others', () => {
    recordTuiAgentModels({
      agentModels: {
        orchestrator: 'default',
        explorer: 'openai/gpt-5.4-mini',
      },
    });

    recordTuiAgentModel({
      agentName: 'orchestrator',
      model: 'openai/gpt-5.5',
    });

    expect(readTuiSnapshot().agentModels).toEqual({
      orchestrator: 'openai/gpt-5.5',
      explorer: 'openai/gpt-5.4-mini',
    });
  });

  test('recordTuiConfigStatus sets configInvalid to true', () => {
    recordTuiConfigStatus({ invalid: true });
    expect(readTuiSnapshot().configInvalid).toBe(true);
  });

  test('recordTuiConfigStatus sets configInvalid to false', () => {
    recordTuiConfigStatus({ invalid: true });
    recordTuiConfigStatus({ invalid: false });
    expect(readTuiSnapshot().configInvalid).toBe(false);
  });

  test('configInvalid defaults to false for old snapshots without the field', () => {
    // Use suite-level tempDir; write old-format snapshot (no configInvalid field)
    const filePath = path.join(
      tempDir,
      'opencode',
      'storage',
      'oh-my-opencode-slim',
      'tui-state.json',
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ version: 1, updatedAt: Date.now(), agentModels: {} }),
    );

    const snapshot = readTuiSnapshot();
    expect(snapshot.configInvalid).toBe(false);
  });
});

describe('tui-state project-scoped configInvalid', () => {
  test('recordTuiConfigStatus with projectKey sets configInvalidByProject', () => {
    const projectKey = createTuiProjectKey('/tmp/project-a');
    recordTuiConfigStatus({ invalid: true, projectKey });

    const snapshot = readTuiSnapshot();
    expect(snapshot.configInvalidByProject[projectKey]).toBe(true);
    expect(snapshot.configInvalid).toBe(false); // legacy unchanged
  });

  test('recordTuiConfigStatus with projectKey false clears that key', () => {
    const projectKey = createTuiProjectKey('/tmp/project-b');
    recordTuiConfigStatus({ invalid: true, projectKey });
    recordTuiConfigStatus({ invalid: false, projectKey });

    const snapshot = readTuiSnapshot();
    expect(snapshot.configInvalidByProject[projectKey]).toBe(false);
  });

  test('different project keys do not overwrite each other', () => {
    const keyA = createTuiProjectKey('/tmp/project-c');
    const keyB = createTuiProjectKey('/tmp/project-d');
    recordTuiConfigStatus({ invalid: true, projectKey: keyA });
    recordTuiConfigStatus({ invalid: false, projectKey: keyB });

    const snapshot = readTuiSnapshot();
    expect(snapshot.configInvalidByProject[keyA]).toBe(true);
    expect(snapshot.configInvalidByProject[keyB]).toBe(false);
  });

  test('isTuiConfigInvalid uses configInvalidByProject when projectKey given', () => {
    const projectKey = createTuiProjectKey('/tmp/project-e');
    recordTuiConfigStatus({ invalid: true, projectKey });

    const snapshot = readTuiSnapshot();
    expect(isTuiConfigInvalid(snapshot, projectKey)).toBe(true);
    expect(
      isTuiConfigInvalid(snapshot, createTuiProjectKey('/tmp/other')),
    ).toBe(false);
  });

  test('isTuiConfigInvalid falls back to legacy configInvalid when no projectKey', () => {
    recordTuiConfigStatus({ invalid: true }); // no projectKey = legacy
    const snapshot = readTuiSnapshot();
    expect(isTuiConfigInvalid(snapshot)).toBe(true);
    expect(isTuiConfigInvalid(snapshot, undefined)).toBe(true);
  });

  test('old snapshot without configInvalidByProject defaults to empty object', () => {
    const filePath = path.join(
      tempDir,
      'opencode',
      'storage',
      'oh-my-opencode-slim',
      'tui-state.json',
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({ version: 1, updatedAt: Date.now(), agentModels: {} }),
    );

    const snapshot = readTuiSnapshot();
    expect(snapshot.configInvalidByProject).toEqual({});
  });

  test('malformed configInvalidByProject entries are ignored', () => {
    const projectKey = createTuiProjectKey('/tmp/project-f');
    const filePath = path.join(
      tempDir,
      'opencode',
      'storage',
      'oh-my-opencode-slim',
      'tui-state.json',
    );
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      JSON.stringify({
        version: 1,
        updatedAt: Date.now(),
        agentModels: {},
        configInvalidByProject: { [projectKey]: true, invalid: 'yes' },
      }),
    );

    expect(readTuiSnapshot().configInvalidByProject).toEqual({
      [projectKey]: true,
    });
  });

  test('createTuiProjectKey produces consistent hash for same path', () => {
    const key1 = createTuiProjectKey('/tmp/same');
    const key2 = createTuiProjectKey('/tmp/same');
    expect(key1).toBe(key2);
    expect(key1).toHaveLength(16);
  });

  test('createTuiProjectKey produces different hash for different paths', () => {
    const key1 = createTuiProjectKey('/tmp/diff1');
    const key2 = createTuiProjectKey('/tmp/diff2');
    expect(key1).not.toBe(key2);
  });
});
