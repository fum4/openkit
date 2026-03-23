# Per-Worktree Auto-Cleanup Settings

Override the global auto-cleanup behavior on a per-worktree basis via a settings dropdown in the worktree detail panel.

## Context

The global settings `autoCleanupOnPrMerge` and `autoCleanupOnPrClose` in `config.local.json` apply to all worktrees. Users need per-worktree control — some worktrees should auto-delete on merge, others should not, regardless of the global setting.

## Storage

A new file `.openkit/worktree-settings.json` stores per-worktree overrides. Internally, the path is constructed as `path.join(configDir, CONFIG_DIR_NAME, "worktree-settings.json")`, matching the convention in `local-config.ts` where `configDir` is the git root.

```json
{
  "e2e": { "autoCleanupOnMerge": true },
  "unified-logger": { "autoCleanupOnMerge": false, "autoCleanupOnClose": true }
}
```

- Each key is a worktree ID. Values are explicit overrides.
- Absent keys or absent fields mean "use global default."
- Empty objects are removed during cleanup.
- The file is created on first write, not eagerly at init.
- When a worktree is deleted (`removeWorktree`), its entry is removed from this file.

## Types

Shared domain type in `libs/shared/src/worktree-types.ts`:

```typescript
interface WorktreeSettings {
  autoCleanupOnMerge?: boolean;
  autoCleanupOnClose?: boolean;
}
```

The PATCH endpoint accepts `boolean | null` for each field (null removes the override, resetting to global default). This is handled via input sanitization in the route handler — the shared `WorktreeSettings` type stays clean with `?: boolean`.

## Server Module

New file `apps/server/src/worktree-settings.ts` with three functions:

### `loadWorktreeSettings(configDir, worktreeId): WorktreeSettings`

Reads `worktree-settings.json`, returns the settings for the given worktree ID. Returns `{}` if file doesn't exist or worktree has no entry. If the file exists but is malformed JSON, logs a warning with `log.warn` at the `config` domain and returns `{}`, matching the pattern in `loadLocalConfig`.

### `updateWorktreeSettings(configDir, worktreeId, patch): void`

Merges `patch` into the worktree's settings. Fields set to `undefined` or `null` are removed. Creates the file if it doesn't exist. Removes the entry if the result is empty (no remaining fields).

### `deleteWorktreeSettings(configDir, worktreeId): void`

Removes the worktree's entry from the file. Removes the file if no entries remain.

## Server Integration

### `handlePrStateChange` (manager.ts)

Currently checks `config.autoCleanupOnPrMerge`. Change to check per-worktree override first:

```typescript
const wtSettings = loadWorktreeSettings(this.configDir, worktreeId);
const shouldCleanupOnMerge = wtSettings.autoCleanupOnMerge ?? config.autoCleanupOnPrMerge;
const shouldCleanupOnClose = wtSettings.autoCleanupOnClose ?? config.autoCleanupOnPrClose;

if (newState === "merged" && !shouldCleanupOnMerge) return;
if (newState === "closed" && !shouldCleanupOnClose) return;
```

### `removeWorktree` (manager.ts)

Add `deleteWorktreeSettings(this.configDir, worktreeId)` in **both** cleanup paths:

1. The "worktree path already gone" early return (around the `clearLinkedWorktreeId` call in the early-exit branch)
2. The full deletion path (alongside the existing `clearLinkedWorktreeId` call)

### API Endpoints

Add to a new route file `apps/server/src/routes/worktree-settings.ts` or inline in the existing worktrees routes.

**`GET /api/worktrees/:id/settings`**

Returns the effective settings (per-worktree override merged with global defaults):

```typescript
{
  autoCleanupOnMerge: boolean; // effective value
  autoCleanupOnClose: boolean; // effective value
  autoCleanupOnMergeIsOverride: boolean; // true if per-worktree override is set
  autoCleanupOnCloseIsOverride: boolean; // true if per-worktree override is set
}
```

**`PATCH /api/worktrees/:id/settings`**

Accepts body:

```typescript
{ autoCleanupOnMerge?: boolean | null, autoCleanupOnClose?: boolean | null }
```

The route handler sanitizes the input: `boolean` values are stored as overrides, `null` values remove the override (reset to global default). Non-boolean, non-null values are ignored.

## Frontend

### Settings Dropdown

A gear icon (Settings2 from lucide) with a small ChevronDown, placed to the left of the "Move to worktree" / "Delete worktree" buttons in the detail panel action bar. Only visible for non-root worktrees.

Clicking opens a dropdown with two rows:

```
┌────────────────────────────────┐
│  Auto-delete on PR merge   [○] │
│  Auto-delete on PR close   [○] │
└────────────────────────────────┘
```

Each toggle shows the effective state (per-worktree override if set, otherwise global default). Toggling immediately calls `PATCH /api/worktrees/:id/settings` with the new boolean value. There is no visual distinction between "override set" and "using global default" — the toggle simply reflects the effective state.

The dropdown closes on click outside or Escape.

### API Functions

In `apps/web-app/src/hooks/api.ts`:

- `fetchWorktreeSettings(worktreeId)` → `GET /api/worktrees/:id/settings`
- `updateWorktreeSettings(worktreeId, patch)` → `PATCH /api/worktrees/:id/settings`

### Data Fetching

Use `useQuery` with `queryKey: ["worktree-settings", worktree.id]` to fetch settings when the dropdown opens (lazy). Invalidate on mutation via `useMutation` + `queryClient.invalidateQueries`.

## Testing

- **`worktree-settings.ts` module**: test load (file absent, valid, malformed JSON), update (create new, merge into existing, remove field with null, remove empty entry), delete (remove entry, remove file when empty)
- **API routes**: GET with/without overrides returns correct effective values, PATCH sets override, PATCH with null clears override
- **`handlePrStateChange`**: per-worktree override takes precedence over global, absent override falls back to global
- **`removeWorktree`**: settings entry cleaned up in both early-exit and full deletion paths

## Documentation

Update `docs/CONFIGURATION.md` to document `worktree-settings.json`: location, structure, and lifecycle (created on first write, entries removed on worktree deletion).

## What This Does NOT Include

- No per-worktree override for any other settings (just auto-cleanup)
- No changes to the global settings UI in ConfigurationPanel
