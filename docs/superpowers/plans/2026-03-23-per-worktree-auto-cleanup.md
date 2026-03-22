# Per-Worktree Auto-Cleanup Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-worktree auto-cleanup overrides via a settings dropdown in the detail panel, plus rename "Create Task" to "Create Issue".

**Architecture:** New `worktree-settings.ts` module stores per-worktree overrides in `.openkit/worktree-settings.json`. Server routes expose GET/PATCH endpoints. Frontend adds a settings dropdown with two toggles to DetailHeader. `handlePrStateChange` checks per-worktree overrides before global config.

**Tech Stack:** TypeScript, Hono, React, react-query, Vitest

**Spec:** `docs/superpowers/specs/2026-03-23-per-worktree-auto-cleanup-design.md`

---

### Task 1: Add shared type and "Create Task" → "Create Issue" rename

**Files:**

- Modify: `libs/shared/src/worktree-types.ts`
- Modify: `apps/web-app/src/components/detail/DetailPanel.tsx` (line 2050)
- Modify: `apps/web-app/src/components/CreateCustomTaskModal.tsx` (lines 105, 124)
- Modify: `apps/web-app/src/components/__test__/CreateCustomTaskModal.test.tsx`

- [ ] **Step 1: Add WorktreeSettings type**

In `libs/shared/src/worktree-types.ts`, after `PrDiffListResponse`, add:

```typescript
export interface WorktreeSettings {
  /** Override global auto-delete-on-merge setting for this worktree */
  autoCleanupOnMerge?: boolean;
  /** Override global auto-delete-on-close setting for this worktree */
  autoCleanupOnClose?: boolean;
}
```

- [ ] **Step 2: Rename "Create Task" to "Create Issue"**

In `apps/web-app/src/components/detail/DetailPanel.tsx` line 2050, change `Create Task` to `Create Issue`.

In `apps/web-app/src/components/CreateCustomTaskModal.tsx`:

- Line 105: change `title="Create Task"` to `title="Create Issue"`
- Line 124: change `{isCreating ? "Creating..." : "Create Task"}` to `{isCreating ? "Creating..." : "Create Issue"}`

In `apps/web-app/src/components/__test__/CreateCustomTaskModal.test.tsx`:

- Replace all occurrences of `"Create Task"` with `"Create Issue"`

- [ ] **Step 3: Verify**

Run: `pnpm check:types`
Run: `cd apps/web-app && npx vitest run src/components/__test__/CreateCustomTaskModal.test.tsx`
Expected: All pass

- [ ] **Step 4: Commit**

```bash
git add libs/shared/src/worktree-types.ts apps/web-app/src/components/detail/DetailPanel.tsx apps/web-app/src/components/CreateCustomTaskModal.tsx apps/web-app/src/components/__test__/CreateCustomTaskModal.test.tsx
git commit -m "feat(shared): add WorktreeSettings type, rename Create Task to Create Issue"
```

---

### Task 2: Create worktree-settings server module

**Files:**

- Create: `apps/server/src/worktree-settings.ts`
- Create: `apps/server/src/__test__/worktree-settings.test.ts`

Follow the pattern from `apps/server/src/local-config.ts` exactly.

- [ ] **Step 1: Write tests**

Create `apps/server/src/__test__/worktree-settings.test.ts`:

Tests for:

1. `loadWorktreeSettings` — returns `{}` when file doesn't exist
2. `loadWorktreeSettings` — returns settings for existing worktree
3. `loadWorktreeSettings` — returns `{}` for unknown worktree ID
4. `loadWorktreeSettings` — returns `{}` on malformed JSON, logs warning
5. `updateWorktreeSettings` — creates file and sets override
6. `updateWorktreeSettings` — merges into existing settings
7. `updateWorktreeSettings` — removes field when value is null/undefined
8. `updateWorktreeSettings` — removes entry when result is empty
9. `deleteWorktreeSettings` — removes worktree entry
10. `deleteWorktreeSettings` — no-ops when worktree not in file

Mock `fs` (existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync) and logger.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd apps/server && npx vitest run src/__test__/worktree-settings.test.ts`
Expected: FAIL — module doesn't exist

- [ ] **Step 3: Implement**

Create `apps/server/src/worktree-settings.ts`:

```typescript
/**
 * Per-worktree settings stored in .openkit/worktree-settings.json.
 * Allows overriding global auto-cleanup behavior on a per-worktree basis.
 */
```

Functions:

- `loadWorktreeSettings(configDir, worktreeId): WorktreeSettings` — read file, parse, return entry or `{}`
- `updateWorktreeSettings(configDir, worktreeId, patch): void` — merge patch, remove null fields, write
- `deleteWorktreeSettings(configDir, worktreeId): void` — remove entry, delete file if empty

Use `CONFIG_DIR_NAME` from `@openkit/shared/constants` for path construction. Sanitize input (only accept boolean values). Log warnings on parse errors.

- [ ] **Step 4: Run tests**

Run: `cd apps/server && npx vitest run src/__test__/worktree-settings.test.ts`
Expected: All pass

- [ ] **Step 5: Commit**

---

### Task 3: Integrate with handlePrStateChange and removeWorktree

**Files:**

- Modify: `apps/server/src/manager.ts`

- [ ] **Step 1: Update handlePrStateChange**

Import `loadWorktreeSettings` from `./worktree-settings`. Change lines 450-453:

```typescript
const config = this.getConfig();
const wtSettings = loadWorktreeSettings(this.configDir, worktreeId);
const shouldCleanupOnMerge = wtSettings.autoCleanupOnMerge ?? config.autoCleanupOnPrMerge;
const shouldCleanupOnClose = wtSettings.autoCleanupOnClose ?? config.autoCleanupOnPrClose;

if (newState === "merged" && !shouldCleanupOnMerge) return;
if (newState === "closed" && !shouldCleanupOnClose) return;
```

- [ ] **Step 2: Update removeWorktree — early-exit path**

Import `deleteWorktreeSettings`. Add after line 1883 (`clearLinkedWorktreeId`):

```typescript
deleteWorktreeSettings(this.configDir, worktreeId);
```

- [ ] **Step 3: Update removeWorktree — full deletion path**

Add after line 1917 (`clearLinkedWorktreeId`):

```typescript
deleteWorktreeSettings(this.configDir, worktreeId);
```

- [ ] **Step 4: Verify**

Run: `pnpm check:types`
Expected: Pass

- [ ] **Step 5: Commit**

---

### Task 4: Add API endpoints

**Files:**

- Modify: `apps/server/src/routes/worktrees.ts` (add to existing worktree routes)

- [ ] **Step 1: Add GET /api/worktrees/:id/settings**

```typescript
app.get("/api/worktrees/:id/settings", (c) => {
  const id = c.req.param("id");
  const resolved = manager.resolveWorktree(id);
  if (!resolved.success) {
    return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
  }
  const config = manager.getConfig();
  const wtSettings = loadWorktreeSettings(manager.getConfigDir(), resolved.worktreeId);
  return c.json({
    success: true,
    autoCleanupOnMerge: wtSettings.autoCleanupOnMerge ?? config.autoCleanupOnPrMerge ?? false,
    autoCleanupOnClose: wtSettings.autoCleanupOnClose ?? config.autoCleanupOnPrClose ?? false,
    autoCleanupOnMergeIsOverride: wtSettings.autoCleanupOnMerge !== undefined,
    autoCleanupOnCloseIsOverride: wtSettings.autoCleanupOnClose !== undefined,
  });
});
```

- [ ] **Step 2: Add PATCH /api/worktrees/:id/settings**

```typescript
app.patch("/api/worktrees/:id/settings", async (c) => {
  const id = c.req.param("id");
  const resolved = manager.resolveWorktree(id);
  if (!resolved.success) {
    return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
  }
  const body = await c.req.json<Record<string, unknown>>();
  const patch: Record<string, boolean | undefined> = {};
  for (const key of ["autoCleanupOnMerge", "autoCleanupOnClose"]) {
    if (key in body) {
      const val = body[key];
      patch[key] = typeof val === "boolean" ? val : undefined;
    }
  }
  updateWorktreeSettings(manager.getConfigDir(), resolved.worktreeId, patch);
  return c.json({ success: true });
});
```

Import `loadWorktreeSettings` and `updateWorktreeSettings` from `../worktree-settings`.

- [ ] **Step 3: Verify manager.getConfigDir() exists**

Check that `WorktreeManager` exposes `getConfigDir()` or equivalent. If not, it's `this.configDir` — the route may need to access it via a getter. Add `getConfigDir(): string { return this.configDir; }` to `WorktreeManager` if needed.

- [ ] **Step 4: Verify**

Run: `pnpm check:types`
Expected: Pass

- [ ] **Step 5: Commit**

---

### Task 5: Add frontend API functions

**Files:**

- Modify: `apps/web-app/src/hooks/api.ts`

- [ ] **Step 1: Add fetchWorktreeSettings**

```typescript
export async function fetchWorktreeSettings(
  worktreeId: string,
  serverUrl: string | null = null,
): Promise<{
  success: boolean;
  autoCleanupOnMerge: boolean;
  autoCleanupOnClose: boolean;
  error?: string;
}> {
  try {
    const base = getBaseUrl(serverUrl);
    const res = await fetch(`${base}/api/worktrees/${encodeURIComponent(worktreeId)}/settings`);
    if (!isJsonResponse(res)) {
      return {
        success: false,
        autoCleanupOnMerge: false,
        autoCleanupOnClose: false,
        error: `Server returned ${res.status}`,
      };
    }
    return await res.json();
  } catch (err) {
    return {
      success: false,
      autoCleanupOnMerge: false,
      autoCleanupOnClose: false,
      error: err instanceof Error ? err.message : "Failed to fetch settings",
    };
  }
}
```

- [ ] **Step 2: Add updateWorktreeSettings**

```typescript
export async function updateWorktreeSettings(
  worktreeId: string,
  patch: { autoCleanupOnMerge?: boolean | null; autoCleanupOnClose?: boolean | null },
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const base = getBaseUrl(serverUrl);
    const res = await fetch(`${base}/api/worktrees/${encodeURIComponent(worktreeId)}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!isJsonResponse(res)) {
      return { success: false, error: `Server returned ${res.status}` };
    }
    return await res.json();
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update settings",
    };
  }
}
```

- [ ] **Step 3: Verify**

Run: `pnpm check:types`
Expected: Pass

- [ ] **Step 4: Commit**

---

### Task 6: Add settings dropdown to DetailHeader

**Files:**

- Modify: `apps/web-app/src/components/detail/DetailHeader.tsx`

- [ ] **Step 1: Add imports and props**

Add `Settings2, ChevronDown` from lucide. Add `useQuery, useMutation, useQueryClient` from react-query. Add `fetchWorktreeSettings, updateWorktreeSettings` from api. Add `ToggleSwitch` import.

Add to props interface:

```typescript
/** Server URL for API calls */
serverUrl?: string | null;
```

- [ ] **Step 2: Add the dropdown component**

Inside the component, before the Move to worktree / Delete button, add a settings dropdown:

- State: `const [showSettingsDropdown, setShowSettingsDropdown] = useState(false);`
- Query: `useQuery` for worktree settings, enabled when dropdown is open
- Mutation: `useMutation` for updating settings, invalidates query on success
- Render: a button with Settings2 icon + ChevronDown, positioned with `relative`. Dropdown is `absolute` positioned below.
- Only visible for non-root worktrees (`!isRoot`)
- Two rows with ToggleSwitch: "Auto-delete on PR merge" and "Auto-delete on PR close"
- Click outside / Escape closes dropdown
- Each toggle calls the mutation with the new value

- [ ] **Step 3: Pass serverUrl from DetailPanel**

In `DetailPanel.tsx`, pass `serverUrl={serverUrl}` to `<DetailHeader>` (where `serverUrl` comes from `useServerUrlOptional()`). The `DetailPanel` already has it.

- [ ] **Step 4: Verify**

Run: `pnpm check:types`
Expected: Pass

- [ ] **Step 5: Commit**

---

### Task 7: Final checks

- [ ] **Step 1: Run lint and format**

Run: `pnpm check:lint && pnpm check:format`
Fix any issues.

- [ ] **Step 2: Run all relevant tests**

Run: `cd apps/server && npx vitest run src/__test__/worktree-settings.test.ts`
Run: `cd apps/web-app && npx vitest run src/components/__test__/CreateCustomTaskModal.test.tsx`
Run: `pnpm check:types`
Expected: All pass

- [ ] **Step 3: Update docs**

Update `docs/CONFIGURATION.md` to document `worktree-settings.json`.

- [ ] **Step 4: Commit**
