# V2 Workstreams

Track focused V2 branches and local worktrees here. `v2-beta` is the central
integration branch: merge reviewed V2 work there, test the combined V2 state
there, and publish npm `beta` releases from there.

| Branch | Worktree | Purpose | Status | Notes |
|---|---|---|---|---|
| `v2-beta` | repo root | V2 integration/release | Active | Source of truth for combined V2 testing and `@beta` publishes. |
| `v2/misc` | `.slim/worktrees/v2-misc` | Misc V2 cleanup | Merged | Removed custom subtask feature; can continue misc follow-ups here if desired. |
| `v2/tui` | `.slim/worktrees/v2-tui` | TUI integration | Planned | No feature work merged yet. |

Useful status commands:

```bash
git worktree list
git branch --list 'v2/*' -vv
git branch --merged v2-beta
git log --oneline --decorate --graph --all --branches='v2/*'
```

After a feature branch is merged and no longer needed locally:

```bash
git worktree remove .slim/worktrees/v2-<feature-name>
git branch -d v2/<feature-name>
```
