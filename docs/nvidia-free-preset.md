# NVIDIA Free Preset

This preset is for users who want a completely free setup using **NVIDIA NIM** (nvidia/) free models — $0/month.

It uses step-3.5-flash for high-volume coding tasks and deepseek-v4-pro for deep reasoning on architecture and review decisions.

---

## The Config

```jsonc
{
  "$schema": "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json",
  "preset": "nvidia-free",
  "presets": {
    "nvidia-free": {
      "orchestrator": { "model": "nvidia/minimaxai/minimax-m2.7", "temperature": 0.4, "skills": ["*"], "mcps": ["*", "!context7"] },
      "oracle": { "model": "nvidia/deepseek-ai/deepseek-v4-pro", "temperature": 0.4, "variant": "max", "skills": ["simplify"], "mcps": [] },
      "explorer": { "model": "nvidia/stepfun-ai/step-3.5-flash", "temperature": 0.2, "skills": [], "mcps": [] },
      "librarian": { "model": "nvidia/moonshotai/kimi-k2.6", "temperature": 0.2, "skills": [], "mcps": ["websearch", "context7", "gh_grep"] },
      "designer": { "model": "nvidia/minimaxai/minimax-m3", "temperature": 0.3, "variant": "medium", "skills": [], "mcps": [] },
      "fixer": { "model": "nvidia/mistralai/mistral-small-4-119b-2603", "temperature": 0.2, "variant": "high", "skills": [], "mcps": [] },
      "observer": { "model": "nvidia/nemotron-3-ultra-550b-a55b", "temperature": 0.2, "variant": "low", "skills": [], "mcps": [] }
    }
  }
}
```

## Models Used

| Agent | Model | Why |
|-------|-------|-----|
| Orchestrator | MiniMax M2.7 | Best planner |
| Oracle | DeepSeek V4 Pro (max) | Deep reasoning/review |
| Explorer | Step 3.5 Flash | High-context directory mapping, less-crowded endpoint |
| Librarian | Kimi K2.6 | Documentation lookup and summarization |
| Designer | MiniMax M3 (medium) | Better for higher-level UI structure and planning |
| Fixer | Mistral Small 4 (high) | Extremely fast and obedient for iterative code edits and diff application |
| Observer | Nemotron 3 Ultra 550B (low) | Visual analysis |

## Available Free Models

- `nvidia/minimaxai/minimax-m2.7` — well-rounded planner
- `nvidia/deepseek-ai/deepseek-v4-pro` — deep reasoning
- `nvidia/stepfun-ai/step-3.5-flash` — fast directory mapping and code exploration
- `nvidia/moonshotai/kimi-k2.6` — good for research and summarization
- `nvidia/minimaxai/minimax-m3` — UI/UX and design
- `nvidia/mistralai/mistral-small-4-119b-2603` — extremely fast and obedient for iterative code edits and diff application
- `nvidia/nemotron-3-ultra-550b-a55b` — visual analysis
