# Worktree Auto-Cleanup on PR Merge/Close

**Date**: 2026-03-20
**Status**: Draft

## Summary

Add two config flags — `autoCleanupOnPrMerge` and `autoCleanupOnPrClose` — that automatically delete worktrees when their associated GitHub PR is detected as merged or closed. A safety gate prevents deletion if the worktree has uncommitted or unpushed changes, and all actions are surfaced via activity notifications.

Additionally, unify the config system so both `config.json` and `config.local.json` support the same schema, with `config.local.json` taking priority on a per-field basis.

## Config Unification

### Rename

`local-config.json` → `config.local.json` (no backwards compatibility / migration).

### Merge Semantics

Both `.openkit/config.json` and `.openkit/config.local.json` support the full `WorktreeConfig` schema. When reading any config field, the app performs a shallow merge where `config.local.json` values override `config.json` values on a per-field basis.

This means:

- The UI writes certain flags to `config.local.json` by default (personal prefs).
- A user can manually move any setting to `config.json` to make it team-wide.
- A user can manually override any team setting in `config.local.json`.
- Both files are technically interchangeable — the only difference is which file the UI writes to by default and which is gitignored.

### Fields that move to `config.local.json` as default write target

- `autoInstall` (currently in `config.json`)
- `autoCleanupOnPrMerge` (new)
- `autoCleanupOnPrClose` (new)
- `allowAgentCommits`, `allowAgentPushes`, `allowAgentPRs` (already in local)
- `useNativePortHook` (already in local)
- `shortcuts`, `arrowNavEnabled` (already in local)

### Implementation

**`withLocalConfig()`** in `manager.ts`: expand to merge ALL fields from `config.local.json` over `config.json`, not just a hardcoded subset. The local config file now supports the full `WorktreeConfig` schema. For nested objects like `activity` and `opsLog`, perform a shallow merge of the nested fields (spread the config.json value, then spread the local value over it).

**`LocalConfig` type**: remove as a separate interface. Both files use `Partial<WorktreeConfig>` (plus the local-only `shortcuts` and `arrowNavEnabled` fields that don't exist on `WorktreeConfig`).

**`LOCAL_CONFIG_KEYS`**: expand to include `autoInstall`, `autoCleanupOnPrMerge`, `autoCleanupOnPrClose`. These are flat boolean keys that `updateConfig()` routes to `config.local.json` instead of `config.json`. The existing boolean-only validation in `updateConfig()` applies to these.

**`reloadConfig()`** in `manager.ts`: currently enumerates fields manually. After unification, `reloadConfig()` must also pick up `autoCleanupOnPrMerge`, `autoCleanupOnPrClose`, and any other new fields from the file config before passing through `withLocalConfig()`.

**File watcher** in `manager.ts`: the hard-coded `"local-config.json"` string used to classify file-change events must be updated to `"config.local.json"`.

**`.openkit/.gitignore`**: already ignores everything except `config.json` and `.gitignore`. `config.local.json` is automatically gitignored.

## New Config Flags

```typescript
interface WorktreeConfig {
  // ... existing fields ...

  /** Auto-delete worktree when its PR is merged (default: false) */
  autoCleanupOnPrMerge?: boolean;
  /** Auto-delete worktree when its PR is closed without merge (default: false) */
  autoCleanupOnPrClose?: boolean;
}
```

Both default to `false`. Initialized in `config.local.json` during `ensureLocalConfigDefaults()`.

## Detection Flow

The auto-cleanup piggybacks on the existing `GitHubManager.startPolling()` 60-second PR polling loop. No new polling interval or webhook is introduced.

### Current flow (unchanged)

1. `pollPRs()` iterates all worktrees, calls `findPRForBranch()` for each.
2. Compares with `prCache` — if state changed, updates cache and sets `changed = true`.
3. If `changed`, calls `onUpdate()` which triggers `notifyListeners()`.

### New behavior

After the PR poll loop detects a state change, `GitHubManager` calls a new optional callback (`onPrStateChange`) with the worktree ID, old state, and new state:

```
pollPRs detects state change
  → is old state defined (not first poll for this worktree)?
    → is new state "merged" or "closed"?
      → call onPrStateChange(worktreeId, oldState, newState)
```

**Cold-start guard**: `onPrStateChange` only fires when transitioning from a known previous state (`open`, `draft`) to a terminal state (`merged`, `closed`). When `oldState` is `undefined` (first poll populating an empty cache), the callback is NOT called. This prevents auto-deleting worktrees for stale merged PRs on every server restart.

The `onPrStateChange` parameter is **optional** (defaults to no-op) to avoid breaking the existing call site in `initGitHub()`.

The callback is provided by `WorktreeManager` during `startPolling()`. Inside `WorktreeManager`:

```
onPrStateChange(worktreeId, oldState, newState):
  1. Read config (merged view from both config files)
  2. If newState === "merged" && !config.autoCleanupOnPrMerge → return
  3. If newState === "closed" && !config.autoCleanupOnPrClose → return
  4. Get worktree git status from githubManager.getCachedGitStatus(worktreeId)
     Derive hasUnpushed as: git.ahead > 0 || git.noUpstream
     (GitStatusInfo has no hasUnpushed field — this matches the derivation in getWorktrees())
  5. If git.hasUncommitted || hasUnpushed:
     → activityLog.addEvent({
         category: "worktree",
         type: "auto-cleanup-skipped",
         severity: "warning",
         title: "Auto-cleanup skipped",
         detail: "Worktree "{id}" has uncommitted/unpushed changes — skipped auto-cleanup (PR was {merged/closed})"
       })
     → return
  6. Call removeWorktree(worktreeId)
     Note: removeWorktree() already calls stopWorktree() internally, so running
     dev servers are gracefully terminated before deletion.
  7. activityLog.addEvent({
       category: "worktree",
       type: "auto-cleanup",
       severity: "info",
       title: "Worktree auto-deleted",
       detail: "Worktree "{id}" was auto-deleted — PR was {merged/closed}"
     })
```

### Timing

- PR state is polled every 60 seconds.
- Git status (uncommitted/unpushed) is polled every 3 seconds and cached.
- The safety gate reads from the git status cache, so it's always near-current.
- Auto-cleanup happens synchronously after detection — no delay or confirmation.

## UI Changes

### Settings Page (ConfigurationPanel.tsx)

Two new toggle rows in the Project Settings card, positioned **immediately below** the existing "Auto-install dependencies" toggle:

```
┌─────────────────────────────────────────────────┐
│  Auto-install dependencies               [ON]  │
│  Run install command when creating a new        │
│  worktree                                       │
├─────────────────────────────────────────────────┤
│  Auto-delete on PR merge                 [OFF]  │
│  Delete worktree when its PR is merged          │
├─────────────────────────────────────────────────┤
│  Auto-delete on PR close                 [OFF]  │
│  Delete worktree when its PR is closed          │
│  without merge                                  │
└─────────────────────────────────────────────────┘
```

Same visual treatment as the existing toggle (label + description + `ToggleSwitch`).

These toggles write to `config.local.json` via `PATCH /api/local-config` (same as agent policy toggles).

## Activity Notifications

Two new activity event types:

| Type                   | Severity  | When                                      |
| ---------------------- | --------- | ----------------------------------------- |
| `auto-cleanup`         | `info`    | Worktree successfully auto-deleted        |
| `auto-cleanup-skipped` | `warning` | Worktree has dirty state, cleanup skipped |

Both use `category: "worktree"` and include `worktreeId` and `projectName` metadata. New constants `AUTO_CLEANUP` and `AUTO_CLEANUP_SKIPPED` are added to `ACTIVITY_TYPES` in `libs/shared/src/activity-event.ts` (the canonical definition).

## Files to Modify

| File                                                 | Change                                                                                                                                                                                                                                              |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/worktree-types.ts`                  | Add `autoCleanupOnPrMerge`, `autoCleanupOnPrClose` to `WorktreeConfig`                                                                                                                                                                              |
| `libs/shared/src/activity-event.ts`                  | Add `AUTO_CLEANUP` and `AUTO_CLEANUP_SKIPPED` to `ACTIVITY_TYPES`                                                                                                                                                                                   |
| `apps/server/src/local-config.ts`                    | Rename file constant to `config.local.json`, add new fields to type/sanitizer/defaults                                                                                                                                                              |
| `apps/server/src/manager.ts`                         | Expand `withLocalConfig()` merge, add `onPrStateChange` callback, wire into `initGitHub()`, add `LOCAL_CONFIG_KEYS` entries, update file watcher from `"local-config.json"` to `"config.local.json"`, update `reloadConfig()` to pick up new fields |
| `libs/integrations/src/github/github-manager.ts`     | Add optional `onPrStateChange` callback parameter to `startPolling()`, call it on state transitions from non-terminal to terminal (with cold-start guard)                                                                                           |
| `apps/server/src/routes/config.ts`                   | Update file references from `local-config.json` to `config.local.json`                                                                                                                                                                              |
| `apps/web-app/src/components/ConfigurationPanel.tsx` | Add two new toggle rows below auto-install                                                                                                                                                                                                          |
| `apps/web-app/src/hooks/useLocalConfig.ts`           | Add `autoCleanupOnPrMerge`, `autoCleanupOnPrClose` to the `LocalConfig` interface so toggles can read/write them                                                                                                                                    |
| `apps/web-app/src/hooks/useConfig.ts`                | Update local config endpoint if path changes                                                                                                                                                                                                        |
| `.openkit/.gitignore`                                | Already covers `config.local.json` (ignores everything except `config.json` and `.gitignore`)                                                                                                                                                       |

## What This Does NOT Change

- No new polling intervals or webhooks.
- No changes to the worktree deletion logic (`removeWorktree()` is called as-is).
- No changes to the PR detection logic (`findPRForBranch()` is unchanged).
- No confirmation dialog or delay — the safety gate (dirty check) is the only guard.
- No changes to Jira/Linear auto-cleanup (separate system).
- `removeWorktree()` already handles running dev servers (calls `stopWorktree()` internally), so no special handling is needed for active worktrees.
