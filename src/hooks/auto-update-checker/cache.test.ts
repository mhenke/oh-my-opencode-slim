import { describe, expect, mock, spyOn, test } from 'bun:test';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Mock logger to avoid noise
mock.module('../../utils/logger', () => ({
  log: mock(() => {}),
}));

mock.module('../../cli/config-manager', () => ({
  stripJsonComments: (s: string) => s,
  getOpenCodeConfigPaths: () => [
    '/mock/config/opencode.json',
    '/mock/config/opencode.jsonc',
  ],
}));

// Cache buster for dynamic imports
let importCounter = 0;

const cacheDir =
  process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA ?? os.homedir(), 'opencode')
    : path.join(os.homedir(), '.cache', 'opencode');
const packagesInstallDir = path.join(
  cacheDir,
  'packages',
  'oh-my-opencode-slim@latest',
);
const packagesRuntimePath = path.join(
  packagesInstallDir,
  'node_modules',
  'oh-my-opencode-slim',
  'package.json',
);
const packagesWrapperPath = path.join(packagesInstallDir, 'package.json');
const legacyPackageJsonPath = path.join(cacheDir, 'package.json');
const legacyInstalledPath = path.join(
  cacheDir,
  'node_modules',
  'oh-my-opencode-slim',
);

describe('auto-update-checker/cache', () => {
  describe('resolveInstallContext', () => {
    test('detects OpenCode packages install root from runtime package path', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) => p === packagesWrapperPath,
      );
      const { resolveInstallContext } = await import(
        `./cache?test=${importCounter++}`
      );

      const context = resolveInstallContext(packagesRuntimePath);

      expect(context).toEqual({
        installDir: packagesInstallDir,
        packageJsonPath: packagesWrapperPath,
      });

      existsSpy.mockRestore();
    });

    test('does not fall back to legacy cache when runtime path is active but wrapper root is invalid', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(() => false);
      const { resolveInstallContext } = await import(
        `./cache?test=${importCounter++}`
      );

      const context = resolveInstallContext(packagesRuntimePath);

      expect(context).toBeNull();

      existsSpy.mockRestore();
    });

    test('rejects project-local .opencode wrapper installs', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) => p === '/repo/.opencode/package.json',
      );
      const { resolveInstallContext } = await import(
        `./cache?test=${importCounter++}`
      );

      const context = resolveInstallContext(
        '/repo/.opencode/node_modules/oh-my-opencode-slim/package.json',
      );

      expect(context).toBeNull();

      existsSpy.mockRestore();
    });
  });

  describe('preparePackageUpdate', () => {
    test('returns null when no install context is available', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockReturnValue(false);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate('1.0.1');
      expect(result).toBeNull();

      existsSpy.mockRestore();
    });

    test('updates packages wrapper dependency and removes installed package', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) =>
          p === packagesWrapperPath ||
          p === path.join(
            packagesInstallDir,
            'node_modules',
            'oh-my-opencode-slim',
          ),
      );
      const readSpy = spyOn(fs, 'readFileSync').mockImplementation(
        (p: string) => {
          if (p === packagesWrapperPath) {
            return JSON.stringify({
              dependencies: {
                'oh-my-opencode-slim': '0.9.1',
              },
            });
          }
          return '';
        },
      );
      const writtenData: string[] = [];
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(
        (_path: string, data: string) => {
          writtenData.push(data);
        },
      );
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate(
        '0.9.11',
        'oh-my-opencode-slim',
        packagesRuntimePath,
      );

      expect(result).toBe(packagesInstallDir);
      expect(rmSyncSpy).toHaveBeenCalledWith(
        path.join(packagesInstallDir, 'node_modules', 'oh-my-opencode-slim'),
        { recursive: true, force: true },
      );
      expect(writtenData.length).toBeGreaterThan(0);
      expect(JSON.parse(writtenData[0])).toEqual({
        dependencies: {
          'oh-my-opencode-slim': '0.9.11',
        },
      });

      existsSpy.mockRestore();
      readSpy.mockRestore();
      writeSpy.mockRestore();
      rmSyncSpy.mockRestore();
    });

    test('keeps working when dependency is already on target version', async () => {
      const existsSpy = spyOn(fs, 'existsSync').mockImplementation(
        (p: string) =>
          p === legacyPackageJsonPath || p === legacyInstalledPath,
      );
      const readSpy = spyOn(fs, 'readFileSync').mockReturnValue(
        JSON.stringify({
          dependencies: {
            'oh-my-opencode-slim': '1.0.1',
          },
        }),
      );
      const writeSpy = spyOn(fs, 'writeFileSync').mockImplementation(() => {});
      const rmSyncSpy = spyOn(fs, 'rmSync').mockReturnValue(undefined);
      const { preparePackageUpdate } = await import(
        `./cache?test=${importCounter++}`
      );

      const result = preparePackageUpdate('1.0.1', 'oh-my-opencode-slim', null);

      expect(result).toBe(cacheDir);
      expect(writeSpy).not.toHaveBeenCalled();
      expect(rmSyncSpy).toHaveBeenCalled();

      existsSpy.mockRestore();
      readSpy.mockRestore();
      writeSpy.mockRestore();
      rmSyncSpy.mockRestore();
    });
  });
});
