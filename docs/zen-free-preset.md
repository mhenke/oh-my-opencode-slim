# Zen Free Preset

This preset is for users who want a completely free setup using **OpenCode Zen** (opencode/) free models — $0/month.

It uses deepseek-v4-flash-free for high-volume coding tasks and big-pickle for deep reasoning on architecture and review decisions.

---

## The Config

```jsonc
{
  "$schema": "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json",
  "preset": "opencode-zen-free",
  "presets": {
    "opencode-zen-free": {
      "orchestrator": { "model": "opencode/mimo-v2.5-free", "temperature": 0.4, "skills": ["*"], "mcps": ["*", "!context7"] },
      "oracle": { "model": "opencode/big-pickle", "temperature": 0.4, "variant": "max", "skills": ["simplify"], "mcps": [] },
      "explorer": { "model": "opencode/deepseek-v4-flash-free", "temperature": 0.2, "skills": [], "mcps": [] },
      "librarian": { "model": "opencode/deepseek-v4-flash-free", "temperature": 0.2, "skills": [], "mcps": ["websearch", "context7", "gh_grep"] },
      "designer": { "model": "opencode/mimo-v2.5-free", "temperature": 0.3, "variant": "medium", "skills": [], "mcps": [] },
      "fixer": { "model": "opencode/deepseek-v4-flash-free", "temperature": 0.2, "variant": "high", "skills": [], "mcps": [] },
      "observer": { "model": "opencode/north-mini-code-free", "temperature": 0.2, "variant": "low", "skills": [], "mcps": [] }
    }
  }
}
```

## Models Used

| Agent | Model | Why |
|-------|-------|-----|
| Orchestrator | mimo-v2.5-free | Best planner |
| Oracle | big-pickle (max) | Deep reasoning/review |
| Explorer | deepseek-v4-flash-free | High-volume file search, grep, repo exploration |
| Librarian | deepseek-v4-flash-free | Documentation lookup and summarization don't require MiMo's planning strength |
| Designer | mimo-v2.5-free | Better for higher-level UI structure and planning |
| Fixer | deepseek-v4-flash-free | Excellent for iterative implementation |
| Observer | north-mini-code-free | Visual analysis |

## Available Free Models

- `opencode/mimo-v2.5-free` — well-rounded, good for most tasks
- `opencode/deepseek-v4-flash-free` — strong coding focus
- `opencode/big-pickle` — deep reasoning
- `opencode/nemotron-3-ultra-free` — alternative
- `opencode/north-mini-code-free` — code-focused