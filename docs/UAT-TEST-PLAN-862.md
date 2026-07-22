# UAT Test Plan — Issue #862 (Image Routing Notifications)

> PR #877 · Branch: `omos/fix-image-routing-notifications`
> Tests validate: Bug #1 (resolution collapse), Bug #2 (validation gap), Bug #3 (silent drop), Greptile #1-#3 fixes.

## How to run

### AI tracking protocol

At the start of each test, create a todo list with one entry per step. Update statuses in real time:

```
todowrite([
  { content: "Test N — Step 1: AI writes config", status: "in_progress", priority: "high" },
  { content: "Test N — Step 2: User restarts", status: "pending", priority: "high" },
  { content: "Test N — Step 3: AI checks config", status: "pending", priority: "high" },
  { content: "Test N — Step 4: AI does the test", status: "pending", priority: "high" },
  { content: "Test N — Step 5: AI reports pass/fail", status: "pending", priority: "high" }
])
```

- Mark the current step `in_progress` when you begin it.
- Mark it `completed` when done.
- Never start the next step until the current one is `completed`.
- When all steps are `completed`, the test is done.

### Test loop

Each test follows this sequence:

1. **AI writes config** — AI updates the config file.
2. **User restarts OpenCode** — AI tells user to restart; user confirms when done.
3. **AI checks config** — AI reads config back to verify it's correct.
4. **AI does the test** — AI sends the prompt/image and reads logs for expected results.
5. **AI reports pass/fail** — AI compares actual vs expected and reports.

### Updating this doc

After each test, update this markdown file with anything the next AI should know:

- **Unexpected results** — if something failed for a surprising reason, add a note under that test.
- **Log line quirks** — if the actual log output differed from what's documented, add the real output.
- **Workarounds** — if you had to do something non-obvious to get a test to pass, note it.
- **Config gotchas** — if the config file format or location caused issues, add it.
- **User friction** — if the user was confused by a step, clarify the wording.

Append findings under a `### Notes from testing` heading within each test section. Keep it concise — one line per finding, prefixed with the date.

---

## Prerequisites

### Orchestrator model vision requirements

Only **Test 1** sends an image to the orchestrator directly (all other tests intercept before it reaches the model). A vision-capable orchestrator model is only needed for Test 1.

| Model | Vision | Notes |
|-------|--------|-------|
| `opencode/mimo-v2.5-free` | ✅ | Works. First in balanced preset chain. |
| `opencode/nemotron-3-ultra-free` | ❌ | Text only |
| `opencode-go/deepseek-v4-flash` | ❌ | Text only |
| `opencode/deepseek-v4-flash` | ❌ | Text only |

**Why only Test 1?** In Tests 2B/2C/3/4/5, observer is disabled → the observer-disabled guard fires → image is blocked → orchestrator never receives it. In Test 6, observer is enabled → auto routing intercepts → image goes to `@observer`, not orchestrator. Only Test 1 (observer disabled, `image_routing` omitted) resolves to `direct`, where images pass through untouched to the orchestrator.

### Log check command

```bash
tail -200 ~/.local/share/opencode/log/oh-my-opencode-slim.*.log \
  | grep -E "image_routing|dropped|observer|toast|intercepted" \
  | tail -20
```

**Note for AI:** The plugin log file is `~/.local/share/opencode/log/oh-my-opencode-slim.<timestamp>.log`. Use `ls -t` to find the most recent one. If the grep returns nothing, broaden search terms (try `image`, `toast`, `direct`, `auto`). For Test 1 specifically, **no image routing log lines is expected** — `direct` mode means no routing intervention, so the absence of log lines IS the evidence.

**Config note:** The config file has many existing keys (presets, agents, etc.). The test only cares about the specific keys mentioned (`disabled_agents`, `image_routing`). Don't overwrite the entire file — edit only the relevant keys.

---

## Test 1 — Bug #1: Resolution Collapse

**Validates:** `image_routing` omitted + observer disabled → resolves to `direct` (not `auto`).
**Vision needed:** Yes (image reaches orchestrator).

### Todo list for Test 1

```
- [ ] Step 1: AI writes config
- [ ] Step 2: User restarts OpenCode
- [ ] Step 3: AI checks config
- [ ] Step 4: AI sends image prompt
- [ ] Step 5: AI reports pass/fail
```

### Step 1 — AI writes config

AI writes `~/.config/opencode/oh-my-opencode-slim.jsonc`:

```jsonc
{
  "disabled_agents": ["observer"]
}
```

Mark step 1 `completed`.

### Step 2 — User restarts

Tell user: "Restart OpenCode fully (quit + reopen). Reply when ready."

Wait for user confirmation. Then mark step 2 `completed`.

### Step 3 — AI checks config

Read `~/.config/opencode/oh-my-opencode-slim.jsonc` and verify:
- `disabled_agents` contains `"observer"`
- `image_routing` is absent (should not be set)

If correct → mark step 3 `completed`. If wrong → fix config, ask user to restart again, re-verify.

### Step 4 — AI sends image prompt

Send: `[attach a small image] What do you see in this image?`

Mark step 4 `completed`.

### Step 5 — AI reports pass/fail

Read logs and check for:
- ✅ **No toast** — images pass through to orchestrator (nothing dropped).
- ✅ No `[image-routing] auto mode: intercepted` log line (proves routing resolved to `direct`).

**What "pass" looks like:** For Test 1, the log may contain ZERO image-routing lines. This is correct — `direct` mode means the hook doesn't intervene. The strongest evidence is: (1) image reached orchestrator (you can see it), (2) no toast/dropped log lines, (3) no intercepted log lines. If you see `[image-hook] dropped images` or a toast, that's a FAIL.

Report: PASS or FAIL with evidence. Mark step 5 `completed`.

### Notes from testing

- 2026-07-22: Log grep returned nothing for `direct` mode — this is correct. No routing intervention = no log lines. Evidence is absence of toast/dropped/intercepted lines + image reaching orchestrator.
- 2026-07-22: Config file has many existing keys (presets, agents, etc.). Only edit the relevant keys, don't overwrite the whole file.

---

## Test 2 — Bug #2 (Validation Gap) + Bug #3 (Silent Drop)

**Validates:** Explicit `image_routing: "auto"` with observer disabled is overridden to `direct`, and a debounced toast fires.
**Vision needed:** No (observer-disabled guard blocks before orchestrator sees image).

### Todo list for Test 2

```
- [ ] Step 1: AI writes config (auto + observer disabled)
- [ ] Step 2: User restarts OpenCode
- [ ] Step 3: AI checks config
- [ ] Step 4: AI checks plugin load warning in logs
- [ ] Step 5: AI sends image prompt (toast expected)
- [ ] Step 6: AI reports pass/fail for toast
- [ ] Step 7: AI tests debounce (send within 60s → no toast)
- [ ] Step 8: AI waits 60s, sends again → toast fires
```

### Step 1 — AI writes config

AI writes `~/.config/opencode/oh-my-opencode-slim.jsonc`:

```jsonc
{
  "disabled_agents": ["observer"],
  "image_routing": "auto"
}
```

Mark step 1 `completed`.

### Step 2 — User restarts

Tell user: "Restart OpenCode fully. Reply when ready."

Wait for user confirmation. Then mark step 2 `completed`.

### Step 3 — AI checks config

Read config and verify both keys are present.

If correct → mark step 3 `completed`. If wrong → fix, ask restart, re-verify.

### Step 4 — AI checks plugin load warning

Read logs for:
- ✅ Warning: `image_routing "auto" requires observer to be enabled`

**Search tip:** If the exact string isn't found, broaden to `grep -E "auto.*observer|observer.*auto|image_routing"` across all recent plugin logs. The warning may appear at plugin init time (check the log with the session start timestamp).

Report found/not found. Mark step 4 `completed`.

### Step 5 — AI sends image prompt

Send: `[attach a small image] What do you see in this image?`

Mark step 5 `completed`.

### Step 6 — AI reports toast result

Read logs for:
- ✅ **Warning toast** with "Images skipped" message.
- ✅ Image left in message (not stripped).
- ✅ Log line: `[image-hook] dropped images: observer disabled`

**What "pass" looks like:** The `[image-hook] dropped images: observer disabled` line should appear in the plugin log after sending the image. The toast is a UI notification — you may not see it in logs, but the `[image-hook]` log line confirms the drop happened. If you see `[image-routing] auto mode: intercepted` instead, that's a different code path (Test 6 territory).

**"Image left in message" check:** Look at the conversation — the image thumbnail should still be visible in the user's message. The hook drops the routing but doesn't strip the image from the message parts. If the image disappears from the conversation, that's a FAIL.

Report PASS or FAIL. Mark step 6 `completed`.

### Step 7 — AI tests debounce (within 60s)

Send another image immediately → check logs → **no second toast expected**.

**Timing note:** "Immediately" means within a few seconds. The debounce window is 60 seconds. Send the image, check logs — if you see a second `[image-hook] dropped images` line, the debounce is broken (FAIL).

Report found/not found. Mark step 7 `completed`.

### Step 8 — AI tests debounce (after 60s)

Wait 60 seconds. Send another image → check logs → **toast fires again**.

**Timing note:** Use `sleep 60` or wait visibly. After 60s the debounce window resets. A new `[image-hook] dropped images` line should appear. If it doesn't, the debounce isn't resetting (FAIL).

Report PASS or FAIL. Mark step 8 `completed`.

---

## Test 3 — Greptile #1: Multi-Message Check

**Validates:** Toast fires when image is in a non-last user message (old code missed this).
**Vision needed:** No (observer-disabled guard blocks).
**Config:** Same as Test 2. No config change needed.

### Todo list for Test 3

```
- [ ] Step 1: AI checks config (no change needed)
- [ ] Step 2: AI sends both messages (image + text) in one turn
- [ ] Step 3: AI reports pass/fail
```

### Step 1 — AI checks config

Read config and confirm: `disabled_agents` has `"observer"`, `image_routing` is `"auto"`.

Mark step 1 `completed`.

### Step 2 — AI sends both messages

Send in one turn:
```
[attach image] What's in this image?

follow-up text question with no image
```

Mark step 2 `completed`.

### Step 3 — AI reports pass/fail

Read logs for:
- ✅ **Toast fires** — the image is in the FIRST message, not the last.
- ✅ Log line: `[image-hook] dropped images: observer disabled`

**Before Greptile fix:** Toast would NOT fire because the last message has no image.

Report PASS or FAIL. Mark step 3 `completed`.

---

## Test 4 — Greptile #2: Per-Directory Debounce

**Validates:** Debounce state doesn't bleed across plugin instances (projects).
**Vision needed:** No (observer-disabled guard blocks).

### Todo list for Test 4

```
- [ ] Step 1: AI creates test project directories and configs
- [ ] Step 2: AI checks configs
- [ ] Step 3: User opens project A, AI sends image → toast fires
- [ ] Step 4: User switches to project B within 60s, AI sends image → toast fires again
- [ ] Step 5: AI reports pass/fail
```

### Step 1 — AI sets up test projects

```bash
mkdir -p ~/test-projects/project-a ~/test-projects/project-b

cat > ~/test-projects/project-a/.opencode/oh-my-opencode-slim.jsonc <<'EOF'
{ "disabled_agents": ["observer"], "image_routing": "auto" }
EOF

cat > ~/test-projects/project-b/.opencode/oh-my-opencode-slim.jsonc <<'EOF'
{ "disabled_agents": ["observer"], "image_routing": "auto" }
EOF
```

**Note:** These are project-local configs (`.opencode/` dir), not the global config (`~/.config/opencode/`). The plugin merges project-local over global. Ensure the `.opencode/` directory exists before writing.

Mark step 1 `completed`.

### Step 2 — AI checks configs

Read both project configs and verify they are correct.

Mark step 2 `completed`.

### Step 3 — Test in project A

Tell user: "Open OpenCode in `~/test-projects/project-a`. Reply when ready."

Wait for user confirmation. Then send image → **toast fires**.

Mark step 3 `completed`.

### Step 4 — Test in project B (within 60s)

Tell user: "Within 60 seconds, switch to `~/test-projects/project-b` (new session). Reply when ready."

Wait for user confirmation. Then send image → **toast fires AGAIN**.

Mark step 4 `completed`.

### Step 5 — AI reports pass/fail

- ✅ **Both toasts fire** (debounce is per-project, not global).

**Before Greptile fix:** Second toast would be suppressed because the module-level `let` was shared.

Report PASS or FAIL. Mark step 5 `completed`.

---

## Test 5 — Greptile #3: Debounce-on-Success

**Validates:** A failed `showToast` doesn't suppress the next warning.
**Manual test difficulty:** Hard — requires making `showToast` reject.

### Todo list for Test 5

```
- [ ] Step 1: Run programmatic test suite
- [ ] Step 2: Code review of .then() handler
- [ ] Step 3: AI reports pass/fail
```

### Step 1 — Run test suite

```bash
cd /home/mhenke/Projects/oh-my-opencode-slim
bun test src/hooks/image-hook.test.ts
# 16 tests pass, including the multi-message test
```

**Note:** Run from the repo root (not the worktree). The test file path is `src/hooks/image-hook.test.ts`. All 16 tests should pass. If any fail, report which ones and the error output.

Mark step 1 `completed`.

### Step 2 — Code review check

Read `src/index.ts` and verify:
- The `.then()` handler advances the debounce timestamp only on **successful** `showToast`.
- The `.catch(() => {})` swallows the rejection but does **NOT** advance the timestamp.

Mark step 2 `completed`.

### Step 3 — AI reports pass/fail

Report PASS or FAIL based on test suite results and code review. Mark step 3 `completed`.

---

## Test 6 — Negative Test: Happy Path

**Validates:** When Observer is enabled and routing is auto, images are intercepted and delegated to `@observer`. No toast.
**Vision needed:** No (image goes to observer, not orchestrator).

### Todo list for Test 6

```
- [ ] Step 1: AI writes config (observer enabled)
- [ ] Step 2: User restarts OpenCode
- [ ] Step 3: AI checks config
- [ ] Step 4: AI sends image prompt
- [ ] Step 5: AI reports pass/fail
```

### Step 1 — AI writes config

AI writes `~/.config/opencode/oh-my-opencode-slim.jsonc`:

```jsonc
{
  "disabled_agents": []
}
```

(`image_routing` omitted, observer enabled → resolves to `"auto"`)

Mark step 1 `completed`.

### Step 2 — User restarts

Tell user: "Restart OpenCode fully. Reply when ready."

Wait for user confirmation. Then mark step 2 `completed`.

### Step 3 — AI checks config

Read config and verify:
- `disabled_agents` is empty (`[]`)
- `image_routing` is absent

Mark step 3 `completed`.

### Step 4 — AI sends image prompt

Send: `[attach a small image] What do you see in this image?`

Mark step 4 `completed`.

### Step 5 — AI reports pass/fail

Read logs for:
- ✅ **No toast.**
- ✅ Log line: `[image-routing] auto mode: intercepted 1 image(s), delegating to @observer`
- ✅ Image saved to `.opencode/images/ses_*/`
- ✅ Message parts replaced with text nudge mentioning `@observer`

**"Image saved" check:** Look for files in `.opencode/images/` directory (may be under the session ID). The image should be copied there for the observer to process.

**"Message parts replaced" check:** In the conversation, the image should be replaced with a text message like "Image saved for @observer to analyze" or similar. The original image should NOT be visible in the message anymore.

Report PASS or FAIL. Mark step 5 `completed`.

---

## Restore original config

After all tests:

1. AI writes config back to original (edit only the relevant keys, don't overwrite the entire file):
   ```jsonc
   {
     "disabled_agents": ["observer"],
     "image_routing": "auto"
   }
   ```
2. Tell user to restart one final time.

---

## Coverage Matrix

| Test | Bug #1 | Bug #2 | Bug #3 | Greptile #1 | Greptile #2 | Greptile #3 | Negative |
|------|--------|--------|--------|-------------|-------------|-------------|----------|
| Test 1 | ✅ | | | | | | |
| Test 2A | | ✅ | | | | | |
| Test 2B | | ✅ | ✅ | | | | |
| Test 2C | | | ✅ (debounce) | | | | |
| Test 3 | | | | ✅ | | | |
| Test 4 | | | | | ✅ | | |
| Test 5 | | | | | | ✅ (programmatic) | |
| Test 6 | | | | | | | ✅ |

---

## PR #877 Fix Summary

| Fix | Source | What it does |
|-----|--------|-------------|
| Bug #1 | `src/config/constants.ts` | `resolveImageRouting()` returns `direct` when omitted + observer disabled |
| Bug #2 | `src/config/loader.ts` | Runtime override: if `auto` + observer disabled → force `direct` |
| Bug #3 | `src/index.ts` | Debounced toast on observer-disabled path (60s cooldown) |
| Greptile #1 | `src/hooks/image-hook.ts` | Iterates ALL user messages, not just the last |
| Greptile #2 | `src/index.ts` | Per-project debounce Map (not global `let`) |
| Greptile #3 | `src/index.ts` | Debounce timestamp advances only on `.then()` (success) |

---

## Overall testing notes

- **Config management:** The config file has many keys. Always edit only the relevant keys, never overwrite the whole file. Use `read` to see current state, then `edit` to change specific lines.
- **Log location:** Plugin logs are at `~/.local/share/opencode/log/oh-my-opencode-slim.<timestamp>.log`. Use `ls -t` to find the most recent.
- **Log search:** If exact grep patterns return nothing, broaden terms. For `direct` mode, no log lines is expected.
- **Restart requirement:** Each config change requires a full OpenCode restart (quit + reopen). The plugin reads config at init time.
- **Image attachment:** The AI cannot attach images — the user must send images manually in the session.
- **Debounce timing:** The 60-second debounce window is exact. Use `sleep 60` for reliable waiting.
