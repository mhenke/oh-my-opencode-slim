# BackgroundJobCoordinator: Move Lifecycle Policy from Multiplexer to Coordinator

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize background job lifecycle policy (deferred close decisions) in the coordinator, not the multiplexer.

**Architecture:** The coordinator owns the `deferredIdleCloses` tracking and decides when sessions should close. The multiplexer becomes a thin pane manager that queries the coordinator before closing. The subscription wiring stays in `index.ts` (not in the multiplexer constructor) to avoid multi-instance issues.

**Tech Stack:** TypeScript, Bun

## Global Constraints

- No new dependencies
- All existing tests must pass
- Follow ponytail principles: minimal code, YAGNI
- Match existing code style (biome formatter)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/utils/background-job-coordinator.ts` | Modify | Add `deferredIdleCloses` tracking, `deferIfRunning()`, `retryDeferredClose()`, `clearDeferredClose()` |
| `src/utils/background-job-coordinator.test.ts` | Create | Test lifecycle policy logic |
| `src/utils/background-job-store.ts` | Modify | Add lifecycle methods to interface |
| `src/utils/background-job-board.ts` | Modify | Add stubs to satisfy interface |
| `src/multiplexer/session-manager.ts` | Modify | Remove `deferredIdleCloses`, remove `retryDeferredIdleClose()`, query coordinator |
| `src/multiplexer/session-manager.test.ts` | Modify | Update test setup to use coordinator |
| `src/index.ts` | Modify | Update wiring: keep subscription, remove retryDeferredIdleClose call |

---

### Task 1: Add lifecycle methods to BackgroundJobStore interface

**Files:**
- Modify: `src/utils/background-job-store.ts`

**Interfaces:**
- Produces: `deferIfRunning(sessionId: string): boolean`, `retryDeferredClose(sessionId: string): boolean`, `clearDeferredClose(sessionId: string): void`

- [ ] **Step 1: Add new methods to BackgroundJobStore interface**

```typescript
// In src/utils/background-job-store.ts, add after existing methods:

  // ── Lifecycle policy ─────────────────────────────────────────────
  /** Evaluate close policy. Returns true if session should close now.
   *  Mutates deferred state: adds to deferred set if running, removes if not. */
  deferIfRunning(sessionId: string): boolean;
  /** Retry closing a deferred session. Returns true if session should now close. */
  retryDeferredClose(sessionId: string): boolean;
  /** Clear deferred close state for a session being deleted. */
  clearDeferredClose(sessionId: string): void;
```

- [ ] **Step 2: Run typecheck to verify interface change**

Run: `bun run typecheck`
Expected: FAIL - BackgroundJobBoard and BackgroundJobCoordinator don't implement new methods yet

- [ ] **Step 3: Commit**

```bash
git add src/utils/background-job-store.ts
git commit -m "feat: add lifecycle methods to BackgroundJobStore interface"
```

---

### Task 2: Implement lifecycle policy in BackgroundJobCoordinator

**Files:**
- Modify: `src/utils/background-job-coordinator.ts`

**Interfaces:**
- Consumes: `BackgroundJobStore` interface (Task 1)
- Produces: Implemented `deferIfRunning()`, `retryDeferredClose()`, `clearDeferredClose()`

- [ ] **Step 1: Add deferredIdleCloses tracking to coordinator**

```typescript
// In src/utils/background-job-coordinator.ts, add to class properties:

  // Stores session IDs (which equal task IDs) awaiting close after background job completes
  private readonly deferredIdleCloses = new Set<string>();
```

- [ ] **Step 2: Implement deferIfRunning method**

```typescript
// In src/utils/background-job-coordinator.ts, add method:

  /**
   * Evaluate close policy. Returns true if session should close now.
   * Mutates deferred state: adds to deferred set if running, removes if not.
   */
  deferIfRunning(sessionId: string): boolean {
    if (!this.board.isRunning(sessionId)) {
      this.deferredIdleCloses.delete(sessionId);
      return true;
    }
    this.deferredIdleCloses.add(sessionId);
    return false;
  }
```

- [ ] **Step 3: Implement retryDeferredClose method**

```typescript
// In src/utils/background-job-coordinator.ts, add method:

  /**
   * Retry closing a deferred session. Called when a background job completes.
   * Returns true if the session should now close.
   */
  retryDeferredClose(sessionId: string): boolean {
    if (!this.deferredIdleCloses.has(sessionId)) return false;
    return this.deferIfRunning(sessionId);
  }
```

- [ ] **Step 4: Implement clearDeferredClose method**

```typescript
// In src/utils/background-job-coordinator.ts, add method:

  /**
   * Clear deferred close state for a session being deleted.
   */
  clearDeferredClose(sessionId: string): void {
    this.deferredIdleCloses.delete(sessionId);
  }
```

- [ ] **Step 5: Update handleTerminalState to notify listeners**

```typescript
// In src/utils/background-job-coordinator.ts, update handleTerminalState:

  private handleTerminalState(taskID: string): void {
    // Re-check board state to handle races
    const state = this.board.getState(taskID);
    if (state === undefined) return;

    // Check if this session should now close
    if (this.retryDeferredClose(taskID)) {
      // Notify listeners that session should close
      for (const listener of this.terminalStateListeners) {
        listener(taskID);
      }
    }
  }
```

- [ ] **Step 6: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/utils/background-job-coordinator.ts
git commit -m "feat: implement lifecycle policy in BackgroundJobCoordinator"
```

---

### Task 3: Write coordinator tests

**Files:**
- Create: `src/utils/background-job-coordinator.test.ts`

**Interfaces:**
- Consumes: BackgroundJobCoordinator (Task 2)

- [ ] **Step 1: Create test file with mock board**

```typescript
// In src/utils/background-job-coordinator.test.ts:

import { describe, expect, mock, test } from 'bun:test';
import { BackgroundJobCoordinator } from './background-job-coordinator';

function createMockBoard(isRunning = false) {
  return {
    isRunning: mock(() => isRunning),
    getState: mock(() => (isRunning ? 'running' : 'completed')),
    addTerminalStateListener: mock(() => {}),
    removeTerminalStateListener: mock(() => {}),
    // ... other methods as needed
  } as any;
}
```

- [ ] **Step 2: Test deferIfRunning returns false when job is running**

```typescript
test('deferIfRunning returns false when job is running', () => {
  const board = createMockBoard(true);
  const coordinator = new BackgroundJobCoordinator(board);
  expect(coordinator.deferIfRunning('ses_123')).toBe(false);
});
```

- [ ] **Step 3: Test deferIfRunning returns true when job is not running**

```typescript
test('deferIfRunning returns true when job is not running', () => {
  const board = createMockBoard(false);
  const coordinator = new BackgroundJobCoordinator(board);
  expect(coordinator.deferIfRunning('ses_123')).toBe(true);
});
```

- [ ] **Step 4: Test retryDeferredClose returns false when not in deferred set**

```typescript
test('retryDeferredClose returns false when not in deferred set', () => {
  const board = createMockBoard(false);
  const coordinator = new BackgroundJobCoordinator(board);
  expect(coordinator.retryDeferredClose('ses_123')).toBe(false);
});
```

- [ ] **Step 5: Test retryDeferredClose calls deferIfRunning internally**

```typescript
test('retryDeferredClose returns true after job completes', () => {
  const board = createMockBoard(true);
  const coordinator = new BackgroundJobCoordinator(board);
  
  // First call defers (job running)
  expect(coordinator.deferIfRunning('ses_123')).toBe(false);
  
  // Now simulate job completion
  board.isRunning.mockReturnValue(false);
  expect(coordinator.retryDeferredClose('ses_123')).toBe(true);
});
```

- [ ] **Step 6: Test clearDeferredClose removes from set**

```typescript
test('clearDeferredClose removes from deferred set', () => {
  const board = createMockBoard(true);
  const coordinator = new BackgroundJobCoordinator(board);
  
  coordinator.deferIfRunning('ses_123');
  coordinator.clearDeferredClose('ses_123');
  
  // Now retryDeferredClose should return false (not in set)
  board.isRunning.mockReturnValue(false);
  expect(coordinator.retryDeferredClose('ses_123')).toBe(false);
});
```

- [ ] **Step 7: Test handleTerminalState notifies listeners when retryDeferredClose returns true**

```typescript
test('handleTerminalState notifies listeners when retryDeferredClose returns true', () => {
  const board = createMockBoard(true);
  const coordinator = new BackgroundJobCoordinator(board);
  const listener = mock(() => {});
  
  coordinator.addTerminalStateListener(listener);
  
  // Defer the session
  coordinator.deferIfRunning('ses_123');
  
  // Simulate terminal state notification from board
  board.getState.mockReturnValue('completed');
  board.isRunning.mockReturnValue(false);
  
  // Trigger handleTerminalState via board's listener callback
  const boardListener = board.addTerminalStateListener.mock.calls[0]?.[0];
  boardListener?.('ses_123');
  
  expect(listener).toHaveBeenCalledWith('ses_123');
});
```

- [ ] **Step 8: Test handleTerminalState does not notify when retryDeferredClose returns false**

```typescript
test('handleTerminalState does not notify when not in deferred set', () => {
  const board = createMockBoard(false);
  const coordinator = new BackgroundJobCoordinator(board);
  const listener = mock(() => {});
  
  coordinator.addTerminalStateListener(listener);
  
  // Simulate terminal state notification without deferring first
  board.getState.mockReturnValue('completed');
  const boardListener = board.addTerminalStateListener.mock.calls[0]?.[0];
  boardListener?.('ses_123');
  
  expect(listener).not.toHaveBeenCalled();
});
```

- [ ] **Step 9: Run tests**

Run: `bun test src/utils/background-job-coordinator.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/utils/background-job-coordinator.test.ts
git commit -m "test: add BackgroundJobCoordinator lifecycle tests"
```

---

### Task 4: Update BackgroundJobBoard to satisfy interface

**Files:**
- Modify: `src/utils/background-job-board.ts`

**Interfaces:**
- Consumes: `BackgroundJobStore` interface (Task 1)
- Produces: Implemented stubs

- [ ] **Step 1: Add stub implementations to BackgroundJobBoard**

```typescript
// In src/utils/background-job-board.ts, add methods:

  /**
   * Stub: lifecycle policy is owned by BackgroundJobCoordinator.
   * Returns false (safe default: don't close) if accidentally called.
   */
  deferIfRunning(_sessionId: string): boolean {
    log('[background-job-board] WARN: deferIfRunning called on board, not coordinator');
    return false;  // ponytail: safe default - don't close
  }

  /**
   * Stub: lifecycle policy is owned by BackgroundJobCoordinator.
   * Returns false (don't close) if accidentally called.
   */
  retryDeferredClose(_sessionId: string): boolean {
    log('[background-job-board] WARN: retryDeferredClose called on board, not coordinator');
    return false;
  }

  /**
   * Stub: lifecycle policy is owned by BackgroundJobCoordinator.
   */
  clearDeferredClose(_sessionId: string): void {
    log('[background-job-board] WARN: clearDeferredClose called on board, not coordinator');
  }
```

- [ ] **Step 2: Add log import if not present**

```typescript
// In src/utils/background-job-board.ts, check if log is imported.
// If not, add:
import { log } from './logger';
```

- [ ] **Step 3: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/utils/background-job-board.ts
git commit -m "feat: add stub lifecycle methods to BackgroundJobBoard"
```

---

### Task 5: Update MultiplexerSessionManager to use coordinator

**Files:**
- Modify: `src/multiplexer/session-manager.ts`

**Interfaces:**
- Consumes: `BackgroundJobReader` with `deferIfRunning()`, `clearDeferredClose()`
- Produces: Simplified `closeSession()` that queries coordinator

- [ ] **Step 1: Update BackgroundJobReader interface**

```typescript
// In src/multiplexer/session-manager.ts, update interface:

interface BackgroundJobReader {
  getState(sessionId: string): BackgroundJobState | undefined;
  isRunning(sessionId: string): boolean;
  deferIfRunning(sessionId: string): boolean;
  clearDeferredClose(sessionId: string): void;
}
```

- [ ] **Step 2: Remove deferredIdleCloses from SharedSessionState**

```typescript
// In src/multiplexer/session-manager.ts, remove from SharedSessionState interface:

  // deferredIdleCloses: Set<string>;  // DELETE THIS LINE
```

- [ ] **Step 3: Remove deferredIdleCloses from getSharedState and resetMultiplexerSessionManagerState**

```typescript
// In getSharedState(), remove:
  // deferredIdleCloses: new Set(),  // DELETE THIS LINE

// In resetMultiplexerSessionManagerState(), remove:
  // state.deferredIdleCloses.clear();  // DELETE THIS LINE
```

- [ ] **Step 4: Remove deferredIdleCloses from class properties**

```typescript
// In MultiplexerSessionManager class, remove:
  // private deferredIdleCloses: SharedSessionState['deferredIdleCloses'];  // DELETE THIS LINE

// In constructor, remove:
  // this.deferredIdleCloses = sharedState.deferredIdleCloses;  // DELETE THIS LINE
```

- [ ] **Step 5: Update closeSession deleted block**

```typescript
// In closeSession method, replace the deleted block (lines 420-423):

// OLD:
    if (reason === 'deleted') {
      this.knownSessions.delete(sessionId);
      this.deferredIdleCloses.delete(sessionId);
    }

// NEW:
    if (reason === 'deleted') {
      this.knownSessions.delete(sessionId);
      this.backgroundJobBoard?.clearDeferredClose(sessionId);
    }
```

- [ ] **Step 6: Update closeSession idle check**

```typescript
// In closeSession method, replace the isRunningBackgroundJob check:

// OLD:
    if (reason === 'idle' && this.isRunningBackgroundJob(sessionId)) {
      this.deferredIdleCloses.add(sessionId);
      log(
        '[multiplexer-session-manager] close skipped; background job running',
        {
          instanceId: this.instanceId,
          sessionId,
          paneId: tracked.paneId,
          reason,
          backgroundJobState: this.backgroundJobState(sessionId),
        },
      );
      return;
    }

    this.deferredIdleCloses.delete(sessionId);

// NEW:
    if (reason === 'idle' && !this.shouldCloseNow(sessionId)) {
      log(
        '[multiplexer-session-manager] close skipped; background job running',
        {
          instanceId: this.instanceId,
          sessionId,
          paneId: tracked.paneId,
          reason,
          backgroundJobState: this.backgroundJobState(sessionId),
        },
      );
      return;
    }
```

- [ ] **Step 7: Add shouldCloseNow helper method**

```typescript
// In MultiplexerSessionManager class, add method:

  private shouldCloseNow(sessionId: string): boolean {
    return this.backgroundJobBoard?.deferIfRunning(sessionId) ?? true;
  }
```

- [ ] **Step 8: Remove retryDeferredIdleClose method**

```typescript
// In MultiplexerSessionManager class, DELETE the retryDeferredIdleClose method:

  // async retryDeferredIdleClose(sessionId: string): Promise<void> {  // DELETE
  //   if (!this.enabled) return;  // DELETE
  //   if (!this.deferredIdleCloses.has(sessionId)) return;  // DELETE
  //   await this.closeSession(sessionId, 'idle');  // DELETE
  // }  // DELETE
```

- [ ] **Step 9: Update onSessionDeleted to clear via coordinator**

```typescript
// In onSessionDeleted method, replace:
    this.deferredIdleCloses.delete(sessionId);

// WITH:
    this.backgroundJobBoard?.clearDeferredClose(sessionId);
```

- [ ] **Step 10: Update onSessionStatus to clear via coordinator**

```typescript
// In onSessionStatus method, replace (line 293):
        this.deferredIdleCloses.delete(sessionId);

// WITH:
        this.backgroundJobBoard?.clearDeferredClose(sessionId);
```

- [ ] **Step 11: Update pollSessions to clear via coordinator**

```typescript
// In pollSessions method, replace (line 377):
          this.deferredIdleCloses.delete(sessionId);

// WITH:
          this.backgroundJobBoard?.clearDeferredClose(sessionId);
```

- [ ] **Step 12: Update respawnIfKnown to clear via coordinator**

```typescript
// In respawnIfKnown method, replace (line 589):
      this.deferredIdleCloses.delete(sessionId);

// WITH:
      this.backgroundJobBoard?.clearDeferredClose(sessionId);
```

- [ ] **Step 13: Update cleanup to clear via coordinator**

```typescript
// In cleanup method, replace (line 662):
    this.deferredIdleCloses.clear();

// WITH:
    // ponytail: deferred state lives in coordinator, not here
    // Note: coordinator has same lifetime as plugin, so no explicit cleanup needed
```

- [ ] **Step 14: Remove isRunningBackgroundJob method**

```typescript
// In MultiplexerSessionManager class, DELETE the isRunningBackgroundJob method:

  // private isRunningBackgroundJob(sessionId: string): boolean {  // DELETE
  //   return this.backgroundJobBoard?.isRunning(sessionId) ?? false;  // DELETE
  // }  // DELETE
```

- [ ] **Step 15: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 16: Commit**

```bash
git add src/multiplexer/session-manager.ts
git commit -m "feat: multiplexer queries coordinator for close decisions"
```

---

### Task 6: Update index.ts wiring

**Files:**
- Modify: `src/index.ts`

**Interfaces:**
- Consumes: Coordinator with `addTerminalStateListener`, MultiplexerSessionManager with `closeSession`

- [ ] **Step 1: Update terminalStateListener to call closeSession directly**

```typescript
// In src/index.ts, replace:

    backgroundJobCoordinator.addTerminalStateListener((taskID) => {
      void multiplexerSessionManager.retryDeferredIdleClose(taskID);
    });

// WITH:

    backgroundJobCoordinator.addTerminalStateListener((taskID) => {
      void multiplexerSessionManager.closeSession(taskID, 'idle');
    });
```

Note: `closeSession` is private. We need to either:
- (a) Make it public, or
- (b) Add a public `closeSessionFromCoordinator(taskID: string)` method, or
- (c) Keep the subscription in index.ts but call a new public method

Option (b) is cleanest:

```typescript
// In MultiplexerSessionManager, add method:

  async closeSessionFromCoordinator(taskID: string): Promise<void> {
    if (!this.enabled) return;
    await this.closeSession(taskID, 'idle');
  }
```

Then in index.ts:

```typescript
    backgroundJobCoordinator.addTerminalStateListener((taskID) => {
      void multiplexerSessionManager.closeSessionFromCoordinator(taskID);
    });
```

- [ ] **Step 2: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/index.ts src/multiplexer/session-manager.ts
git commit -m "feat: update wiring to use coordinator lifecycle"
```

---

### Task 7: Update tests

**Files:**
- Modify: `src/multiplexer/session-manager.test.ts`

**Interfaces:**
- Consumes: Updated MultiplexerSessionManager API

- [ ] **Step 1: Update test setup to use BackgroundJobReader mock**

```typescript
// In session-manager.test.ts, add mock:

const mockBackgroundJobBoard = {
  isRunning: mock(() => false),
  getState: mock(() => undefined),
  deferIfRunning: mock(() => true),
  retryDeferredClose: mock(() => false),
  clearDeferredClose: mock(() => {}),
};
```

- [ ] **Step 2: Run tests**

Run: `bun test src/multiplexer/session-manager.test.ts`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/multiplexer/session-manager.test.ts
git commit -m "test: update session manager tests for coordinator lifecycle"
```

---

### Task 8: Run full test suite and verify

**Files:** None (verification only)

- [ ] **Step 1: Run typecheck**

Run: `bun run typecheck`
Expected: PASS

- [ ] **Step 2: Run linter**

Run: `bun run check:ci`
Expected: PASS

- [ ] **Step 3: Run full test suite**

Run: `bun test`
Expected: PASS (1367+ tests)

- [ ] **Step 4: Build**

Run: `bun run build`
Expected: PASS

---

### Task 9: Final commit and push

- [ ] **Step 1: Stage all changes**

```bash
git add -A
```

- [ ] **Step 2: Commit**

```bash
git commit -m "feat: centralize lifecycle policy in BackgroundJobCoordinator

- Move deferredIdleCloses tracking from multiplexer to coordinator
- Coordinator owns deferIfRunning(), retryDeferredClose(), clearDeferredClose()
- Multiplexer queries coordinator before closing panes
- Subscription wiring stays in index.ts (avoids multi-instance issues)
- Type-level single-writer contract via BackgroundJobStore interface
- Board stubs return safe defaults (false) if called directly
- Added coordinator lifecycle tests

Closes #677"
```

- [ ] **Step 3: Push**

```bash
git push origin feature/background-job-coordinator
```
