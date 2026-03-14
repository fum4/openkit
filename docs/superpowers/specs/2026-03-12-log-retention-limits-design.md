# Log Retention Limits & List Virtualization

Adds configurable retention limits (days and max file size) for both activity logs (notifications) and ops logs (debug logs), and virtualizes the corresponding UI lists.

## Motivation

Both log files (`.openkit/activity.jsonl` and `.openkit/ops-log.jsonl`) currently grow without bound. The existing `retentionDays` default of 7 is hardcoded and not exposed in the UI. Users need control over log growth, and the UI lists need virtualization to handle large datasets without DOM bloat.

## Configuration Model

### Activity config

In `libs/shared/src/activity-event.ts`, update `ActivityConfig`:

```typescript
export interface ActivityConfig {
  retentionDays?: number; // undefined = unlimited
  maxSizeMB?: number; // undefined = unlimited
  categories: Record<ActivityCategory, boolean>;
  disabledEvents: string[];
  toastEvents: string[];
  osNotificationEvents: string[];
}
```

Remove the hardcoded `retentionDays: 7` from `DEFAULT_ACTIVITY_CONFIG`. Both limits default to `undefined` (unlimited).

### Ops log config

In `libs/shared/src/worktree-types.ts`, add to `WorktreeConfig`:

```typescript
export interface WorktreeConfig {
  // ... existing fields ...
  opsLog?: {
    retentionDays?: number; // undefined = unlimited
    maxSizeMB?: number; // undefined = unlimited
  };
}
```

Stored in `.openkit/config.json` alongside existing config.

### OpsLogConfig

In `apps/server/src/ops-log.ts`, update:

```typescript
export interface OpsLogConfig {
  retentionDays?: number; // undefined = unlimited
  maxSizeMB?: number; // undefined = unlimited
}
```

Remove the hardcoded `retentionDays: 7` default from `DEFAULT_OPS_LOG_CONFIG`.

## Pruning Logic

Both `OpsLog` and `ActivityLog` get the same enhanced pruning strategy.

### When pruning runs

- After every `addEvent()` call, once the new entry is appended
- On initialization (existing behavior, kept)
- Remove the existing hourly `setInterval` — checking on write is sufficient

### Pruning algorithm

```
1. If maxSizeMB is set:
   - stat the file to get current size
   - If size > maxSizeMB * 1024 * 1024:
     - Read all entries
     - Drop oldest entries until total serialized size is under limit
     - Rewrite file

2. If retentionDays is set:
   - Compute cutoff = now - retentionDays * 86400000
   - Read all entries
   - Filter out entries with timestamp < cutoff
   - Rewrite file
```

If both limits are set, both checks run — whichever triggers first causes pruning. Size check runs before days check to avoid reading the file twice when size alone resolves it.

Use `fs.statSync` for the size check — cheap syscall, avoids reading the file just to determine if pruning is needed.

### Edge case

If a single event exceeds `maxSizeMB`, it still gets written (we don't drop the entry we just appended). The limit applies to accumulated history, not individual entries.

## Settings UI

### Notifications section (existing card in ConfigurationPanel)

Add two number inputs below the existing notification controls:

- **Retention days** — label: "Retention (days)", placeholder: "Unlimited"
- **Max size (MB)** — label: "Max size (MB)", placeholder: "Unlimited"

These write to `config.activity.retentionDays` and `config.activity.maxSizeMB` via the existing `PATCH /api/config` endpoint.

### Project configuration section (existing card in ConfigurationPanel)

Add two number inputs for debug logs:

- **Retention days** — label: "Debug log retention (days)", placeholder: "Unlimited"
- **Max size (MB)** — label: "Debug log max size (MB)", placeholder: "Unlimited"

These write to `config.opsLog.retentionDays` and `config.opsLog.maxSizeMB` via the existing `PATCH /api/config` endpoint.

### Input behavior

- Empty / cleared input = `undefined` (unlimited)
- Only accept positive numbers
- **Do NOT auto-save these fields.** Unlike other settings, retention changes can cause irreversible data loss (e.g., typing "1" MB temporarily would nuke logs). Instead:
  1. Retention inputs are independent from the debounced auto-save form
  2. A subtle "Apply" button appears next to the inputs when values differ from saved config
  3. Clicking "Apply" triggers a server-side impact check first
  4. If entries would be pruned, show a warning modal: _"This will remove X entries (Y MB) from [debug logs / activity logs]. This cannot be undone."_ with Cancel/Apply buttons
  5. Only on confirmation does the config save and pruning execute

### Impact estimation API

Add a new endpoint to check what would be pruned before applying:

- `POST /api/config/retention-impact` — accepts `{ target: "activity" | "opsLog", retentionDays?: number, maxSizeMB?: number }`, returns `{ entriesToRemove: number, bytesToRemove: number, currentEntries: number, currentBytes: number }`

This lets the UI show an informed warning before committing to destructive changes.

## List Virtualization

### Package

Add `@tanstack/react-virtual` to `apps/web-app`.

### Where to apply

1. **Activity feed list** — the activity/notification event list in the Activity view
2. **Ops log list** — the debug log list in the ops log view

### Implementation approach

- Use `useVirtualizer` hook from `@tanstack/react-virtual`
- Wrap the existing list container with a scrollable div, set `overflow-y: auto`
- Each row renders the existing list item component
- Estimate row height based on current item styling; let the virtualizer handle measurement

## Files to modify

| File                                                 | Change                                                                                    |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `libs/shared/src/activity-event.ts`                  | Update `ActivityConfig`, remove default `retentionDays`                                   |
| `libs/shared/src/worktree-types.ts`                  | Add `opsLog` block to `WorktreeConfig`                                                    |
| `apps/server/src/ops-log.ts`                         | Update `OpsLogConfig`, add size-based pruning, `estimateImpact`, remove interval          |
| `apps/server/src/activity-log.ts`                    | Add size-based pruning, `estimateImpact`, remove interval, remove default `retentionDays` |
| `apps/server/src/manager.ts`                         | Pass `opsLog` config to OpsLog constructor                                                |
| `apps/server/src/routes/config.ts`                   | Add `POST /api/config/retention-impact` endpoint                                          |
| `apps/web-app/src/hooks/api.ts`                      | Add `fetchRetentionImpact` API call                                                       |
| `apps/web-app/src/components/ConfigurationPanel.tsx` | Add retention/size inputs with Apply button + warning modal                               |
| `apps/web-app/src/components/ActivityFeed.tsx`       | Virtualize activity feed list                                                             |
| `apps/web-app/src/components/ActivityPage.tsx`       | Virtualize ops log list                                                                   |
| `docs/CONFIGURATION.md`                              | Document new config fields                                                                |
| `docs/NOTIFICATIONS.md`                              | Document notification retention settings                                                  |

## Testing

- Unit tests for pruning logic in both `OpsLog` and `ActivityLog` (size-based, days-based, combined)
- Unit tests for edge cases (empty config = unlimited, single large entry)
- Component tests for the new settings inputs (render, change, save)
