// @ts-check
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  appendPlugins: ['@hughescr/stryker-bun-runner'],
  testRunner: 'bun',
  coverageAnalysis: 'perTest',
  // Part 2 scope: the extracted plugin units vs their factory-surface test.
  // state.ts is a type + factory module — mutation testing on it is noise.
  mutate: ['src/plugin/**/*.ts', '!src/plugin/state.ts'],
  reporters: ['clear-text', 'progress', 'html'],
  bun: {
    // shortcut: pins npm-distributed bun 1.4 for the runner; switch back to
    // "bun" once the system bun is >= 1.4
    bunPath: 'node_modules/.bin/bun',
    // dry run loads only the covering tests: the full suite leaks state
    // across test files under the runner's sequential mode (45 failures,
    // every file passes standalone)
    timeout: 900000,
    testFiles: [
      'src/index.test.ts',
      'src/plugin/v2-bridges.test.ts',
      'src/plugin/wake-scheduler.test.ts',
      'src/plugin/background-jobs.test.ts',
    ],
  },
};
