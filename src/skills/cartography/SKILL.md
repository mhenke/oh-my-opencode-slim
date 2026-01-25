---
name: cartography
description: Repository understanding and hierarchical codemap generation
---

# Cartography Skill

You help users understand and map repositories by creating hierarchical codemaps.

## When to Use

- User asks to understand/map a repository
- User wants codebase documentation
- Starting work on an unfamiliar codebase

## Workflow

### Step 1: Check for Existing State

**First, check if `.slim/cartography.json` exists in the repo root.**

If it **exists**: Skip to Step 3 (Detect Changes) - no need to re-initialize.

If it **doesn't exist**: Continue to Step 2 (Initialize).

### Step 2: Initialize (Only if no state exists)

1. **Analyze the repository structure** - List files, understand directories
2. **Infer patterns** for **core code/config files ONLY** to include:
   - **Include**: `src/**/*.ts`, `package.json`, etc.
   - **Exclude (MANDATORY)**: Do NOT include tests, documentation, or translations.
     - Tests: `**/*.test.ts`, `**/*.spec.ts`, `tests/**`, `__tests__/**`
     - Docs: `docs/**`, `*.md` (except root `README.md` if needed), `LICENSE`
     - Build/Deps: `node_modules/**`, `dist/**`, `build/**`, `*.min.js`
   - Respect `.gitignore` automatically
3. **Run cartographer.py init**:

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py init \
  --root /path/to/repo \
  --include "src/**/*.ts" \
  --exclude "**/*.test.ts" --exclude "dist/**" --exclude "node_modules/**"
```

This creates:
- `.slim/cartography.json` - File and folder hashes for change detection
- Empty `codemap.md` files in all relevant subdirectories

4. **Delegate to Explorer agents** - Spawn one explorer per folder to read code and fill in its specific `codemap.md` file.

### Step 3: Detect Changes (If state already exists)

1. **Run cartographer.py changes** to see what changed:

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py changes \
  --root /path/to/repo
```

2. **Review the output** - It shows:
   - Added files
   - Removed files
   - Modified files
   - Affected folders

3. **Only update affected codemaps** - Spawn one explorer per affected folder to update its `codemap.md`.
4. **Run update** to save new state:

```bash
python3 ~/.config/opencode/skills/cartography/scripts/cartographer.py update \
  --root /path/to/repo
```

## Codemap Content

Explorers should write **timeless architectural understanding**, not exact details that get stale:

- **Responsibility** - What is this folder's job in the system?
- **Design** - Key patterns, abstractions, architectural decisions
- **Flow** - How does data/control flow through this module?
- **Integration** - How does it connect to other parts of the system?

Example codemap:

```markdown
# src/agents/

## Responsibility
Defines agent personalities and manages their configuration lifecycle.

## Design
Each agent is a prompt + permission set. Config system uses:
- Default prompts (orchestrator.ts, explorer.ts, etc.)
- User overrides from ~/.config/opencode/oh-my-opencode-slim.json
- Permission wildcards for skill/MCP access control

## Flow
1. Plugin loads → calls getAgentConfigs()
2. Reads user config preset
3. Merges defaults with overrides
4. Applies permission rules (wildcard expansion)
5. Returns agent configs to OpenCode

## Integration
- Consumed by: Main plugin (src/index.ts)
- Depends on: Config loader, skills registry
```
