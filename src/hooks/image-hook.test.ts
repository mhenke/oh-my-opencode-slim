import { afterAll, describe, expect, it } from 'bun:test';
import {
  chmodSync,
  mkdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { processImageAttachments } from './image-hook';

const TEST_DIR = path.join(os.tmpdir(), `image-hook-test-${process.pid}`);

function makeTestDir(name: string): { workDir: string; saveDir: string } {
  const workDir = path.join(TEST_DIR, name);
  const saveDir = path.join(workDir, '.opencode', 'images');
  mkdirSync(saveDir, { recursive: true });
  return { workDir, saveDir };
}

function makeOldFile(dir: string, name: string): string {
  const fp = path.join(dir, name);
  writeFileSync(fp, 'data');
  const past = new Date(Date.now() - 2 * 60 * 60 * 1000);
  utimesSync(fp, past, past);
  return fp;
}

describe('image-hook catch logging', () => {
  afterAll(() => {
    rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it('survives file cleanup failure without throwing', () => {
    const { workDir, saveDir } = makeTestDir('cleanup-fail-1');

    makeOldFile(saveDir, 'old-image.png');

    // Make the directory read-only to cause unlinkSync to fail
    chmodSync(saveDir, 0o555);

    try {
      // Must not throw despite failed cleanup
      expect(() => {
        processImageAttachments({
          messages: [],
          workDir,
          disabledAgents: new Set<string>(),
          log: () => {},
        });
      }).not.toThrow();
    } finally {
      chmodSync(saveDir, 0o755);
    }
  });

  it('survives subdirectory file cleanup failure without throwing', () => {
    const { workDir, saveDir } = makeTestDir('cleanup-fail-2');
    const sessionDir = path.join(saveDir, 'ses-abc');
    mkdirSync(sessionDir, { recursive: true });
    makeOldFile(sessionDir, 'img.png');

    chmodSync(sessionDir, 0o555);

    try {
      expect(() => {
        processImageAttachments({
          messages: [],
          workDir,
          disabledAgents: new Set<string>(),
          log: () => {},
        });
      }).not.toThrow();
    } finally {
      chmodSync(sessionDir, 0o755);
    }
  });
});
