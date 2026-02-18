# Notifications & Activity Feed

## Overview

dawg has a unified notification system that tracks events across worktrees, agents, git operations, and integrations. Events flow through a central **Activity Log** on the backend and surface in three ways:

1. **Activity Feed** — a dropdown panel in the header (bell icon) showing a scrollable timeline of events
2. **Toast notifications** — ephemeral in-app popups for high-priority events
3. **OS notifications** — native desktop notifications (Electron only) when the app is unfocused

## Architecture

```
ActivityLog (backend)
  │
  ├─ Persists events to disk (.dawg/activity.json)
  ├─ Broadcasts via SSE (/api/events → "activity" messages)
  │     │
  │     ├─ useWorktrees (SSE listener)
  │     │     └─ dispatches CustomEvent "dawg:activity" / "dawg:activity-history"
  │     │
  │     └─ NotificationManager (Electron)
  │           └─ listens to each project's SSE stream → fires native Notification
  │
  └─ REST endpoint GET /api/activity (polling fallback)
```

### Key Files

| File                                       | Purpose                                                              |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `src/server/activity-event.ts`             | Event types, category/severity enums, config interface, defaults     |
| `src/server/activity-log.ts`               | `ActivityLog` class — persistence, pub/sub, pruning                  |
| `src/server/routes/activity.ts`            | REST endpoint `GET /api/activity`                                    |
| `src/server/routes/events.ts`              | SSE endpoint — streams `activity` and `activity-history` messages    |
| `src/server/manager.ts`                    | Creates `ActivityLog` instance, emits events from worktree lifecycle |
| `src/actions.ts`                           | `notify` MCP action — lets agents send custom activity events        |
| `src/ui/components/ActivityFeed.tsx`       | `ActivityFeed` panel + `ActivityBell` button components              |
| `src/ui/hooks/useActivityFeed.ts`          | Hook — listens for `dawg:activity` CustomEvents, manages state       |
| `src/ui/hooks/useWorktrees.ts`             | SSE client — bridges SSE messages to window CustomEvents             |
| `src/ui/components/Header.tsx`             | Wires bell + feed panel into the app header                          |
| `src/ui/components/ConfigurationPanel.tsx` | Notifications settings card (toast event toggles)                    |
| `electron/notification-manager.ts`         | `NotificationManager` — OS-level notifications in Electron           |
| `src/ui/theme.ts`                          | `activity` theme tokens (category colors, severity dots)             |

## Activity Events

### Event Shape

```typescript
interface ActivityEvent {
  id: string; // nanoid
  timestamp: string; // ISO 8601
  category: ActivityCategory;
  type: string; // e.g. "creation_completed", "notify"
  severity: ActivitySeverity;
  title: string; // human-readable message
  detail?: string; // optional secondary line
  worktreeId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
  groupKey?: string; // groups related events (e.g. creation_started → creation_completed)
}
```

### Categories

| Category      | Description                                                        | Icon      | Color      |
| ------------- | ------------------------------------------------------------------ | --------- | ---------- |
| `agent`       | Agent connections, notify, commits, pushes, PRs, skills, hooks     | Bot       | purple-400 |
| `worktree`    | Creation, start, stop, crash events                                | GitBranch | teal-400   |
| `git`         | PR merged, checks passed/failed, review requested, behind upstream | GitBranch | blue-400   |
| `integration` | Issue assigned                                                     | Link      | amber-400  |
| `system`      | Connection lost/restored, config issues                            | Monitor   | red-400    |

### Event Types

All event type constants are defined in `ACTIVITY_TYPES` (`src/server/activity-event.ts`):

| Constant              | Type string           | Category    | Description                        |
| --------------------- | --------------------- | ----------- | ---------------------------------- |
| `AGENT_CONNECTED`     | `agent_connected`     | agent       | Agent connects via MCP             |
| `AGENT_DISCONNECTED`  | `agent_disconnected`  | agent       | Agent disconnects                  |
| `NOTIFY`              | `notify`              | agent       | Agent sends a status update        |
| `COMMIT_COMPLETED`    | `commit_completed`    | agent       | Agent committed successfully       |
| `COMMIT_FAILED`       | `commit_failed`       | agent       | Agent commit failed                |
| `PUSH_COMPLETED`      | `push_completed`      | agent       | Agent pushed successfully          |
| `PUSH_FAILED`         | `push_failed`         | agent       | Agent push failed                  |
| `PR_CREATED`          | `pr_created`          | agent       | Agent created a PR                 |
| `SKILL_STARTED`       | `skill_started`       | agent       | Hook skill started                 |
| `SKILL_COMPLETED`     | `skill_completed`     | agent       | Hook skill completed               |
| `SKILL_FAILED`        | `skill_failed`        | agent       | Hook skill failed                  |
| `HOOKS_RAN`           | `hooks_ran`           | agent       | Hook pipeline completed            |
| `CREATION_STARTED`    | `creation_started`    | worktree    | Worktree creation started          |
| `CREATION_COMPLETED`  | `creation_completed`  | worktree    | Worktree created successfully      |
| `CREATION_FAILED`     | `creation_failed`     | worktree    | Worktree creation failed           |
| `WORKTREE_STARTED`    | `started`             | worktree    | Dev server started                 |
| `WORKTREE_STOPPED`    | `stopped`             | worktree    | Dev server stopped                 |
| `WORKTREE_CRASHED`    | `crashed`             | worktree    | Dev server crashed (non-zero exit) |
| `PR_MERGED`           | `pr_merged`           | git         | Pull request merged                |
| `CHECKS_FAILED`       | `checks_failed`       | git         | CI checks failed                   |
| `CHECKS_PASSED`       | `checks_passed`       | git         | CI checks passed                   |
| `REVIEW_REQUESTED`    | `review_requested`    | git         | Review requested on PR             |
| `BEHIND_UPSTREAM`     | `behind_upstream`     | git         | Branch is behind upstream          |
| `ISSUE_ASSIGNED`      | `issue_assigned`      | integration | Issue assigned to user             |
| `CONNECTION_LOST`     | `connection_lost`     | system      | Lost connection                    |
| `CONNECTION_RESTORED` | `connection_restored` | system      | Connection restored                |
| `CONFIG_NEEDS_PUSH`   | `config_needs_push`   | system      | Config changes need push           |

### Severities

| Severity  | Dot color   | Usage                            |
| --------- | ----------- | -------------------------------- |
| `info`    | none        | Default — neutral status updates |
| `success` | emerald-400 | Successful completions           |
| `warning` | amber-400   | Non-critical issues              |
| `error`   | red-400     | Failures and crashes             |

## Backend: ActivityLog

`ActivityLog` (`src/server/activity-log.ts`) is the central backend class. It's created by `WorktreeManager` and stored as `this.activityLog`.

### Storage

Events are persisted as newline-delimited JSON (NDJSON) in `.dawg/activity.json`. Each line is one `ActivityEvent` JSON object.

### Pub/Sub

`ActivityLog` maintains an in-memory set of listeners. When `addEvent()` is called:

1. The event is appended to the NDJSON file
2. All registered listeners are notified synchronously

Listeners are registered via `subscribe(callback)`, which returns an unsubscribe function.

### Pruning

Events older than `retentionDays` (default: 7) are automatically pruned:

- On startup
- Every hour via `setInterval`

### Category Filtering

Each category can be individually enabled/disabled via config. Disabled categories are silently dropped in `addEvent()` — the event is returned but not persisted or broadcast.

### Configuration

```typescript
interface ActivityConfig {
  retentionDays: number; // default: 7
  categories: Record<ActivityCategory, boolean>; // all true by default
  toastEvents: string[]; // events that trigger toast popups
  osNotificationEvents: string[]; // events that trigger OS notifications
}
```

Default toast events: `creation_started`, `creation_completed`, `creation_failed`, `skill_started`, `skill_completed`, `skill_failed`, `crashed`, `connection_lost`

Default OS notification events: `creation_completed`, `skill_failed`, `pr_merged`, `crashed`

Configuration is stored in the project config under the `activity` key and can be updated through the Settings view.

## API

### REST: `GET /api/activity`

Query parameters:

| Param      | Type            | Description                                                              |
| ---------- | --------------- | ------------------------------------------------------------------------ |
| `since`    | ISO 8601 string | Only return events after this timestamp                                  |
| `category` | string          | Filter by category (`agent`, `worktree`, `git`, `integration`, `system`) |
| `limit`    | number          | Max events to return (default: 100)                                      |

Response: `{ events: ActivityEvent[] }` — sorted newest first.

### SSE: `GET /api/events`

The existing SSE endpoint streams activity events alongside worktree updates. Messages relevant to notifications:

| `type` field       | Payload                                                 | Description                               |
| ------------------ | ------------------------------------------------------- | ----------------------------------------- |
| `activity`         | `{ type: "activity", event: ActivityEvent }`            | Single new event                          |
| `activity-history` | `{ type: "activity-history", events: ActivityEvent[] }` | Last 50 events sent on initial connection |

## Frontend

### SSE → CustomEvent Bridge

`useWorktrees` (`src/ui/hooks/useWorktrees.ts`) is the SSE client. When it receives `activity` or `activity-history` messages, it dispatches window-level CustomEvents:

- `dawg:activity` — `detail` is a single `ActivityEvent`
- `dawg:activity-history` — `detail` is an `ActivityEvent[]`

This decouples the activity feed from the SSE connection hook.

### useActivityFeed Hook

`useActivityFeed` (`src/ui/hooks/useActivityFeed.ts`) listens for those CustomEvents and manages:

- **Event list** — up to 200 events, newest first, deduplicated by `id`. Events with the same `groupKey` replace each other (e.g. `creation_started` is replaced by `creation_completed`)
- **Unread count** — increments on each new event, resets on `markAllRead()`
- **Category filter** — optional filter applied to the returned `events`
- **Toast triggering** — when an incoming event's type is in the `toastEvents` list:
  - Skill events (`skill_started`/`skill_completed`/`skill_failed`) with `metadata.trigger` are routed to `onUpsertGroupedToast` — these produce a single toast per trigger phase with expandable children
  - Other events with a `groupKey` call `onUpsertToast` to replace existing toasts in the same group (loading → success/failure)
  - Events without a `groupKey` call the basic `onToast` callback
  - Event types ending in `_started` are treated as loading (spinner icon, no auto-dismiss)
  - All toast callbacks receive `projectName` and `worktreeId` from the event for display

Returns: `{ events, allEvents, unreadCount, filter, setFilter, markAllRead, clearAll }`

### ActivityFeed Component

`ActivityFeed` (`src/ui/components/ActivityFeed.tsx`) renders the dropdown panel:

- **Header** with "Mark read" and "Clear" buttons
- **Filter chips** — All, Agent, Worktree
- **Event list** — each item shows a category icon (color-coded), title, optional detail, relative timestamp, project name (if present), clickable worktree ID (navigates to worktree), and a severity dot for non-info events
- Closes on outside click or Escape key
- Animated with `motion/react` (fade + scale)
- Accepts `onNavigateToWorktree` prop for worktree link navigation

### ActivityBell Component

`ActivityBell` renders the bell icon button in the header with:

- Unread badge (teal background, shows count up to 99+)
- Active state when feed is open

### Wiring in Header

`Header` (`src/ui/components/Header.tsx`) composes everything:

1. Creates `useActivityFeed` with `handleToast`, `handleUpsertToast`, `handleUpsertGroupedToast`, and config-driven `toastEvents`
2. Renders `ActivityBell` in the top-right
3. Conditionally renders `ActivityFeed` in an `AnimatePresence` wrapper
4. Passes `onNavigateToWorktree` through to `ActivityFeed`
5. Auto-marks events as read 500ms after opening the feed

### Toast System

`ToastContainer` (`src/ui/components/Toast.tsx`) renders toast notifications. Accepts an `onNavigateToWorktree` prop (wired from App.tsx).

Toast features:

- **Project name** — shown as a small label above the message when present
- **Worktree link** — "Go to worktree →" link that navigates to the worktree
- **Grouped children** — skill toasts are grouped by trigger phase (one toast per `hooks:{worktreeId}:{trigger}`), with expandable children showing individual skill results (status icon + name)
- **Auto-dismiss** — 5s for success/info, 10s for errors; loading toasts persist until resolved

### Grouped Hook Toasts

When hooks run, skill events share a `groupKey` of `hooks:{worktreeId}:{trigger}`. The `upsertGroupedToast` method in `ToastContext` aggregates these into a single parent toast with expandable children:

- Parent message: "Running hooks (2/3)..." → "3 hooks completed"
- Each child: spinner/check/X icon + skill name + status
- Chevron toggle to expand/collapse the children list

### Settings UI

The Configuration panel (`src/ui/components/ConfigurationPanel.tsx`) includes a "Notifications" card where users can toggle which event types trigger toasts. Events are grouped by category (Worktree, Agent, Git, Integration, System) with color-coded headers matching the activity feed colors. Each event is a pill button that toggles the event type in/out of `config.activity.toastEvents`.

All event types are toggleable — every type from `ACTIVITY_TYPES` has a corresponding toggle (except `config_needs_push` which is internal).

## Electron: Native OS Notifications

`NotificationManager` (`electron/notification-manager.ts`) provides OS-level notifications when the Electron app is **unfocused**.

### How It Works

1. On project list changes, `syncProjectStreams()` is called
2. For each running project, it opens an SSE connection to `http://localhost:{port}/api/events`
3. Incoming `activity` events are checked against `OS_NOTIFICATION_EVENTS`
4. If the main window is unfocused and the event qualifies, a native `Notification` is fired

### OS Notification Events

Hardcoded set: `creation_completed`, `creation_failed`, `skill_failed`, `pr_merged`, `crashed`

### Debouncing

Max one notification per 10 seconds per project to avoid notification spam.

### Reconnection

If an SSE connection drops, it reconnects after 5 seconds (only if the project is still running).

### Click Behavior

Clicking a native notification brings the main window to focus.

## MCP: notify Action

Agents can send custom activity events via the `notify` MCP tool (`src/actions.ts`):

```
notify({ message: "Analyzing codebase structure", severity: "info", worktreeId: "PROJ-123" })
```

| Param        | Required | Description                                     |
| ------------ | -------- | ----------------------------------------------- |
| `message`    | yes      | Status message (becomes `event.title`)          |
| `severity`   | no       | `info` (default), `success`, `warning`, `error` |
| `worktreeId` | no       | Related worktree ID                             |

The event is created with `category: "agent"` and `type: "notify"`.

Other MCP actions (`commit`, `push`, `create_pr`, `run_hooks`, `report_hook_status`) automatically emit their own activity events — agents don't need to call `notify` for those.

### projectName on Events

All activity events include `projectName` when available. Manager events use `this.activityProjectName()` (a private helper that calls `this.getProjectName() ?? undefined`). MCP events extract `projectName` once at the top of `createMcpServer`. The `report_hook_status` handler in `actions.ts` also sets `projectName`.

### Skill Event Metadata

Skill events (`skill_started`, `skill_completed`, `skill_failed`) from `report_hook_status` include:

- `metadata.trigger` — the hook trigger phase (`pre-implementation`, `post-implementation`, `custom`, `on-demand`)
- `metadata.skillName` — the skill name
- `metadata.filePath` — path to the report file (completion events only)
- `groupKey` — `hooks:{worktreeId}:{trigger}` (groups all skills in the same trigger phase)

The duplicate `emitHookStatusActivity` function in `mcp-server-factory.ts` has been removed — the `report_hook_status` handler in `actions.ts` handles all skill event emission.

## Theme Tokens

Activity-specific tokens in `src/ui/theme.ts`:

```typescript
export const activity = {
  categoryColor: {
    agent: "text-purple-400",
    worktree: "text-teal-400",
    git: "text-blue-400",
    integration: "text-amber-400",
    system: "text-red-400",
  },
  categoryBg: {
    agent: "bg-purple-400/10",
    worktree: "bg-teal-400/10",
    git: "bg-blue-400/10",
    integration: "bg-amber-400/10",
    system: "bg-red-400/10",
  },
  severityDot: {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
  },
};
```
