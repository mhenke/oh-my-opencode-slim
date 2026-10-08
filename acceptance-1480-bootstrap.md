# 1480 Acceptance Tests — bootstrap extraction smoke audit

PROVENANCE: first revision. No prior field runs. Lane omos/fix-1480-deep-bootstrap
refactors `src/index.ts` by extracting four modules under `src/bootstrap/`
(session-state, profile, background-jobs, tools). The diff is a behavior-preserving
extraction: no log string, board state, or lifecycle rule was edited. Ordinary
positive scenarios (health check, child session lifecycle, hook registration)
therefore PASS identically on pre-fix and post-fix master. They are scripted
here as smoke evidence that the extraction preserved runtime behavior. Only
Scenario F discriminates the one fixed defect (duplicate
`createDeepworkCommandHook()`); its property is "at most one deepwork command
hook initializes per plugin instantiation," which fails only if the duplicate
double-registers a distinct command, a state the current source shows is
impossible, so F records NOT RUN unless you can vary registration count.

## Directive — run it live, no questions

You are the orchestrator. Execute this spec live, now, in this session.
Do not ask the user anything. Every step below is mechanical: run the command,
read the output, record the verdict. If a step's evidence cannot be produced,
record INCONCLUSIVE for that scenario with the reason and continue.

## Who you are and what you run

You ARE the session under test. The oh-my-opencode-slim plugin is loaded into
YOUR process and manages YOUR background jobs. You exercise it by spawning one
real background child through your own spawn tool and by reading the plugin
log. There is no external TUI and nothing to drive externally.

## How to perform each step

| Step | Meaning | Typical runtime name |
|------|---------|----------------------|
| SPAWN | start one real background child session | `task` with background=true |
| WAIT n | do nothing for n seconds | `bash` running `sleep n` |
| FILE CHECK | stat a file or list a directory | `bash` running `ls -l` |
| LOG CHECK | grep plugin log for an exact string | `bash` running `grep -n` |

Spawn text (use verbatim as the child prompt):

```
Run this exact shell command: sleep 8
Then reply with the single word DONE and nothing else.
```

## Expected lifecycle

After SPAWN, the plugin receives a `session.created` event for the child
(parented session). The task-session manager registers the launch, tracks
activity, and terminal publication proceeds. In the plugin log this appears:

1. `[plugin] build info` (once at init)
2. `[plugin] instance scope {"directory":"/..."}` (once at init)
3. `[plugin] health check passed {agents, tools, mcps}` (once at init)
4. `[task-session-manager] session.created observed`
5. `[task-session-manager] background task launch registered`
6. `[task-session-manager] foreground task status registered` or completion
7. NO `[plugin] FATAL: init failed`, NO `[plugin] WARN:` health-check warning

Completions preempting any idle branch are normal reconcile cleanup.

## Preconditions

P1. Plugin build matches the worktree branch: the newest
    `~/.local/share/opencode/log/oh-my-opencode-slim.*.log` carries
    `[plugin] build info` and `[plugin] instance scope` with
    `"directory":"/home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap"`;
    its timestamp is later than the mtime of
    `/home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap/dist/index.js`.
P2. HEAD is the branch tip:
    `git -C /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap log --oneline -1`
    prints `591675b` or a descendant.

If P1 or P2 fails: record INCONCLUSIVE for all scenarios and stop.

## One-time setup

```
LOGDIR=$HOME/.local/share/opencode/log
git -C /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap log --oneline -1
ls -l --time-style=full-iso /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap/dist/index.js
```

## Scenario A — plugin init completes with health check

1. LOG CHECK:
```
grep -hm3 "\[plugin\] build info" $LOGDIR/oh-my-opencode-slim.*.log
grep -hm3 "\[plugin\] instance scope" $LOGDIR/oh-my-opencode-slim.*.log
grep -hm3 "\[plugin\] health check passed" $LOGDIR/oh-my-opencode-slim.*.log
```

- PASS: all three lines exist with a recent timestamp; no `[plugin] FATAL`
  or health-check WARN follows them.
- FAIL: any `[plugin] FATAL: init failed` after the build-info line, or zero
  health-check lines.
- INCONCLUSIVE: build-info line absent (wrong log window).

## Scenario B — background child lifecycle is tracked

1. SPAWN with verbatim text. Note wall-clock time.
2. WAIT 12.
3. Determine SID from your spawn tool's returned task/session id.
4. LOG CHECK:
```
grep -hm3 "session.created observed" $LOGDIR/oh-my-opencode-slim.*.log
grep -hm3 "background task launch registered" $LOGDIR/oh-my-opencode-slim.*.log
```

- PASS: both lines present and stamped after the spawn moment.
- FAIL: `[task-session-manager] session.created observed` is absent, or
  orphan `[plugin] FATAL` appears.
- INCONCLUSIVE: SID unknown and lines absent.

## Scenario C — no double init / no double command registration

1. LOG CHECK for duplicate init artifacts:
```
grep -hm5 "\[plugin\] build info" $LOGDIR/oh-my-opencode-slim.*.log
grep -hm5 "health check passed" $LOGDIR/oh-my-opencode-slim.*.log
```

- PASS: build info and health-check each appear once per session start,
  not twice.
- FAIL: two `[plugin] build info` lines stamped within the same seconds.
- INCONCLUSIVE: multiple concurrent sessions make window ambiguous.

## Scenario D — codemap/docs references are consistent

1. FILE CHECK:
```
ls /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap/src/bootstrap/
grep -n "src/bootstrap/" /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap/codemap.md
```

- PASS: the four module files exist and `codemap.md` lists `src/bootstrap/`.
- FAIL: missing directory or missing map row.
- INCONCLUSIVE: worktree path differs.

## Scenario E — source branch HEAD contains the fix

1. GIT CHECK:
```
git -C /home/mhenke/Projects/oh-my-opencode-slim/.slim/worktrees/fix-1480-deep-bootstrap log --oneline -1
```

- PASS: prints `591675b` or a newer commit on the same branch.
- FAIL: different HEAD, missing fix commit.
- INCONCLUSIVE: not a repo.

## Reference

- `src/index.ts:140-145` — build-info log at init.
- `src/index.ts:246` — `[plugin] instance scope`.
- `src/index.ts:439` — health-check passed.
- `src/hooks/task-session-manager/event-router.ts:358,805` —
  session.created and busy observed during a child run.
- `src/hooks/task-session-manager/tool-execute-hooks.ts:707` —
  background task launch registration.
- `src/bootstrap/codemap.md` — map row for the extracted modules.

## Results table (your final output)

```
Scenario | PASS/FAIL/INCONCLUSIVE/NOT RUN | evidence (log line numbers)
A        |                                |
B        |                                |
C        |                                |
D        |                                |
E        |                                |
```

NOT RUN = precondition absent by design (state which).
INCONCLUSIVE = attempted but undecidable (state the reason).
