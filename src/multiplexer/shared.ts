/**
 * Shared multiplexer infrastructure
 *
 * Functions used across tmux, zellij, and herdr backend adapters.
 * Extracted to eliminate copy-paste duplication and prevent drift.
 */

import { crossSpawn } from '../utils/compat';
import { log } from '../utils/logger';

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function buildOpencodeAttachCommand(
  sessionId: string,
  serverUrl: string,
  directory: string,
): string {
  return [
    'opencode',
    'attach',
    quoteShellArg(serverUrl),
    '--session',
    quoteShellArg(sessionId),
    '--dir',
    quoteShellArg(directory),
  ].join(' ');
}

export async function findBinary(binaryName: string): Promise<string | null> {
  const isWindows = process.platform === 'win32';
  const cmd = isWindows ? 'where' : 'which';
  const logPrefix = `[${binaryName}]`;

  try {
    const proc = crossSpawn([cmd, binaryName], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      log(`${logPrefix} findBinary: 'which ${binaryName}' failed`, {
        exitCode,
      });
      return null;
    }

    const stdout = await proc.stdout();
    const path = stdout.trim().split('\n')[0];
    if (!path) {
      log(`${logPrefix} findBinary: no path in output`);
      return null;
    }

    log(`${logPrefix} findBinary: found`, { path });
    return path;
  } catch (err) {
    log(`${logPrefix} findBinary: exception`, { error: String(err) });
    return null;
  }
}
