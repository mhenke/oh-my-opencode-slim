# OpenCode Zen Free

A completely free preset using only **OpenCode Zen** (opencode/) free models — $0/month.

---

## The Config

```jsonc
{
  "$schema": "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json",
  "preset": "opencode-zen-free",
  "presets": {
    "opencode-zen-free": {
      "orchestrator": { "model": "opencode/mimo-v2.5-free", "temperature": 0.4, "skills": ["*"], "mcps": ["*", "!context7"] },
      "oracle": { "model": "opencode/deepseek-v4-flash-free", "temperature": 0.4, "variant": "max", "skills": ["simplify"], "mcps": [] },
      "council": { "model": "opencode/mimo-v2.5-free", "temperature": 0.4, "variant": "high", "skills": [], "mcps": [] },
      "librarian": { "model": "opencode/mimo-v2.5-free", "temperature": 0.2, "skills": [], "mcps": ["websearch", "context7", "gh_grep"] },
      "explorer": { "model": "opencode/mimo-v2.5-free", "temperature": 0.2, "skills": [], "mcps": [] },
      "designer": { "model": "opencode/mimo-v2.5-free", "temperature": 0.3, "variant": "medium", "skills": [], "mcps": [] },
      "fixer": { "model": "opencode/deepseek-v4-flash-free", "temperature": 0.2, "variant": "high", "skills": [], "mcps": [] },
      "observer": { "model": "opencode/mimo-v2.5-free", "temperature": 0.2, "variant": "low", "skills": [], "mcps": [] }
    }
  }
}
```

## Models Used

| Agent | Model | Purpose |
|-------|-------|---------|
| Orchestrator | mimo-v2.5-free | Planning & delegation |
| Oracle | deepseek-v4-flash-free (max) | Architecture & review |
| Council | mimo-v2.5-free (high) | Multi-LLM consensus |
| Librarian | mimo-v2.5-free | Documentation lookup |
| Explorer | mimo-v2.5-free | Codebase scouting |
| Designer | mimo-v2.5-free (medium) | UI/UX work |
| Fixer | deepseek-v4-flash-free (high) | Implementation |
| Observer | mimo-v2.5-free (low) | Visual analysis |

## Available Free Models

- `opencode/mimo-v2.5-free` — well-rounded, good for most tasks
- `opencode/deepseek-v4-flash-free` — strong coding focus
- `opencode/nemotron-3-ultra-free` — alternative
- `opencode/north-mini-code-free` — code-focused