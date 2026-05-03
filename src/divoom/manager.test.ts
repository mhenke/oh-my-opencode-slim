import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DivoomManager, type DivoomSenderCall } from './manager';

function createGifAssets(dir: string, names: string[]): void {
  for (const name of names) {
    writeFileSync(path.join(dir, name), 'gif');
  }
}

describe('DivoomManager', () => {
  let tempDir: string;
  let calls: DivoomSenderCall[];

  beforeEach(() => {
    tempDir = mkdtempSync(path.join(tmpdir(), 'divoom-test-'));
    calls = [];
    createGifAssets(tempDir, [
      'intro.gif',
      'orchestrator.gif',
      'explorer.gif',
      'fixer.gif',
      'oracle.gif',
    ]);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  function createManager(config: { enabled?: boolean } = {}) {
    return new DivoomManager(
      {
        enabled: config.enabled ?? true,
      },
      (call) => calls.push(call),
      { assetDir: tempDir },
    );
  }

  test('does nothing when disabled', () => {
    const manager = createManager({ enabled: false });

    manager.onPluginLoad();
    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'explorer' },
    });
    manager.onTaskEnd({ parentSessionId: 'parent', callId: 'call-1' });

    expect(calls).toHaveLength(0);
  });

  test('shows intro on plugin load when enabled', () => {
    const manager = createManager();

    manager.onPluginLoad();

    expect(calls).toHaveLength(1);
    expect(calls[0].args[1]).toBe(path.join(tempDir, 'intro.gif'));
  });

  test('shows task agent then orchestrator after a single task', () => {
    const manager = createManager();

    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'explorer' },
    });
    manager.onTaskEnd({ parentSessionId: 'parent', callId: 'call-1' });

    expect(calls.map((call) => call.args[1])).toEqual([
      path.join(tempDir, 'explorer.gif'),
      path.join(tempDir, 'orchestrator.gif'),
    ]);
  });

  test('shows orchestrator while busy and intro when idle', () => {
    const manager = createManager();

    manager.onOrchestratorStatus({
      sessionId: 'parent',
      status: 'busy',
      isOrchestrator: true,
    });
    manager.onOrchestratorStatus({
      sessionId: 'parent',
      status: 'idle',
      isOrchestrator: true,
    });

    expect(calls.map((call) => call.args[1])).toEqual([
      path.join(tempDir, 'orchestrator.gif'),
      path.join(tempDir, 'intro.gif'),
    ]);
  });

  test('does not override active child agent with orchestrator status', () => {
    const manager = createManager();

    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'explorer' },
    });
    manager.onOrchestratorStatus({
      sessionId: 'parent',
      status: 'busy',
      isOrchestrator: true,
    });
    manager.onOrchestratorStatus({
      sessionId: 'parent',
      status: 'idle',
      isOrchestrator: true,
    });
    manager.onTaskEnd({ parentSessionId: 'parent', callId: 'call-1' });
    manager.onOrchestratorStatus({
      sessionId: 'parent',
      status: 'idle',
      isOrchestrator: true,
    });

    expect(calls.map((call) => call.args[1])).toEqual([
      path.join(tempDir, 'explorer.gif'),
      path.join(tempDir, 'orchestrator.gif'),
      path.join(tempDir, 'intro.gif'),
    ]);
  });

  test('keeps first agent visible for parallel tasks', () => {
    const manager = createManager();

    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'explorer' },
    });
    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-2',
      args: { subagent_type: 'fixer' },
    });
    manager.onTaskEnd({ parentSessionId: 'parent', callId: 'call-1' });
    manager.onTaskEnd({ parentSessionId: 'parent', callId: 'call-2' });

    expect(calls.map((call) => call.args[1])).toEqual([
      path.join(tempDir, 'explorer.gif'),
      path.join(tempDir, 'orchestrator.gif'),
    ]);
  });

  test('falls back to orchestrator gif for unknown agents', () => {
    const manager = createManager();

    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'custom-agent' },
    });

    expect(calls.map((call) => call.args[1])).toEqual([
      path.join(tempDir, 'orchestrator.gif'),
    ]);
  });

  test('uses configured sender settings and gif overrides', () => {
    const customGif = path.join(tempDir, 'custom-oracle.gif');
    writeFileSync(customGif, 'gif');
    const manager = new DivoomManager(
      {
        enabled: true,
        python: '/custom/python',
        script: '/custom/divoom_send.py',
        size: 64,
        fps: 12,
        speed: 250,
        maxFrames: 10,
        posterizeBits: 4,
        gifs: { oracle: customGif },
      },
      (call) => calls.push(call),
      { assetDir: tempDir },
    );

    manager.onTaskStart({
      parentSessionId: 'parent',
      callId: 'call-1',
      args: { subagent_type: 'oracle' },
    });

    expect(calls[0]).toEqual({
      command: '/custom/python',
      args: [
        '/custom/divoom_send.py',
        customGif,
        '--size',
        '64',
        '--fps',
        '12',
        '--speed',
        '250',
        '--max-frames',
        '10',
        '--posterize-bits',
        '4',
      ],
    });
  });
});
