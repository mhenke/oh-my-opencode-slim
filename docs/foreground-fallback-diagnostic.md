# Foreground Fallback Diagnostic

## Background

`ForegroundFallbackManager` (`src/hooks/foreground-fallback/index.ts`) detects rate-limit
errors from OpenCode plugin events (`session.error`, `session.status`, `message.updated`)
and switches to the next model in the agent's configured fallback chain.

## Problem

The OpenCode proxy returns **"Monthly usage limit reached"** for all models going through
it. The fallback should catch this and switch models, but on a fresh session it doesn't
trigger.

Two hypotheses:
- **A:** The proxy-level monthly limit error never produces a plugin event (OpenCode
  handles it before session creation — the plugin never sees it)
- **B:** The event arrives but in a shape the handler doesn't match

Also: **subagent sessions** (explorer, librarian, fixer) show zero
`[foreground-fallback]` log entries — their errors don't reach the handler either.

## What was done

Branch: `fix/foreground-fallback-diagnostic`

Minimal diagnostic logging added. No behavioral changes.

### Changes (1 file, +61 lines)

1. **`extractErrorPreview()`** — extracts an error string from any event shape:
   - `session.error` → `properties.error`
   - `message.updated` → `properties.info.error`
   - `session.status` → `properties.status.message`

2. **`handleEvent()` diagnostic** — logs EVERY event reaching the handler BEFORE the
   switch statement with `{ type, sessionID, error }`. This is the key: it captures
   events that fall through unhandled.

3. **`tryFallback()` diagnostic** — logs entry with `{ sessionID, inProgress, dedupMs }`
   BEFORE any early-return guards, so we can tell if fallback is entered vs filtered.

### Also included (pre-existing source fixes now in build)

The stale dist was missing these source changes — the fresh build includes them:

- **Chain reset/recovery branch:** When all models in the chain have been tried, resets
  the tried set and retries the last model instead of giving up permanently
- **Monthly/5-hour/weekly usage limit patterns:** Added to `isRateLimitError()` for
  broader detection
- **`isUserMessageWithParts()` guard:** Prevents crash when messages have undefined
  `info` (OpenCode sometimes returns partial/streaming messages)
- **Subagent `currentModel` inference:** Infers current model as `chain[0]` when agent
  name is known but no model was captured yet

## How to test

1. Check out the branch
2. Build: `bun run build`
3. Deploy locally (point `opencode.jsonc` plugin to local path)
4. Restart OpenCode
5. Trigger the monthly usage limit
6. Check the plugin log

## Reading the logs

Plugin log location: `~/.local/share/opencode/log/oh-my-opencode-slim.*.log`

| Log pattern | What it means |
|---|---|
| `[foreground-fallback] event { type: "...", sessionID: "...", error: "..." }` | Event arrived at the handler. Shows event type, session ID, and any error message. |
| `[foreground-fallback] tryFallback { sessionID: "...", inProgress: false, ... }` | Fallback procedure was entered (rate-limit signal was recognized). |
| `[foreground-fallback] resetting tried set for re-fallback` | Chain was exhausted, resetting to try last model again (recovery kicking in). |
| `[foreground-fallback] switched to fallback model { from: "...", to: "..." }` | Fallback worked — model was switched. |
| No `event` log at all when monthly limit fires | **Hypothesis A confirmed** — plugin never sees the error |
| `event` log appears but NO `tryFallback` | Event hits a handler gap (e.g., wrong status type, missing sessionID). The event log shows which type — may need to add a new case. |
| `event` + `tryFallback` but no `switched` | Some downstream failure — subsequent logs will say why (no user message, promptAsync unavailable, invalid model, etc.) |

## Next steps

Paste the relevant log lines back and we'll identify the exact breakdown point.
