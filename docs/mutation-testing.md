# Mutation Testing (StrykerJS)

Stryker makes small changes (mutants) to source code and checks that the test
suite notices; a mutant no test catches is a gap in the tests. Setup uses
[`@hughescr/stryker-bun-runner`](https://www.npmjs.com/package/@hughescr/stryker-bun-runner),
which runs `bun test` with per-test coverage, so each mutant only reruns the
tests that reach it.

## Run

`stryker.conf.mjs` is scoped to one module. To mutation-test a module:

1. Point `mutate` at the module's source file(s) and `bun.testFiles` at its
   test file(s).
2. Run:

   ```bash
   bunx stryker run
   ```

3. Kill every `Survived` mutant by strengthening the covering test, then move
   to the next module. The HTML report lands in `reports/mutation/`.

## Known limitations

- **Whole-suite dry run fails.** The runner executes all test files in one
  sequential process; this suite leaks state across test files in that mode
  (~45 failures, while every file passes standalone under both bun 1.3 and
  1.4). Keep `bun.testFiles` scoped to the module under test.
- **bun >= 1.4** is required by the runner. `bun.bunPath` pins the
  npm-distributed bun 1.4 while the system bun is 1.3; drop `bunPath` once the
  system bun is >= 1.4.
- **TypeScript is pinned to ^6** on this branch: Stryker's tsconfig
  preprocessing breaks on TypeScript 7 (`ts.parseConfigFileTextToJson is not a
  function`).
- `bunfig.toml` `[test].preload` entries must be literal file paths. The
  runner absolutizes preload entries, so the bare package specifier
  (`@opentui/solid/preload`) does not resolve in its sandbox; use
  `./node_modules/@opentui/solid/scripts/preload.js` (upstream bug in the
  plugin's bunfig sanitizer).

## Mock hygiene (process-persistent mock.module)

bun's `mock.module` replaces module records for the WHOLE test process — it
does not respect per-file boundaries, and `mock.restore()` cannot undo a
module replacement. Unit-test files in `src/plugin/*.test.ts` that mock
shared modules (`../config/runtime`, `../utils`, `../agents/registry`,
`../mcp`, `../tui-state`, and `'../hooks'` vs
`'../hooks/orchestrator-wake/index'` — DISTINCT registry identities for the
same directory) follow the shape:

1. Capture the real module at load: `import * as Real from '...';`
2. In the mock factory, spread the real record BEFORE overriding members and
   keep overridden members complete (including class statics via
   `Object.getOwnPropertyNames` — spread drops non-enumerable statics).
3. `afterAll`: `mock.module('<specifier>', () => Real);` re-registers the
   real record for later-loading files in the same process.

Known limits: the unit-test files cannot share one `bun test` invocation
with `src/v2/config-refresh.test.ts` without leak errors — run per-unit
measurement invocations instead
(`bunx stryker run --mutate <unit> --reporters clear-text`).
