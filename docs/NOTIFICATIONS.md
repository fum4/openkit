# Notifications & Activity Feed

## Overview

OpenKit has a unified notification system that tracks events across worktrees, agents, git operations, and integrations. Events flow through a central **Activity Log** on the backend and surface in three ways:

1. **Activity Feed** — a dropdown panel in the header (bell icon) showing a scrollable timeline of events
2. **Toast notifications** — ephemeral in-app popups for direct user-action success/failure only
3. **OS notifications** — native desktop notifications (Electron only) when the app is unfocused

The Jira/Linear auto-start flow emits two activity events: one when a new task is detected and one when Claude starts working on it.

Policy: workflow, agent, and live progress updates belong in the Activity feed (and optional OS notifications), not in toasts.

## Architecture

```
ActivityLog (backend)
  │
  ├─ Persists events to disk (.openkit/activity.jsonl)
  ├─ Broadcasts via SSE (/api/events → "activity" messages)
  │     │
  │     ├─ useWorktrees (SSE listener)
  │     │     └─ dispatches CustomEvent "OpenKit:activity" / "OpenKit:activity-history"
  │     │
  │     └─ NotificationManager (Electron)
  │           └─ listens to each project's SSE stream → fires native Notification
  │
  └─ REST endpoint GET /api/activity (polling fallback)
```

### Key Files

| File                                                  | Purpose                                                                                                          |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `libs/shared/src/activity-event.ts`                   | Event types, category/severity enums, config interface, defaults                                                 |
| `apps/server/src/activity-log.ts`                     | `ActivityLog` class — persistence, pub/sub, pruning                                                              |
| `apps/server/src/routes/activity.ts`                  | REST endpoint `GET /api/activity`                                                                                |
| `apps/server/src/routes/events.ts`                    | SSE endpoint — streams `activity` and `activity-history` messages                                                |
| `apps/server/src/manager.ts`                          | Creates `ActivityLog` instance, emits events from worktree lifecycle                                             |
| `libs/agent/src/actions.ts`                           | `notify` MCP action — lets agents send custom activity events                                                    |
| `apps/cli/src/activity.ts`                            | CLI command for terminal agents to emit awaiting-input activity                                                  |
| `apps/web-app/src/components/ActivityFeed.tsx`        | `ActivityFeed` panel + `ActivityBell` button components                                                          |
| `apps/web-app/src/components/detail/TerminalView.tsx` | Agent terminal rendering/session lifecycle (Claude/Codex/Gemini/OpenCode; no heuristic awaiting-input detection) |
| `apps/web-app/src/hooks/useActivityFeed.ts`           | Hook — listens for `OpenKit:activity` CustomEvents, manages state                                                |
| `apps/web-app/src/hooks/useWorktrees.ts`              | SSE client — bridges SSE messages to window CustomEvents                                                         |
| `apps/web-app/src/components/Header.tsx`              | Wires bell + feed panel into the app header                                                                      |
| `apps/web-app/src/App.tsx`                            | Emits task-detected + selected-agent-started activity events for Jira/Linear/local auto-start                    |
| `apps/web-app/src/components/ConfigurationPanel.tsx`  | Notifications settings card (grouped expand/collapse + per-event delivery modes)                                 |
| `apps/desktop-app/src/notification-manager.ts`        | `NotificationManager` — OS-level notifications in Electron                                                       |
| `apps/web-app/src/theme.ts`                           | `activity` theme tokens (category colors + optional severity tokens)                                             |

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

| Category   | Description                                          | Icon      | Color      |
| ---------- | ---------------------------------------------------- | --------- | ---------- |
| `agent`    | Agent connections, notify, git actions, hooks/skills | Bot       | purple-400 |
| `worktree` | Creation, start, stop, crash events                  | GitBranch | teal-400   |
| `system`   | Connection lost/restored, config issues              | Monitor   | red-400    |

### Event Types

Primary event types surfaced in the feed are defined in `ACTIVITY_TYPES` (`libs/shared/src/activity-event.ts`):

| Constant               | Type string            | Category | Description                              |
| ---------------------- | ---------------------- | -------- | ---------------------------------------- |
| `NOTIFY`               | `notify`               | agent    | Agent sends a status update              |
| `COMMIT_COMPLETED`     | `commit_completed`     | agent    | Agent committed successfully             |
| `COMMIT_FAILED`        | `commit_failed`        | agent    | Agent commit failed                      |
| `PUSH_COMPLETED`       | `push_completed`       | agent    | Agent pushed successfully                |
| `PUSH_FAILED`          | `push_failed`          | agent    | Agent push failed                        |
| `PR_CREATED`           | `pr_created`           | agent    | Agent created a PR                       |
| `SKILL_STARTED`        | `skill_started`        | agent    | Hook skill started                       |
| `SKILL_COMPLETED`      | `skill_completed`      | agent    | Hook skill completed                     |
| `SKILL_FAILED`         | `skill_failed`         | agent    | Hook skill failed                        |
| `HOOKS_STARTED`        | `hooks_started`        | agent    | Hook command run started                 |
| `HOOKS_RAN`            | `hooks_ran`            | agent    | Hook pipeline completed                  |
| `AGENT_AWAITING_INPUT` | `agent_awaiting_input` | agent    | Agent is blocked waiting on user input   |
| `TASK_DETECTED`        | `task_detected`        | agent    | Newly fetched Jira/Linear task detected  |
| `AUTO_TASK_CLAIMED`    | `auto_task_claimed`    | agent    | Selected agent auto-started for the task |
| `WORKFLOW_PHASE`       | `workflow_phase`       | agent    | Agent workflow phase transition          |
| `CREATION_STARTED`     | `creation_started`     | worktree | Worktree creation started                |
| `CREATION_COMPLETED`   | `creation_completed`   | worktree | Worktree created successfully            |
| `CREATION_FAILED`      | `creation_failed`      | worktree | Worktree creation failed                 |
| `WORKTREE_STARTED`     | `started`              | worktree | Dev server started                       |
| `WORKTREE_STOPPED`     | `stopped`              | worktree | Dev server stopped                       |
| `WORKTREE_CRASHED`     | `crashed`              | worktree | Dev server crashed (non-zero exit)       |
| `CONNECTION_LOST`      | `connection_lost`      | system   | Lost connection                          |
| `CONNECTION_RESTORED`  | `connection_restored`  | system   | Connection restored                      |
| `CONFIG_NEEDS_PUSH`    | `config_needs_push`    | system   | Config changes need push                 |

`agent_connected` and `agent_disconnected` remain in the constants map but are not currently emitted.

### Severities

| Severity  | Usage                            |
| --------- | -------------------------------- |
| `info`    | Default — neutral status updates |
| `success` | Successful completions           |
| `warning` | Non-critical issues              |
| `error`   | Failures and crashes             |

Feed row dots are an unseen marker only (teal), not severity-coded.

## Backend: ActivityLog

`ActivityLog` (`apps/server/src/activity-log.ts`) is the central backend class. It's created by `WorktreeManager` and stored as `this.activityLog`.

### Storage

Events are persisted as newline-delimited JSON (NDJSON) in `.openkit/activity.jsonl`. Each line is one `ActivityEvent` JSON object.

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
  disabledEvents: string[]; // event types to suppress entirely
  toastEvents?: string[]; // legacy compatibility field
  osNotificationEvents: string[]; // default event list kept in activity config
}
```

Toasts are intentionally not activity-driven by policy. Use them only for direct user-action success/failure (for example save/create/retry outcomes).

`toastEvents` may still appear in older configs for compatibility, but new workflow/agent/live event types should not be routed to toasts.

Default OS notification events in config: `agent_awaiting_input`

Configuration is stored in the project config under the `activity` key and can be updated through the Settings view.

## API

### REST: `GET /api/activity`

Query parameters:

| Param      | Type            | Description                                        |
| ---------- | --------------- | -------------------------------------------------- |
| `since`    | ISO 8601 string | Only return events after this timestamp            |
| `category` | string          | Filter by category (`agent`, `worktree`, `system`) |
| `limit`    | number          | Max events to return (default: 100)                |

Response: `{ events: ActivityEvent[] }` — sorted newest first.

### REST: `POST /api/activity`

Creates an activity event and broadcasts it over SSE. The UI uses this for app-level events such as `task_detected` and `auto_task_claimed` in Jira/Linear auto-start flows.

### SSE: `GET /api/events`

The existing SSE endpoint streams activity events alongside worktree updates. Messages relevant to notifications:

| `type` field       | Payload                                                 | Description                               |
| ------------------ | ------------------------------------------------------- | ----------------------------------------- |
| `activity`         | `{ type: "activity", event: ActivityEvent }`            | Single new event                          |
| `activity-history` | `{ type: "activity-history", events: ActivityEvent[] }` | Last 50 events sent on initial connection |

## Frontend

### SSE → CustomEvent Bridge

`useWorktrees` (`apps/web-app/src/hooks/useWorktrees.ts`) is the SSE client. When it receives `activity` or `activity-history` messages, it dispatches window-level CustomEvents:

- `OpenKit:activity` — `detail` is a single `ActivityEvent`
- `OpenKit:activity-history` — `detail` is an `ActivityEvent[]`

This decouples the activity feed from the SSE connection hook.

### useActivityFeed Hook

`useActivityFeed` (`apps/web-app/src/hooks/useActivityFeed.ts`) listens for those CustomEvents and manages:

- **Event list** — up to 200 events, strictly sorted newest-first.
- **Group-key upserts** — events with the same `groupKey` replace prior events (e.g. creation started → creation completed).
- **Hook group aggregation** — hook-related events (`hooks_started`, `hooks_ran`, `skill_*`) with `groupKey` `hooks:{worktreeId}:{trigger}` are merged into a single expandable feed entry with live child statuses for commands/skills.
- **Unread count** — increments on each new event, resets on `markAllRead()`.
- **Feed-only workflow routing** — workflow/agent/live updates stay in the activity timeline.
- **Per-event suppression** — events listed in `activity.disabledEvents` are filtered out.

Returns: `{ events, unreadCount, markAllRead, clearAll }`

### ActivityFeed Component

`ActivityFeed` (`apps/web-app/src/components/ActivityFeed.tsx`) renders the dropdown panel:

- **Header** titled "Recent activity", with "Mark read" (only when unread > 0), "Clear", and a `Show all projects` toggle
- **Filter chips** — multi-select chips directly below the header: `Worktree`, `Hooks`, `Agents`, and `System`. Multiple chips can be enabled simultaneously; when none are selected, all events are shown.
- **Action-required section** — top section for active agent contexts whose latest event requires user action (`agent_awaiting_input` or `metadata.requiresUserAction === true`)
  - Uses explicit flags only (`agent_awaiting_input` with `requiresUserAction/awaitingUserInput`, or `metadata.requiresUserAction === true`), not keyword heuristics.
- **Event list** — each item shows icon, title, optional detail, relative timestamp, project name (if present), clickable issue ID/worktree ID, and an unseen teal dot when applicable
- **Row-level subject navigation** — clicking a row navigates to its primary subject (issue, worktree, or Claude context). Hook-related rows with a worktree target open that worktree's **Hooks** tab.
- **Inline link override** — clicking the inline worktree ID link always opens the worktree itself (default worktree navigation), even when row click would open a specific tab like Hooks.
- **Integration icon override** — Jira/Linear task events render integration-specific icons
- **Hook rows** — hook-related events use a hook icon and can expand inline to show child command/skill statuses with spinner/check/X icons
- **Empty state** — shows "No recent activity" with a sleep icon
- Closes on outside click or Escape key
- Animated with `motion/react` (fade + scale)
- Accepts `onNavigateToWorktree` and `onNavigateToIssue` props for link navigation

### ActivityBell Component

`ActivityBell` renders the bell icon button in the header with:

- Unread badge (teal background, shows count up to 99+)
- Active state when feed is open

### Wiring in Header

`Header` (`apps/web-app/src/components/Header.tsx`) composes everything:

1. Creates `useActivityFeed` for timeline state (events, upserts, unread count)
2. Renders `ActivityBell` in the top-right
3. Renders an **Input needed** badge to the left of the bell when the latest agent event for a project/worktree context is awaiting user input
4. Badge text is singular/plural by pending count: "Agent awaits your input" (1) or "Agents await your input" (2+), and it includes a numeric count pill
5. If multiple contexts are pending, clicking the badge opens a dropdown with all pending contexts
6. Clicking an awaiting-input item acknowledges it immediately (posts a clearing event for that context)
7. If a single context is pending, clicking the badge tries to navigate directly to that worktree's Claude tab; if navigation is unavailable, a helper popover explains where to go
8. Conditionally renders `ActivityFeed` in an `AnimatePresence` wrapper
9. Passes `onNavigateToWorktree` and `onNavigateToIssue` through to `ActivityFeed`
10. Passes disabled event types from config into `useActivityFeed`
11. Tracks selected activity feed filter groups and passes them to `ActivityFeed` (multi-select with clear-all behavior)
12. Auto-marks events as read 500ms after opening the feed
13. Tracks `seenEventIds` per visible event set and only renders row dots for unseen events

### Toast System

`ToastContainer` (`apps/web-app/src/components/Toast.tsx`) renders toast notifications. Accepts an `onNavigateToWorktree` prop (wired from App.tsx).

Toast features:

- **Project name** — shown as a small label above the message when present
- **Worktree link** — "Go to worktree →" link that navigates to the worktree
- **Auto-dismiss** — 5s for success/info, 10s for errors; loading toasts persist until resolved

Toast scope policy: show toasts only for direct user-initiated action outcomes (success/failure). Activity events like auto-claims, agent progress, and hook lifecycle updates stay in the Activity feed.

### Hook Progress Presentation

Hook progress is shown only in the Activity feed as a single expandable notification per hook run (`groupKey = hooks:{worktreeId}:{trigger}`), with live child statuses for commands and skills. Hook-specific toasts are intentionally suppressed.

### Settings UI

The Configuration panel (`apps/web-app/src/components/ConfigurationPanel.tsx`) includes a grouped "Notifications" card:

- Groups (`Worktree`, `Agent`, `System`) are collapsed by default and expandable
- Group header mode applies to all events in that group: `Off`, `In-app`, `In-app + desktop`
- Group mode shows `Mixed` when child events differ; `Mixed` is display-only and not directly selectable
- Child event modes use the same three delivery options
- `Off` disables both in-app and desktop delivery for that event

## Electron: Native OS Notifications

`NotificationManager` (`apps/desktop-app/src/notification-manager.ts`) provides OS-level notifications when the Electron app is **unfocused**.

### How It Works

1. On project list changes, `syncProjectStreams()` is called
2. For each running project, it opens an SSE connection to `http://localhost:{port}/api/events`
3. Incoming `activity` events are checked for explicit agent-attention state
4. If the main window is unfocused and the event qualifies, a native `Notification` is fired

### OS Notification Events

Native notifications are shown only for agent attention events:

- `category: "agent"` and `type: "agent_awaiting_input"`, or
- `category: "agent"` with `metadata.requiresUserAction === true` or `metadata.awaitingUserInput === true`

This suppresses worktree lifecycle/skill OS popups and keeps native alerts focused on user action requests.

### Debouncing

Max one notification per 10 seconds per project to avoid notification spam.

### Reconnection

If an SSE connection drops, it reconnects after 5 seconds (only if the project is still running).

### Click Behavior

Clicking a native notification brings the main window to focus.

## MCP: notify Action

Agents can send custom activity events via the `notify` MCP tool (`libs/agent/src/actions.ts`):

```js
notify({
  message: "Need clarification on acceptance criteria",
  severity: "warning",
  worktreeId: "PROJ-123",
  requiresUserAction: true,
});
```

| Param                | Required | Description                                                   |
| -------------------- | -------- | ------------------------------------------------------------- |
| `message`            | yes      | Status message (becomes `event.title`)                        |
| `severity`           | no       | `info` (default), `success`, `warning`, `error`               |
| `worktreeId`         | no       | Related worktree ID                                           |
| `requiresUserAction` | no       | When `true`, event appears in the top action-required section |

`notify` always creates `category: "agent"` events.

When `requiresUserAction` is true, `notify` emits `type: "agent_awaiting_input"` and sets `metadata.requiresUserAction=true`, so it appears in the action-required section and activates the header badge.

## CLI: Awaiting User Input

Terminal-first agents (not connected through MCP) can emit the same special notification via CLI:

```bash
openkit activity await-input --message "Need approval to run migration"
```

This posts `agent_awaiting_input` to `/api/activity` using the running project's `.openkit/server.json` discovery.

Agent terminal tabs do not infer awaiting-input state from terminal text. Awaiting-input events should be emitted explicitly by the agent (`notify` with `requiresUserAction: true` in MCP flow, or `openkit activity await-input` in terminal flow).

When a worktree is removed, OpenKit also emits a clearing `notify` event for that worktree's `agent-awaiting-input:{worktreeId}` group, so stale "agent needs input" indicators are dismissed automatically.

Clicking an awaiting-input badge/dropdown item (or action-required link in Activity feed) also emits a clearing event for that same context/group, so the indicator clears as soon as the user acknowledges it.

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

Activity-specific tokens in `apps/web-app/src/theme.ts`:

```typescript
export const activity = {
  categoryColor: {
    agent: "text-purple-400",
    worktree: "text-teal-400",
    system: "text-red-400",
  },
  categoryBg: {
    agent: "bg-purple-400/10",
    worktree: "bg-teal-400/10",
    system: "bg-red-400/10",
  },
  severityDot: {
    success: "bg-emerald-400",
    warning: "bg-amber-400",
    error: "bg-red-400",
  },
};
```

`severityDot` remains available in theme tokens, but activity rows currently use an unseen teal dot instead of severity-based dots.
