# src/hooks/todo-continuation/

## Responsibility

Automatically continue orchestrator work when open todos remain, while enforcing
multiple safeguards (question suppression, cooldown, explicit abort handling) to
avoid runaway automation.

## Design

- `createTodoContinuationHook(ctx, config?)` in `index.ts` is the public
  factory and returns the complete hook contract: command, tool, message,
  system-transform, and event handlers.
- Internal state is tracked by `ContinuationState` (per-session timers, session
  tracking, suppression windows, request signatures, and auto-injection flags).
- `todo-hygiene.ts` is extracted as a dedicated reminder state machine with
  reasons: `general`, `delegation_resume`, `final_active` and exposes:
  `createTodoHygiene`, `handleRequestStart`, `handleToolExecuteAfter`,
  `handleChatSystemTransform`, and `handleEvent`.
- Message analysis is implemented in `handleMessagesTransform` with helpers like
  `getLastExternalUserMessage`, `isExternalUserMessage`, and `inferSessionID`,
  and ignores internal markers via `SLIM_INTERNAL_INITIATOR_MARKER`.
- Continuation prompt string uses `CONTINUATION_PROMPT`; reminder strings come
  from `TODO_HYGIENE_REMINDER`, `TODO_DELEGATION_RESUME_REMINDER`,
  `TODO_FINAL_ACTIVE_REMINDER`.

## Flow

### Auto-continuation

1. `handleMessagesTransform` identifies the latest external user message and
   request boundary signature, then calls `hygiene.handleRequestStart`.
2. `handleCommandExecuteBefore` processes `command === 'auto_continue'` and
   toggles auto-continuation with `enabled` on/off.
3. `handleToolExecuteAfter` records request context and may queue a continuation
   prompt using `ctx.client.session.prompt`.
4. `handleChatSystemTransform` injects only one continuation reminder per request
   round when guards pass.
5. `handleEvent` and `handleChatMessage` update session registries and clear stale
   state on `session.deleted` / new boundaries.

### Todo hygiene

1. `createTodoHygiene.handleToolExecuteAfter` observes post-tool activity to
   arm reminders based on todo state transitions.
2. `createTodoHygiene.handleChatSystemTransform` injects one reminder into
   `output.system` if open todos remain and session is still injectable.
3. Reminder priorities resolve deterministically, with `final_active` overriding
   other reasons.
4. Session deletion clears pending states through `clear()`/`clearCycle()`.

## Integration

- Imported from `src/hooks/index.ts` and wired in `src/index.ts`.
- Relies on OpenCode APIs on `ctx.client.session` (`todo`, `messages`, `prompt`).
- Uses utility helpers from `../../utils` (`log`, `createInternalAgentTextPart`,
  `SLIM_INTERNAL_INITIATOR_MARKER`) and config via hook options
  (`maxContinuations`, `cooldownMs`, `autoEnable`, `autoEnableThreshold`).
