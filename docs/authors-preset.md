# Author's Preset

This is the exact configuration the author runs day-to-day.

---

## Skill Reference

Each skill is listed with a short description. The config block above shows which agent uses it. These are the author's own third party skills and are not part of the plugin.

| Skill | Description |
| --- | --- |
| `*` (excl. `!make-interfaces-feel-better`) | All installed skills except those explicitly excluded |
| `better-icons` | Icon design |
| `ce-brainstorm` | Brainstorming workflow |
| `codegraph` | (MCP) code graph navigation |
| `context7` | (MCP) library docs lookup |
| `crawl4ai` | (MCP) web crawling |
| `customer-research` | Customer research |
| `gh_app` | (MCP) GitHub app access |
| `image` | Image generation/editing |
| `make-interfaces-feel-better` | UI/UX polish |
| `marketing-psychology` | Marketing psychology |
| `motion` | Animation/motion design |
| `nuxt` | Nuxt framework |
| `pnpm` | pnpm package manager |
| `searxng` | (MCP) metasearch engine |
| `tsdown` | tsdown bundler |
| `video` | Video generation/editing |
| `vitest` | Vitest test runner |
| `vite` | Vite build tool |
| `vue` | Vue framework |
| `web-perf` | Web performance optimization |
| `websearch` | (MCP) web search |
| `workers-best-practices` | Worker best practices |

## The Config

```jsonc
{
  "$schema": "https://unpkg.com/oh-my-opencode-slim@latest/oh-my-opencode-slim.schema.json",
  "preset": "openai",
  "showStartupToast": false,
  "companion": {
    "enabled": true,
    "position": "bottom-left",
    "size": "small"
  },
  "presets": {
    "openai": {
      "orchestrator": {
        "model": "openai/gpt-5.5-fast",
        "skills": [
          "*",
          "!make-interfaces-feel-better"
        ],
        "mcps": [
          "*",
          "!context7",
          "!gh_app",
          "!websearch"
        ]
      },
      "oracle": {
        "model": "openai/gpt-5.5-fast",
        "variant": "high",
        "skills": [
          "ce-brainstorm",
          "workers-best-practices",
          "web-perf"
        ],
        "mcps": [
          "codegraph",
          "searxng",
          "crawl4ai"
        ]
      },
      "librarian": {
        "model": "openai/gpt-5.3-codex-spark",
        "variant": "low",
        "skills": [
          "customer-research"
        ],
        "mcps": [
          "websearch",
          "context7",
          "gh_app",
          "searxng",
          "crawl4ai"
        ]
      },
      "explorer": {
        "model": "openai/gpt-5.3-codex-spark",
        "variant": "low",
        "skills": [],
        "mcps": [
          "codegraph"
        ]
      },
      "designer": {
        "model": "omniroute/antigravity/gemini-3-flash-agent",
        "skills": [
          "make-interfaces-feel-better",
          "better-icons",
          "vue",
          "nuxt",
          "motion",
          "image",
          "marketing-psychology",
          "video"
        ],
        "mcps": [
          "codegraph"
        ]
      },
      "fixer": {
        "model": "omniroute/antigravity/gemini-3-flash-agent",
        "variant": "low",
        "skills": [
          "vitest",
          "pnpm",
          "vite",
          "tsdown"
        ],
        "mcps": [
          "codegraph",
          "searxng",
          "crawl4ai"
        ]
      }
    }
  },
  "agents": {
    "fast-generic": {
      "model": "openai/gpt-5.3-codex-spark",
      "variant": "low",
      "prompt": "You are a fast generic execution agent for routine mechanical command work. Run requested shell commands, inspect results, and report concise outcomes. For git commits or pushes, inspect git status, git diff, and recent log first; stage only intended files; avoid secrets; preserve repository commit-message style; never amend, rebase, reset --hard, clean, force-push, delete branches, or perform destructive history operations unless the user explicitly requested that exact operation. Do not edit code or make architecture/design decisions.",
      "orchestratorPrompt": "Delegate to @fast-generic for routine mechanical command work: git status/diff/log reconnaissance, normal commit preparation, creating commits, pushing commits, and no-edit command validation such as lint, typecheck, static verification, tests, builds, or package-manager equivalents. Ask it to inspect diffs before committing, stage only intended files, avoid secrets, preserve repository commit-message style, and report final commit hashes or push results. Do not use it for code edits, design work, architecture, debugging strategy, docs research, or destructive git history operations such as amend, rebase, reset --hard, clean, force-push, or deleting branches unless the user explicitly requested that exact operation.",
      "skills": [],
      "mcps": []
    }
  },
  "tmux": {
    "enabled": true,
    "layout": "main-vertical",
    "main_pane_size": 60
  }
}

```
