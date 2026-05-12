# Tools & Capabilities

Built-in tools available to agents beyond the standard file and shell operations.

## apply_patch rescue

Slim only intercepts `apply_patch` before the native tool runs. It rewrites recoverable stale patches, canonizes safe tolerant matches against the real file when unicode/trim drift is the only mismatch, keeps the authored `new_lines` bytes intact, preserves the existing file EOL/final-newline state for updates, validates malformed patches strictly before helper execution, uses a conservative bounded LCS fallback, accumulates helper state when the same path appears in multiple `Update File` hunks, blocks `apply_patch` before native execution if any patch path falls outside the allowed root/worktree, and fails on ambiguity instead of guessing. It does not rewrite `edit` or `write` inputs.

---

## Web Fetch

Fetch remote pages with content extraction tuned for docs/static sites.

| Tool | Description |
|------|-------------|
| `webfetch` | Fetch a URL, optionally prefer `llms.txt`, extract main content from HTML, include metadata, and optionally save binary responses |

`webfetch` blocks cross-origin redirects unless the requested URL or derived permission patterns explicitly allow them, and it can fall back to the raw fetched content when secondary-model summarization is unavailable.

---

## Code Search Tools

Fast, structural code search and refactoring — more powerful than plain text grep.

| Tool | Description |
|------|-------------|
| `grep` | Fast content search using ripgrep |
| `ast_grep_search` | AST-aware code pattern matching across 25 languages |
| `ast_grep_replace` | AST-aware code refactoring with dry-run support |

`ast_grep` understands code structure, so it can find patterns like "all arrow functions that return a JSX element" rather than relying on exact text matching.

---

## Session Subtask

Run a boomerang-style worker session and return its summary to the caller.

| Command / Tool | Description |
|----------------|-------------|
| `/subtask <goal>` | Ask the current agent to run a focused child worker for the requested goal |
| `subtask` | Runs a child subtask worker session and returns its summary to the caller |
| `read_session` | Reads transcript details from the source session when the subtask summary is missing specifics |

Subtask prompts include `@file` references. Slim creates a real child session
with the current session as `parentID`, lets the subtask worker read the provided
context and files, then returns the worker's `<subtask_summary>` back to the
main session as normal tool output. In tmux/zellij this appears like other child
agent work: a pane can open for the worker and close when the summary returns.

See [Subtask](subtask.md) for the full workflow.

---

## Formatters

OpenCode automatically formats files after they are written or edited, using language-specific formatters. No manual step needed.

Includes Prettier, Biome, `gofmt`, `rustfmt`, `ruff`, and 20+ others.

> See the [official OpenCode docs](https://opencode.ai/docs/formatters/#built-in) for the complete list.

---

## Todo Continuation

Auto-continue has its own guide now:

- [Todo Continuation](todo-continuation.md) — controls, safety gates, behavior, and config
