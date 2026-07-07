# Herdr main-vertical Layout Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Herdr's `main-vertical` multiplexer layout stack subagent panes vertically in a right-side column instead of repeatedly splitting right from the parent.

**Architecture:** Track a single `agentAreaPaneId` (first child in right column). Route subsequent spawns to split down from that pane. Fall back to parent split on stale reference. `closePane` and `applyLayout` clear the tracking.

**Tech Stack:** TypeScript, Bun (test runner), Biome (lint/format). No new dependencies.

## Global Constraints

- Biome formatter: single quotes, 2-space indent, 80-char line width, trailing commas always.
- Strict TypeScript mode; no explicit `any` (test files exempt).
- Tests use `bun:test` (describe/test/expect/mock).
- No new dependencies added (YAGNI).
- `ponytail:` comment for deliberate simplifications.
- Commit messages: conventional style, reference issue #668.

---

### Task 1: Add state fields to HerdrMultiplexer

**Files:**
- Modify: `src/multiplexer/herdr/index.ts:31-44` (constructor + fields)

**Interfaces:**
- Consumes: `MultiplexerLayout` type from `../../config/schema`
- Produces: `this.layout`, `this.paneDirection`, `this.agentAreaPaneId` for later tasks

- [ ] **Step 1: Write the failing test**

Add to `src/multiplexer/herdr/index.test.ts` after the existing constructor tests:

```typescript
test('stores layout from constructor', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);
  // @ts-expect-error - accessing private for test
  expect(herdr.layout).toBe('main-vertical');
  // @ts-expect-error
  expect(herdr.agentAreaPaneId).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/multiplexer/herdr/index.test.ts -t "stores layout from constructor"`
Expected: FAIL with property does not exist

- [ ] **Step 3: Write minimal implementation**

In `src/multiplexer/herdr/index.ts`, change the class fields and constructor:

```typescript
export class HerdrMultiplexer implements Multiplexer {
  readonly type = 'herdr' as const;

  private binaryPath: string | null = null;
  private hasChecked = false;
  private readonly parentPaneId = process.env.HERDR_PANE_ID;
  private readonly layout: MultiplexerLayout;
  private readonly paneDirection: HerdrPaneDirection;
  private agentAreaPaneId: string | null = null;

  constructor(layout: MultiplexerLayout = 'main-vertical', mainPaneSize = 60) {
    // Herdr does not support exact main pane sizing like tmux.
    // Layout config is mapped to pane split direction.
    void mainPaneSize;
    this.layout = layout;
    this.paneDirection = getPaneDirection(layout);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/multiplexer/herdr/index.test.ts -t "stores layout from constructor"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/multiplexer/herdr/index.ts src/multiplexer/herdr/index.test.ts
git commit -m "feat(herdr): store layout and add agentAreaPaneId tracking field"
```

---

### Task 2: Implement main-vertical split logic in spawnPane

**Files:**
- Modify: `src/multiplexer/herdr/index.ts:60-153` (spawnPane method)

**Interfaces:**
- Consumes: `this.layout`, `this.paneDirection`, `this.agentAreaPaneId`, `this.targetPaneArg()`
- Produces: updated `spawnPane` with smart split targeting

- [ ] **Step 1: Write the failing tests**

Add to `src/multiplexer/herdr/index.test.ts`:

```typescript
test('main-vertical: 2nd spawn splits agent area down', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  // First spawn creates agent area
  await herdr.spawnPane('s1', 'Agent 1', 'http://localhost:4096', '/repo');
  // Second spawn should split from agent area (w1:p2) downward
  await herdr.spawnPane('s2', 'Agent 2', 'http://localhost:4096', '/repo');

  const splitCommands = commands().filter((c) => c.includes('split'));
  // 1st: parent → right
  expect(splitCommands[0]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'right', '--cwd', '/repo', '--no-focus',
  ]);
  // 2nd: agent area (w1:p2) → down
  expect(splitCommands[1]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p2',
    '--direction', 'down', '--cwd', '/repo', '--no-focus',
  ]);
});

test('main-vertical: 3rd spawn splits same agent area down', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  await herdr.spawnPane('s2', 'A2', 'http://localhost:4096', '/repo');
  await herdr.spawnPane('s3', 'A3', 'http://localhost:4096', '/repo');

  const splitCommands = commands().filter((c) => c.includes('split'));
  // All subsequent spawns target w1:p2 (agent area)
  expect(splitCommands[2]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p2',
    '--direction', 'down', '--cwd', '/repo', '--no-focus',
  ]);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/multiplexer/herdr/index.test.ts -t "main-vertical"`
Expected: FAIL (direction is 'right' for all)

- [ ] **Step 3: Write minimal implementation**

Replace the split-args construction and split call in `spawnPane` (lines 72-112):

```typescript
    try {
      // Determine split target and direction based on layout + agent area state
      let target: string[];
      let direction: HerdrPaneDirection;
      let wasFirstChild = false;

      if (this.layout === 'main-vertical' && this.agentAreaPaneId) {
        target = [this.agentAreaPaneId];
        direction = 'down';
        const agentSplit = await this.runSplit(
          target,
          direction,
          directory,
        );
        if (!agentSplit) {
          log('[herdr] agent area split failed, falling back to parent', {
            agentAreaPaneId: this.agentAreaPaneId,
          });
          this.agentAreaPaneId = null;
        }
      }

      if (!this.agentAreaPaneId) {
        // First child OR fallback after stale agent area
        target = this.targetPaneArg();
        direction = this.paneDirection;
        wasFirstChild = true;
      }

      let paneId: string | null = null;
      if (wasFirstChild) {
        paneId = await this.runSplit(target, direction, directory);
      } else {
        // agent area split already ran; re-parse from last split output
        paneId = this.lastSplitPaneId;
      }

      if (!paneId) {
        log('[herdr] spawnPane: could not parse pane_id from output');
        return { success: false };
      }

      // 2. Rename the pane for visibility
      await crossSpawn(
        [herdr, 'pane', 'rename', paneId, description.slice(0, 30)],
        { stdout: 'ignore', stderr: 'ignore' },
      ).exited;

      // 3. Run opencode attach in the new pane
      const opencodeCmd = buildOpencodeAttachCommand(
        sessionId,
        serverUrl,
        directory,
      );

      const runProc = crossSpawn([herdr, 'pane', 'run', paneId, opencodeCmd], {
        stdout: 'pipe',
        stderr: 'pipe',
      });

      const runExitCode = await runProc.exited;
      if (runExitCode !== 0) {
        const runStderr = await runProc.stderr();
        log('[herdr] spawnPane: run failed', {
          exitCode: runExitCode,
          stderr: runStderr.trim(),
        });
        return { success: false };
      }

      if (wasFirstChild && this.layout === 'main-vertical') {
        this.agentAreaPaneId = paneId;
      }

      log('[herdr] spawnPane: SUCCESS', { paneId });
      return { success: true, paneId };
    } catch (err) {
      log('[herdr] spawnPane: exception', { error: String(err) });
      return { success: false };
    }
```

Add a helper method `runSplit` and field `lastSplitPaneId`:

```typescript
  private lastSplitPaneId: string | null = null;

  private async runSplit(
    target: string[],
    direction: HerdrPaneDirection,
    directory: string,
  ): Promise<string | null> {
    const herdr = await this.getBinary();
    if (!herdr) return null;

    const splitArgs = [
      herdr,
      'pane',
      'split',
      ...target,
      '--direction',
      direction,
      '--cwd',
      directory,
      '--no-focus',
    ];

    log('[herdr] spawnPane: splitting pane', { args: splitArgs });

    const splitProc = crossSpawn(splitArgs, {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const splitExitCode = await splitProc.exited;
    const splitStdout = await splitProc.stdout();
    const splitStderr = await splitProc.stderr();

    if (splitExitCode !== 0) {
      log('[herdr] spawnPane: split failed', {
        exitCode: splitExitCode,
        stderr: splitStderr.trim(),
      });
      return null;
    }

    const paneId = parsePaneId(splitStdout);
    this.lastSplitPaneId = paneId;
    return paneId;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/multiplexer/herdr/index.test.ts`
Expected: PASS (all herdr tests)

- [ ] **Step 5: Commit**

```bash
git add src/multiplexer/herdr/index.ts src/multiplexer/herdr/index.test.ts
git commit -m "feat(herdr): implement main-vertical agent-area stacking"
```

---

### Task 3: Handle stale agent area fallback in tests

**Files:**
- Modify: `src/multiplexer/herdr/index.test.ts` (add fallback test)

**Interfaces:**
- Consumes: `spawnPane`, `closePane`, `agentAreaPaneId` state
- Produces: verified fallback behavior

- [ ] **Step 1: Write the failing test**

```typescript
test('main-vertical: fallback to parent when agent area closed', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  const r1 = await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  // Simulate agent area pane being closed externally
  await herdr.closePane(r1.paneId!);

  // Next spawn should split from parent (w1:p1) → right, not from stale w1:p2
  await herdr.spawnPane('s2', 'A2', 'http://localhost:4096', '/repo');

  const splitCommands = commands().filter((c) => c.includes('split'));
  // 1st: parent → right (w1:p1)
  expect(splitCommands[0]).toContain('w1:p1');
  // 2nd (after close): parent → right again (w1:p1), not w1:p2
  expect(splitCommands[1]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'right', '--cwd', '/repo', '--no-focus',
  ]);
});
```

- [ ] **Step 2: Run test to verify it passes**

Run: `bun test src/multiplexer/herdr/index.test.ts -t "fallback to parent when agent area closed"`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/multiplexer/herdr/index.test.ts
git commit -m "test(herdr): verify agent-area fallback on close"
```

---

### Task 4: Update closePane and applyLayout

**Files:**
- Modify: `src/multiplexer/herdr/index.ts:155-209` (closePane + applyLayout)

**Interfaces:**
- Consumes: `this.agentAreaPaneId`
- Produces: cleared tracking on close/layout change

- [ ] **Step 1: Write the failing test**

```typescript
test('closePane clears agentAreaPaneId when agent area closed', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  const r1 = await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  await herdr.closePane(r1.paneId!);

  // @ts-expect-error - accessing private for test
  expect(herdr.agentAreaPaneId).toBeNull();
});

test('closePane does NOT clear agentAreaPaneId for non-agent pane', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  // Close a different pane (simulated)
  await herdr.closePane('w1:p99');

  // @ts-expect-error
  expect(herdr.agentAreaPaneId).not.toBeNull();
});

test('applyLayout clears agentAreaPaneId', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-vertical', 60);

  await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  await herdr.applyLayout('tiled', 50);

  // @ts-expect-error
  expect(herdr.agentAreaPaneId).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test src/multiplexer/herdr/index.test.ts -t "agentAreaPaneId"`
Expected: FAIL (field not cleared)

- [ ] **Step 3: Write minimal implementation**

In `closePane`, after the guard `if (!paneId || paneId === 'unknown') return true;`:

```typescript
  async closePane(paneId: string): Promise<boolean> {
    if (!paneId || paneId === 'unknown') return true;

    if (paneId === this.agentAreaPaneId) {
      this.agentAreaPaneId = null;
    }

    const herdr = await this.getBinary();
```

In `applyLayout`:

```typescript
  async applyLayout(
    _layout: MultiplexerLayout,
    _mainPaneSize: number,
  ): Promise<void> {
    // ponytail: herdr has no rebalancing API; clear agent area so a layout
    // switch starts fresh from the parent pane.
    this.agentAreaPaneId = null;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test src/multiplexer/herdr/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/multiplexer/herdr/index.ts src/multiplexer/herdr/index.test.ts
git commit -m "feat(herdr): clear agent-area tracking on close and layout change"
```

---

### Task 5: Verify non-main layouts unaffected

**Files:**
- Modify: `src/multiplexer/herdr/index.test.ts` (add regression tests)

**Interfaces:**
- Consumes: existing layout tests
- Produces: confirmed tiled/main-horizontal unchanged

- [ ] **Step 1: Write the failing tests**

```typescript
test('tiled layout always splits parent right (unaffected)', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('tiled', 60);

  await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  await herdr.spawnPane('s2', 'A2', 'http://localhost:4096', '/repo');

  const splitCommands = commands().filter((c) => c.includes('split'));
  expect(splitCommands[0]).toContain('w1:p1');
  expect(splitCommands[0]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'right', '--cwd', '/repo', '--no-focus',
  ]);
  expect(splitCommands[1]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'right', '--cwd', '/repo', '--no-focus',
  ]);
});

test('main-horizontal layout always splits parent down (unaffected)', async () => {
  const { HerdrMultiplexer } = await importFreshHerdr();
  const herdr = new HerdrMultiplexer('main-horizontal', 60);

  await herdr.spawnPane('s1', 'A1', 'http://localhost:4096', '/repo');
  await herdr.spawnPane('s2', 'A2', 'http://localhost:4096', '/repo');

  const splitCommands = commands().filter((c) => c.includes('split'));
  expect(splitCommands[0]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'down', '--cwd', '/repo', '--no-focus',
  ]);
  expect(splitCommands[1]).toEqual([
    '/usr/bin/herdr', 'pane', 'split', 'w1:p1',
    '--direction', 'down', '--cwd', '/repo', '--no-focus',
  ]);
});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `bun test src/multiplexer/herdr/index.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/multiplexer/herdr/index.test.ts
git commit -m "test(herdr): verify non-main layouts unaffected by agent-area tracking"
```

---

### Task 6: Update documentation

**Files:**
- Modify: `docs/multiplexer-integration.md` (Herdr layout section)

**Interfaces:**
- Consumes: spec documentation requirements
- Produces: accurate Herdr main-vertical description

- [ ] **Step 1: Read current docs section**

Read `docs/multiplexer-integration.md` lines covering Herdr layout behavior.

- [ ] **Step 2: Update Herdr layout description**

Find the table or text describing Herdr `main-vertical` mapping. Replace with:

```markdown
#### Herdr Layout Behavior

| Layout | Herdr behavior |
|--------|----------------|
| `main-vertical` | Parent OpenCode pane stays on the left. First subagent opens in a right-side pane; subsequent subagents stack vertically in that right column. Parent pane remains dominant. |
| `main-horizontal` | Each subagent splits below the parent (down). |
| `even-horizontal` / `tiled` | Each subagent splits to the right of the parent. |
| `even-vertical` | Each subagent splits below the parent. |

**Note:** Herdr has no layout rebalancing API like tmux's `select-layout`.
The `main_pane_size` config is ignored. The `main-vertical` layout approximates
tmux's behavior by tracking the first right-side pane and stacking later agents
vertically within it. If the agent-area pane is closed, the next spawn
re-creates it from the parent.
```

- [ ] **Step 3: Verify docs render**

Run: `bun run check:ci` (no doc lint, but confirms no broken markdown in build)
Expected: clean

- [ ] **Step 4: Commit**

```bash
git add docs/multiplexer-integration.md
git commit -m "docs: describe actual Herdr main-vertical behavior (issue #668)"
```

---

### Task 7: Final verification

**Files:**
- All modified files

**Interfaces:**
- Consumes: all prior tasks
- Produces: green CI

- [ ] **Step 1: Run full test suite**

Run: `bun test src/multiplexer/herdr/index.test.ts`
Expected: all herdr tests PASS

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: no errors

- [ ] **Step 3: Run lint/format check**

Run: `bun run check:ci`
Expected: clean

- [ ] **Step 4: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix(herdr): address lint/type issues from main-vertical implementation"
```
