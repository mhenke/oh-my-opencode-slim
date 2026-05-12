# Subtask

`/subtask` starts a boomerang-style worker session for the user’s requested
goal, then returns a compact completion summary to the original session.

## Usage

```text
/subtask <what the worker should do>
```

The command asks the current orchestrator to call `subtask` with the
worker prompt and any clearly relevant files.

## Flow

1. The main session calls `subtask`.
2. Slim creates a real child session with `parentID` set to the main session.
3. The child runs as `orchestrator`, so it can use the normal specialist-agent
   workflow and delegate through `task` when useful.
4. Referenced files are loaded into the child as synthetic Read-tool context.
5. When the child finishes, Slim extracts its assistant output and returns it to
   the main session inside `<subtask_summary>`.
6. The child session is aborted for cleanup after the summary is extracted.

In tmux or zellij, the child appears like other delegated work because it is a
real child session. Existing session-depth and pane cleanup handling apply.

## What to put in the prompt

The user prompt controls scope. Keep it direct:

```text
/subtask finish the docs for subtask and run the relevant checks
/subtask investigate the flaky auth test and report what changed
/subtask implement the small UI polish we discussed
```

The subtask prompt intentionally avoids prescribing extra actions. It should do
what the user asks, then summarize what happened, files changed, validation run,
and any remaining risks or follow-up.

## Tools

| Tool | Purpose |
|------|---------|
| `subtask` | Creates the child worker session and returns its summary |
| `read_session` | Lets a subtask worker read details from the parent/source session |

## Safety

- Nested subtasks are blocked: a subtask worker should finish its current task
  and return a summary instead of spawning another subtask worker.
- File context is restricted to the workspace real path, including symlink
  checks.
- Binary files are skipped.
- Large files are capped before being injected as context.
- Child sessions use normal OpenCode session lifecycle events, so multiplexer
  cleanup remains consistent with other delegated agents.
