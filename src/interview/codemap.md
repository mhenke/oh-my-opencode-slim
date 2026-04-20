# src/interview/

## Responsibility

- Implement the `/interview` command feature end-to-end: parsing user invocation, building assistant prompts, tracking interview state, persisting markdown artifacts, and serving a local web UI.
- Coordinate two execution modes: per-session self-hosted interview server (default) and shared dashboard mode for multi-process concurrency.
- Keep interview lifecycle state synchronized between local markdown files, in-memory records, and dashboard caches for resumable/spec-recovery flows.

## Design

- `manager.ts` is the interview composition root and exposes a narrow adapter contract:
  - `registerCommand`
  - `handleCommandExecuteBefore`
  - `handleEvent`
- `manager.ts` decides runtime mode and wires a `createInterviewService(ctx, interviewConfig)` instance with one of:
  - `createInterviewServer` (private per-process server), or
  - dashboard orchestration via `tryBecomeDashboard`, `probeDashboard`, `readDashboardAuthFile`, and periodic dashboard fallback polling.
- `service.ts` owns interview domain state and business rules:
  - `interviewsById`, `activeInterviewIds`, `sessionBusy`
  - `handleCommandExecuteBefore` for `/interview` handling
  - `submitAnswers` and `handleNudgeAction` to inject internal prompts via `session.promptAsync`
  - `getInterviewState`, `listInterviewFiles`, and `listInterviews`.
- `document.ts` handles filesystem layout and transformation primitives: `createInterviewFilePath`, `resolveExistingInterviewPath`, `ensureInterviewFile`, `rewriteInterviewDocument`, `appendInterviewAnswers`, `readInterviewDocument`.
- `parser.ts` validates structured agent output from `<interview_state>` blocks using `parseAssistantState` and `findLatestAssistantState` with `zod` schemas from `types.ts`.
- `server.ts` exposes HTTP endpoints for dashboard and interview UI with typed handlers in `helpers.ts`.
- `ui.ts` renders HTML views (`renderDashboardPage`, `renderInterviewPage`) for `/` and `/interview/{id}`.
- `dashboard.ts` implements shared interview registry/auth and recovery mechanics (`createDashboardServer`, token auth, file rescan/rebuild, pending answers/nudges).
- `prompts.ts` provides structured prompts for kickoff/resume/answer flows.
- `types.ts` defines transport and domain contracts (`InterviewRecord`, `InterviewState`, `InterviewStateEntry`, schemas `RawInterviewStateSchema` / `RawQuestionSchema`).

## Flow

- `src/index.ts` initializes interview support via `createInterviewManager(ctx, config)`.
- `manager.ts` computes effective port and dashboard flag (`interview.dashboard` / `interview.port > 0`) and selects mode:
  - **Per-session**: instantiate `createInterviewService` + `createInterviewServer` on port `0`.
  - **Dashboard**: attempt leadership with `tryBecomeDashboard`.
- In dashboard leader mode:
  - push state changes through local callback `setStatePushCallback`
  - register created interviews and sessions into dashboard cache
  - expose auth + scan discovery + file rehydration.
- In dashboard client mode:
  - resolve dashboard base URL and token
  - register current process as session with `/api/register`
  - deliver state via `pushStateViaHttp` / `/api/interviews/{id}/state`
  - periodically poll `/api/interviews/{id}/pending` and `/api/interviews/{id}/nudge`.
- `service.handleCommandExecuteBefore`:
  - if no idea and no active interview -> ask for one
  - if idea matches file slug -> `resumeInterview`
  - else -> `createInterview` and inject kickoff/resume prompts.
- `service.syncInterview` loads session messages, extracts latest valid assistant state, rewrites interview markdown, computes `InterviewState.mode`, and invokes state callbacks.
- `handleEvent` listens for `session.status`/`session.deleted` to update busy flags, consume pending UI actions, refresh state, and mark interviews abandoned on session delete.
- `server.ts` route flow:
  - `/` and `/api/interviews` render list state
  - `/interview/:id` renders interview UI
  - `/api/interviews/:id/state` returns JSON state
  - POST `/api/interviews/:id/answers` validates payload and forwards to `submitAnswers`
  - POST `/api/interviews/:id/nudge` forwards action to `handleNudgeAction`.

## Integration

- Consumed by plugin bootstrap in `src/index.ts`; command pre-hook and event dispatch invoke the manager methods returned by `createInterviewManager`.
- Integrated with OpenCode session API via `PluginInput.client.session` for message reads/prompt injection.
- Exposed to users through local HTTP UI endpoints from whichever active server instance is running.
- Used by tests in `interview/*.test.ts` for command mode transitions, server behavior, parsing, and command registration.
