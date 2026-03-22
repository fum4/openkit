# Frontend Architecture

## Overview

The OpenKit frontend is a React single-page application built with TypeScript, Tailwind CSS, React Query, and Framer Motion. Vite bundles it into `apps/web-app/dist/`, which the Hono backend serves as static files. The UI connects to the backend via REST API calls, Server-Sent Events (SSE) for real-time worktree status, and WebSockets for interactive terminal sessions.

The app operates in two modes:

- **Web mode** (single-project) -- served directly by the OpenKit server, uses relative URLs for API calls.
- **Electron mode** (multi-project) -- each project runs its own server instance; the app manages multiple projects with a tab bar and routes API calls to the active project's server URL.

---

## Tech Stack

| Technology           | Purpose                                    |
| -------------------- | ------------------------------------------ |
| React 18+            | UI framework with TypeScript               |
| Tailwind CSS         | Utility-first styling (dark theme)         |
| TanStack React Query | Data fetching and caching for issues       |
| Framer Motion        | Page transitions and list animations       |
| xterm.js             | Terminal emulation in the browser          |
| Vite                 | Build tool and dev server for the frontend |
| Lucide React         | Utility icon library                       |

### Icon System

- Frontend icon assets live in `apps/web-app/src/icons/` as `.svg` or `.png` files.
- `apps/web-app/src/icons/index.tsx` is the single icon component entrypoint for the UI.
- Each icon asset should have one exported icon component in `apps/web-app/src/icons/index.tsx`.
- SVG assets are imported as `*.svg?raw` and rendered through the shared SVG wrapper in `apps/web-app/src/icons/index.tsx` so sizing and bounds stay consistent across icons.
- `FinderIcon` intentionally uses `finder.png`; PNG assets are still wrapped as icon components in `apps/web-app/src/icons/index.tsx`.
- UI components must import icons from `apps/web-app/src/icons/index.tsx` (for example `import { GitHubIcon } from "../icons"`).
- Do not import raw `.svg`/`.png` files directly in feature components; raw asset imports are allowed only inside `apps/web-app/src/icons/index.tsx`.

---

## View System

The application has six top-level views, defined as the `View` type in `apps/web-app/src/components/NavBar.tsx`:

```typescript
type View = "workspace" | "agents" | "activity" | "hooks" | "configuration" | "integrations";
```

### Workspace

The main view. Displays a two-panel layout: a sidebar with worktree and issue lists on the left, and a context-dependent detail panel on the right. This is where users create, start, stop, and manage worktrees and their associated issues.

### Agents

Manages custom agents, plugin agents, MCP servers, skills, and plugins. This is the hub for configuring agent tooling -- creating custom registry-backed agents (`~/.openkit/agents/*.md`) and deploying them to Claude/Cursor/Gemini CLI/VS Code/Codex, browsing plugin-provided `agents/*.md` definitions, registering MCP servers, creating/deploying skills, and managing Claude plugins.
On initial load, Agents triggers a background device scan for MCP servers/skills/custom-agents and shows a discovery banner with quick `Scan again` and `Import` actions when items are found. If opened from that banner, the import dialog reuses the already-scanned results (no second scan).
The Agents list is cache-first: sidebar items render immediately from local cache and then refresh in the background (with a loading spinner shown during refresh).

### Activity

Shows project-scoped activity timelines using the same feed rows/filters/actions as the bell dropdown. In Electron multi-project mode, the page renders one card per open project, ordered with the active project first, in a responsive wrapping grid (`minmax(500px, 1fr)`) constrained to viewport height (equal-height rows, per-card internal scrolling). Running projects stream live events over SSE per project, and non-running projects render an unavailable state card.

Inside each `Activity` project card, a `Debug` toggle switches that card between the normal activity feed and a debug-log mode. Debug-log mode streams structured operational events for command executions (`execFile`, `execFileSync`, `spawn`), inbound API requests, outbound integration/network requests (`fetch`), task/terminal/worktree lifecycle internals, notification emissions, and client-reported error toasts, with per-project search plus dropdown filters for severity (`error`, `warning`, `info`, `debug`), type (`HTTP`, `Git`, `Terminal`, `Other`), and surface (`Internal`, `Notification`, `Toast`). Command events with the same `runId` are consolidated into a single row: the initial execute state is replaced in-place by final `success`/`failed` status and includes duration/output metadata when available. HTTP entries show status-code chips (green for success, red for failure), transport tags (`SSE`/`WS` when detected), and stacked `Request`/`Response` payload panels (collapsed to five lines and expandable on click) when available, each with a top-right copy action powered by the reusable `PayloadCopyButton` component, while non-HTTP command rows collapse titles to the command binary (for example `git`) with a leading terminal icon. Both normal activity lists and debug log lists show a floating circular back-to-top action after scrolling down. The `Debug` toggle state is persisted per project scope.

### Hooks

Configures automated checks and agent skills organized by trigger type (pre-implementation, post-implementation, custom, on-demand, worktree-created, worktree-removed). Users can add command steps, prompt steps, and skills in all sections, including lifecycle triggers.

### Configuration

Edits the `.openkit/config.json` settings: start commands, install commands, base branch, port discovery, environment variable mappings, and agent policy defaults.

### Performance

Real-time performance monitoring dashboard showing CPU and memory usage for the OpenKit server, worktree dev servers, child processes, and agent sessions. Uses a dedicated SSE endpoint (`/api/perf/stream`) that activates on-demand when the page is viewed. Features expandable worktree cards with process tree breakdown, inline CPU/memory gauges with color thresholds (green < 50%, orange 50-80%, red > 80%), and a system summary card. Components: `PerformancePage`, `SystemSummaryCard`, `WorktreeCard`, `ProcessRow`, `CpuBar`, `MemoryBar`. Hook: `usePerformanceMetrics`.

### Integrations

Configures external service connections: Jira (OAuth credentials, project key, refresh interval), Linear (API key, team key), and GitHub (CLI installation, authentication). Jira/Linear cards include an "Auto-start agent" section where users choose Claude/Codex/Gemini/OpenCode and configure toggles for enablement, skip-permissions mode, and optional terminal auto-focus.

Workspace UI state is persisted per project scope. In Electron mode, keys are scoped by stable `project.id` (not `serverUrl`) so state does not bleed when ports change or are reused. In web mode, keys remain scoped by `serverUrl`.

---

## Theme System

**All colors are centralized in `apps/web-app/src/theme.ts`.** Components must import from this file instead of hardcoding Tailwind color classes. This makes it possible to adjust the entire visual appearance from a single location.

### How It Works

Theme exports are objects whose values are Tailwind class fragments. Components interpolate them into `className` strings:

```typescript
import { surface, text, border } from '../../theme';

<div className={`${surface.panel} ${text.primary} border ${border.subtle}`}>
```

### Color Palette

The app uses a dark theme with a neutral slate background family and teal as the primary accent:

| Token    | Hex       | Usage                             |
| -------- | --------- | --------------------------------- |
| `bg0`    | `#0c0e12` | Page background                   |
| `bg1`    | `#12151a` | Panel backgrounds                 |
| `bg2`    | `#1a1e25` | Elevated surfaces (cards, modals) |
| `bg3`    | `#242930` | Input fields, pressed states      |
| `accent` | `#2dd4bf` | Primary accent (teal-400)         |

### Theme Token Categories

| Export        | Purpose                                                                                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `palette`     | Raw hex/rgba color values                                                                                                                                      |
| `surface`     | Background classes for page, panels, modals, overlays                                                                                                          |
| `border`      | Border classes (subtle, section, modal, input, accent, focus)                                                                                                  |
| `input`       | Input field backgrounds, text, placeholder, ring styles                                                                                                        |
| `text`        | Text hierarchy: primary, secondary, muted, dimmed, error                                                                                                       |
| `status`      | Worktree status indicators (running, stopped, creating, deleting)                                                                                              |
| `action`      | Ghost-style action button colors (start, stop, delete, commit, push, PR)                                                                                       |
| `button`      | Filled button variants (primary, secondary, confirm/destructive)                                                                                               |
| `tab`         | Tab active/inactive styles                                                                                                                                     |
| `badge`       | Integration and status badge colors                                                                                                                            |
| `integration` | Per-integration accent colors (jira=blue, linear=indigo, localIssue=amber, worktree=teal, mcp=purple)                                                          |
| `header`      | Header bar specific styles                                                                                                                                     |
| `nav`         | Navigation bar active/inactive styles                                                                                                                          |
| `settings`    | Configuration panel label/description/card styles                                                                                                              |
| `detailTab`   | Detail panel tab (Logs/Terminal/Hooks) active/inactive styles                                                                                                  |
| `errorBanner` | Error banner backgrounds and borders                                                                                                                           |
| `infoBanner`  | Informational banner (teal accent) styles                                                                                                                      |
| `customTask`  | Custom task accent, badge, button, status, priority, and label colors                                                                                          |
| `skill`       | Skill accent (pink) and badge styles                                                                                                                           |
| `plugin`      | Plugin accent (warm copper) and badge styles                                                                                                                   |
| `mcpServer`   | MCP server accent (purple), deployment status dot colors                                                                                                       |
| `hooks`       | Hooks accent (emerald), step result status colors                                                                                                              |
| `shortcut`    | Keyboard shortcut editor styles: key-cap backgrounds, active-recording highlight, reset/save action colors                                                     |
| `notes`       | Notes tab styles, todo checkbox colors                                                                                                                         |
| `agentRule`   | Agent rule accent (cyan), background, border styles                                                                                                            |
| `activity`    | Activity feed category colors (agent=purple, worktree=teal, system=red), agent-variant icon backgrounds (Codex green tint), and optional severity token colors |

### Integration Color Mapping

Each entity type has a consistent accent color used across the entire UI:

- **Worktree** -- teal (`#2dd4bf`)
- **Jira** -- blue (`text-blue-400`)
- **Linear** -- indigo (`#5E6AD2`)
- **Custom Task / Local Issue** -- amber (`text-amber-400`)
- **MCP Server** -- purple (`text-purple-400`)
- **Skill** -- pink (`text-pink-400`)
- **Plugin** -- warm copper (`#D4A574`)
- **Plugin Subagent** -- cyan (`text-cyan-400`)
- **Hooks** -- emerald (`text-emerald-400`)

### Label Color Hashing

Custom task labels get deterministic colors via `getLabelColor()`, which uses an FNV-1a hash of the label string to index into a 17-color palette:

```typescript
import { getLabelColor } from "../../theme";

const { text: textClass, bg: bgClass } = getLabelColor("frontend");
```

---

## Component Hierarchy

### Layout Structure

```
App
+-- Header                    (top bar: nav tabs, running count badge, input-needed badge, activity bell icon)
+-- [error banner]            (connection error, if any)
|
+-- [Workspace view]
|   +-- aside (sidebar)       (resizable, 200-500px, persisted width)
|   |   +-- CreateForm        (Branch/Issues tab switcher, create buttons)
|   |   +-- Search input      (shared filter/search bar)
|   |   +-- WorktreeList      (when Branch tab active)
|   |   +-- IssueList         (when Issues tab active)
|   +-- ResizableHandle       (drag to resize sidebar)
|   +-- main (detail panel)
|       +-- [workspace banner]
|       +-- DetailPanel       (worktree selected)
|       +-- JiraDetailPanel   (Jira issue selected)
|       +-- LinearDetailPanel (Linear issue selected)
|       +-- CustomTaskDetailPanel (custom task selected)
|
+-- [Agents view]
|   +-- AgentsView            (rules, custom/plugin agents, MCP servers, skills, plugins management)
|
+-- [Activity view]
|   +-- ActivityPage          (per-project activity cards with bug-toggle debug logs mode)
|
+-- [Configuration view]
|   +-- ConfigurationPanel
|
+-- [Integrations view]
|   +-- IntegrationsPanel
|
+-- [Hooks view]
|   +-- HooksPanel
|
+-- TabBar                    (Electron multi-project tabs, bottom of screen)
+-- [Modals]                  (CreateWorktreeModal, CreateCustomTaskModal, GitHubSetupModal, etc.)
```

### Conditional Screens

Before the main UI renders, the app checks for several early-exit conditions:

1. **WelcomeScreen** -- shown when no projects exist (Electron) or no config exists (web mode).
2. **Loading state** -- shown when projects exist in Electron but the server is not ready yet.
3. **ProjectSetupScreen** -- shown when config is missing for the active Electron project.
4. **Auto-initializing** -- shown during automatic config detection (Electron with "auto" preference).

---

## Sidebar Components

### CreateForm (`apps/web-app/src/components/CreateForm.tsx`)

Tab switcher at the top of the sidebar with two tabs:

- **Branch** -- shows worktrees. Provides a "New Worktree" button.
- **Issues** -- always available, even without Jira/Linear configured. Shows local tasks by default and adds Jira/Linear sections when integrations are connected.

New worktree creation is focus-forward: after creating or resolving an existing worktree from the create modal, the workspace switches to the Branch tab and selects that worktree in the detail panel.

### WorktreeList / WorktreeItem (`apps/web-app/src/components/WorktreeList.tsx`, `WorktreeItem.tsx`)

Displays all worktrees with filtering support. Each `WorktreeItem` shows the worktree name, branch, status indicator (running/stopped/creating), and linked issue badges (Jira, Linear, custom task). Clicking a worktree selects it and shows its detail panel. When a worktree is created from the sidebar modal, the Branch tab clears any active filter, selects the new worktree, and scrolls its row into view.

### Issue Lists

- **JiraIssueList / JiraIssueItem** -- Jira issues with priority icons, status badges, and type indicators.
- **LinearIssueList / LinearIssueItem** -- Linear issues with state badges and priority indicators.
- **CustomTaskList / CustomTaskItem** -- Local custom tasks with status, priority dots, and label badges.

### IssueList (`apps/web-app/src/components/IssueList.tsx`)

Aggregator component that renders all issue types in a single scrollable list. Receives issues from all sources and delegates rendering to the type-specific list/item components. Jira/Linear issue queries are initialized in the background once integrations are configured (they do not wait for the Issues tab to be opened). Jira, Linear, and Local sections each provide a manual refresh control in the section header; Local tasks are refresh-on-demand (plus mutation invalidation) rather than interval polling. The Local section is always shown so users can work with local issues even when no external integration is configured.

---

## Detail Panel Components

All detail panels live in `apps/web-app/src/components/detail/`.

### DetailPanel (`DetailPanel.tsx`)

The worktree detail view. Contains:

- **DetailHeader** -- worktree name (editable inline), branch name, status badge, start/stop/delete action buttons, linked issue badges, and the split `Open` button (primary action + dropdown) for detected open targets. The primary button label includes the current target (for example `Open in Cursor`).
- **Tab bar** -- Logs | Terminal | Hooks | Changes, plus Claude/Codex/Gemini/OpenCode controls. Each agent appears as its own tab only when opened; otherwise `+ Claude`, `+ Codex`, `+ Gemini`, and `+ OpenCode` quick actions are shown. From the worktree detail panel, `+ Claude` and `+ Codex` are restore-first actions: they prefer a live scoped PTY session, then native agent history for the exact worktree path, show a picker when multiple saved conversations match, and only offer `Start New Conversation` as an explicit follow-up when no restore target exists. `+ Gemini` and `+ OpenCode` keep the existing live-session launch-or-resume behavior.
- **Git action toolbar** -- contextual buttons for Commit (when uncommitted changes exist), Push (when unpushed commits exist), and PR (when pushed but no PR exists). Each expands an inline input form.
- **LogsViewer** -- streaming process output for running worktrees.
- **TerminalView** -- interactive xterm.js terminal. Sessions are reused per project-server+worktree+scope (`terminal`/`claude`/`codex`/`gemini`/`opencode`), so identical worktree IDs in different projects do not collide. Sessions with startup commands (agent launch) are bootstrapped server-side and later reattached in the UI, including after full page refresh via active-session lookup. On reattach, the server now sends a serialized terminal-state snapshot first so worktree terminals restore the current screen plus bounded scrollback instead of relying on raw PTY output replay alone. Worktree-detail `Claude` and `Codex` quick actions can also bootstrap from native history (`claude -r <sessionId>` / `codex resume <sessionId>`) when no live scoped PTY exists but a prior conversation for the exact worktree path does. Agent launch requests are one-shot: once handled (`reattached`, `started`, or `failed`), launch intent is cleared so passive focus/reconnect cannot retrigger startup commands. Explicit launch requests run a scoped reconcile connect path that bypasses client SID cache so the server can reuse an existing agent session or replace a shell-only scoped session as needed. When explicit launch intent is present, passive reconnect is suppressed; if a passive connect is already in progress, explicit launch retries in a short bounded loop instead of being marked failed immediately. Awaiting-input notifications are explicit agent events via `openkit activity await-input`, not terminal-text heuristics. Closing agent tabs explicitly destroys their scoped sessions. If a reused scoped session rapidly opens/closes, the client clears cached state, resets the active scoped session on the server when needed, and performs one forced fresh-session retry before surfacing an error.
- **HooksTab** -- runs and displays hook results with visual state indicators (dashed/no-bg for unrun and running items, spinner during execution, solid card background for completed/disabled items). Supports command, prompt, and skill entries for agent workflow triggers, plus command-only lifecycle trigger steps; auto-expands items with output when the pipeline completes. Receives real-time updates via `hook-update` SSE events.
- **DiffViewerTab** -- git diff viewer with a file sidebar (left) and per-file Monaco DiffEditor sections (right). Shows untracked, unstaged, and staged changes with an optional toggle to include committed changes vs the base branch. Files are collapsible/expandable with lazy content fetching; Monaco instances mount on expand and unmount on collapse for memory efficiency. Supports unified and side-by-side view modes. Uses `GET /api/worktrees/:id/diff` for file list and `GET /api/worktrees/:id/diff/file` for per-file content.
- **Recover Task** -- for local-pattern worktrees (`LOCAL-*`) with missing local task metadata, DetailPanel exposes a recovery action that calls `POST /api/tasks/recover-local`, recreates task metadata + notes linked to the canonical worktree, and navigates directly to the recovered task.
- **Delete workflow** -- delete is non-optimistic: UI cache/tab cleanup runs only after successful `DELETE /api/worktrees/:id` response. While delete is in-flight, the confirmation dialog stays open in loading state (`Deleting...` with spinner), the `Cancel` and close `X` controls are hidden, and backdrop dismissal is disabled. On failure, selection/tabs/sessions are preserved and an explicit error is shown.

Agent launch integration:

- App-level launch queues run `pre-implementation` command hooks before starting Claude/Codex/Gemini/OpenCode in `start` mode.
- When Claude, Codex, Gemini, or OpenCode exits cleanly (`exitCode === 0`), DetailPanel triggers `post-implementation` command hooks automatically.
- Detail panel tab state for agent tabs is scoped per project context (Electron: `project.id`, Web: `serverUrl`) to prevent cross-project bleed when worktree IDs overlap.
- Worktree detail `+ Claude` / `+ Codex` actions now call a restore lookup endpoint before launching: they choose between live scoped PTY reattach, native history resume, a history picker, or an explicit `Start New Conversation` fallback. `+ Gemini` / `+ OpenCode` continue to synthesize `resume` vs `start` launch requests from active scoped session lookup only.
- Explicit "Code with ..." clicks always propagate a launch request into the matching terminal tab, even when that tab is already open.
- Launch requests are consumed after first handling, so returning focus to a tab does not relaunch the agent.

### JiraDetailPanel (`JiraDetailPanel.tsx`)

Shows Jira issue details: summary, description (rendered as Markdown from Atlassian Document Format), status, priority, assignee, and comments. Provides both "Create Worktree" and a split "Code with ..." action that launches Claude, Codex, Gemini CLI, or OpenCode. The panel also supports inline issue updates through API actions: status transition, editable summary/title with autosave, autosaving description edits (blur or idle debounce), and comments with enter-to-post (`Shift+Enter` for newline). Own comments expose inline `Edit | Delete` actions with delete confirmation. The last-selected coding agent is reused as the default action across issue/task panels. Manual launches perform a CLI preflight check (`claude`, `codex`, `gemini`, or `opencode`) and show a Homebrew install modal when missing. A shared permissions dialog is used for all supported agents before launch.
Shows Jira issue details: summary, description (rendered as Markdown from Atlassian Document Format), status, priority, assignee, and comments. Provides both "Create Worktree" and a split "Code with ..." action that launches Claude, Codex, Gemini CLI, or OpenCode. The last-selected coding agent is reused as the default action across issue/task panels. Manual launches perform a CLI preflight check (`claude`, `codex`, `gemini`, or `opencode`) and show a Homebrew install modal when missing. A shared permissions dialog is used for all supported agents before launch. For task-initiated coding, launch mode is derived from create response semantics: reused existing worktrees launch in `resume` mode (no startup prompt), newly created worktrees launch in `start` mode (with task prompt).

### LinearDetailPanel (`LinearDetailPanel.tsx`)

Similar to JiraDetailPanel but for Linear issues. Shows title, description, state, priority, assignee, labels, and attachment previews/download links via a Linear attachment proxy endpoint to avoid auth/CORS failures. The panel also supports inline issue updates through API actions: status transition, editable title with autosave, autosaving description edits (blur or idle debounce), and comments with enter-to-post (`Shift+Enter` for newline). Own comments expose inline `Edit | Delete` actions with delete confirmation. It also supports split "Code with ..." launch (Claude, Codex, Gemini CLI, or OpenCode); launches check CLI availability first and offer Homebrew install if missing, and all supported agents use the shared manual permissions choice modal.
Similar to JiraDetailPanel but for Linear issues. Shows title, description, state, priority, assignee, labels, and attachment previews/download links via a Linear attachment proxy endpoint to avoid auth/CORS failures. Also supports split "Code with ..." launch (Claude, Codex, Gemini CLI, or OpenCode); launches check CLI availability first and offer Homebrew install if missing, and all supported agents use the shared manual permissions choice modal. Reused existing worktrees launch agents in `resume` mode; newly created worktrees launch in `start` mode.

### CustomTaskDetailPanel (`CustomTaskDetailPanel.tsx`)

Detail view for local custom tasks. Supports inline editing of title, description, status, priority, and labels. Description uses the shared editable textarea card behavior (click to edit, save on blur). Shows file attachments with image preview support and supports split "Code with ..." launch (Claude, Codex, Gemini CLI, or OpenCode); launches check CLI availability first and offer Homebrew install if missing, and all supported agents use the shared manual permissions choice modal. Reused existing worktrees launch agents in `resume` mode; newly created worktrees launch in `start` mode. When a linked active worktree exists, the panel shows an explicit guardrail note indicating the `Code with ...` action will reuse that worktree.

### Other Detail Panels

- **McpServerDetailPanel** -- MCP server configuration, environment variables, deployment status across agents.
- **SkillDetailPanel** -- Skill markdown editing (`SKILL.md`, `reference.md`, `examples.md`) with path-annotation headers, frontmatter editing, deployment status.
- **PluginDetailPanel** -- Claude plugin details, install/uninstall/enable/disable actions.

### Supporting Components

| Component                  | Purpose                                                                                                                                            |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LogsViewer.tsx`           | ANSI-aware streaming log output with auto-scroll                                                                                                   |
| `TerminalView.tsx`         | xterm.js terminal with WebSocket connection                                                                                                        |
| `CodeAgentSplitButton.tsx` | Reusable split launcher for choosing Claude/Codex/Gemini/OpenCode in issue/task detail headers; selection is persisted as the default launch agent |
| `HooksTab.tsx`             | Hooks runner with animated running state and step/skill result display                                                                             |
| `GitActionInputs.tsx`      | Inline commit message and PR title input forms                                                                                                     |
| `ActionToolbar.tsx`        | Git action buttons (commit, push, PR)                                                                                                              |
| `DetailHeader.tsx`         | Worktree name/branch display with inline edit, action buttons, and split `Open` target control                                                     |
| `NotesSection.tsx`         | PersonalNotesSection + AgentSection (tabbed: Context, Todos, Git Policy, Hooks)                                                                    |
| `TodoList.tsx`             | Checkbox todo items attached to issues                                                                                                             |
| `AgentPolicySection.tsx`   | Per-issue agent git policy overrides                                                                                                               |
| `ToggleSwitch.tsx`         | Shared switch control used across Agents, Integrations, Settings, Hooks, and detail views                                                          |
| `ShortcutsSection.tsx`     | Keyboard shortcut editor in the Configuration view; lists all configurable shortcuts with editable key bindings persisted to local config          |

---

## Hooks and Data Fetching

All hooks live in `apps/web-app/src/hooks/`.

### Real-Time Updates via SSE

**`useWorktrees`** (`useWorktrees.ts`) establishes an `EventSource` connection to `/api/events`. The server pushes several event types:

- `worktrees` -- worktree state updates (status, logs, git state)
- `notification` -- server notification messages (error-level notifications are surfaced through persistent error toasts)
- `hook-update` -- signals that hook results changed for a worktree, triggering auto-refetch in the HooksTab
- `activity-history` -- batch of recent events on initial connection (dispatched as `OpenKit:activity-history` CustomEvent)
- `activity` -- individual real-time activity events (dispatched as `OpenKit:activity` CustomEvent)
- `ops-log-history` -- batch of recent operational logs on initial connection (consumed by `useProjectOpsLogs`)
- `ops-log` -- individual real-time operational log event (consumed by `useProjectOpsLogs`)

On connection error, it falls back to polling with a 5-second retry.

```typescript
const { worktrees, isConnected, error, refetch } = useWorktrees(onNotification, onHookUpdate);
```

Additional hooks in the same file:

- `useProjectName()` -- fetches the project name from config.
- `usePorts()` -- fetches discovered ports and offset step.
- `useJiraStatus()` / `useLinearStatus()` / `useGitHubStatus()` -- fetch integration connection status.

### React Query Hooks

These use TanStack React Query for caching, background refetching, and stale-while-revalidate:

| Hook                   | Query Key                             | Data Source                |
| ---------------------- | ------------------------------------- | -------------------------- |
| `useJiraIssues`        | `['jira-issues', query, serverUrl]`   | `/api/jira/issues`         |
| `useJiraIssueDetail`   | `['jira-issue', key, serverUrl]`      | `/api/jira/issues/:key`    |
| `useLinearIssues`      | `['linear-issues', query, serverUrl]` | `/api/linear/issues`       |
| `useLinearIssueDetail` | `['linear-issue', id, serverUrl]`     | `/api/linear/issues/:id`   |
| `useCustomTasks`       | `['custom-tasks', serverUrl]`         | `/api/tasks`               |
| `useCustomTaskDetail`  | `['custom-task', id, serverUrl]`      | `/api/tasks/:id`           |
| `useMcpServers`        | various                               | `/api/mcp-servers`         |
| `useSkills`            | various                               | `/api/skills`              |
| `useNotes`             | `['notes', source, id, serverUrl]`    | `/api/notes/:source/:id`   |
| `useAgentRule`         | `['agentRule', fileId]`               | `/api/agent-rules/:fileId` |
| `useHooksConfig`       | `['hooks-config', serverUrl]`         | `/api/hooks/config`        |

Jira/Linear issue hooks support configurable refresh intervals (from integration settings) and search query debouncing (300ms). Local custom tasks are refreshed via explicit invalidation and the manual Local refresh control.

`App.tsx` installs a global keydown guard that prevents hard reload shortcuts (`Cmd/Ctrl+R` and `F5`) in non-dev builds so accidental refreshes do not reset active UI state. In dev mode, those shortcuts are allowed.

### WebSocket Terminal

**`useTerminal`** (`useTerminal.ts`) manages interactive PTY sessions:

1. `connect()` -- POST to `/api/worktrees/:id/terminals` (with a scope) to create/reuse a session, then opens a WebSocket to `/api/terminals/:sessionId/ws`.
2. `createSessionStartupCommand` (optional) -- when provided for a pending explicit launch request, the session starts with a shell startup command. Explicit launch connects bypass client SID cache and rely on server scoped-session reconcile metadata (`reusedScopedSession`, `replacedScopedShellSession`) to determine `reattached` vs `started`.
3. `restore` WebSocket control frames reset the visible xterm instance and replay a serialized terminal snapshot before live output resumes.
4. `sendData(data)` -- forwards keystrokes to the PTY via WebSocket.
5. `sendResize(cols, rows)` -- sends terminal resize events.
6. `disconnect()` -- closes WebSocket only (session stays alive for reconnect/tab switches).
7. `destroy()` -- explicitly destroys the server-side session.

Sessions are keyed by `runtimeScopeKey + worktreeId + scope` (`terminal`, `claude`, `codex`, `gemini`, or `opencode`). `runtimeScopeKey` is `project:<id>` in Electron and `server:<url-or-relative>` in web mode. `TerminalView` keeps sessions alive across tab switches/navigation, and visible tabs automatically reconnect when project/server context changes. Reconnect is reattach-first; startup commands are only used while a one-shot explicit launch request is pending. The server tracks terminal state with a headless xterm instance and serializes up to 10,000 lines of scrollback for restore-on-reattach across all scopes. Explicit launch intent takes precedence over passive reconnect attempts, and in-flight connect contention is handled by bounded explicit-launch retries instead of immediate failure. To prevent infinite reconnect loops, websocket open attempts have a timeout, rapid repeated open->close cycles trigger a forced fresh-session reconnect path, and visible reconnecting tabs run a watchdog that forces one scoped-session refresh before showing an explicit terminal error.

### Configuration

**`useConfig`** (`useConfig.ts`) fetches `.openkit/config.json` from the server. Returns the config object, project name, whether a branch name rule exists, and loading state.

**`useLocalConfig`** (`useLocalConfig.ts`) fetches `.openkit/config.local.json` via `GET /api/local-config` and exposes the local config object (including `shortcuts`). Provides a mutation helper that calls `PATCH /api/local-config` to merge partial updates back to the server.

### Keyboard Shortcuts

**`useShortcuts`** (`useShortcuts.ts`) registers global keyboard shortcut listeners. Reads the current shortcut bindings from `useLocalConfig` and attaches `keydown` handlers for project tab switching, view navigation, and other configurable actions. Shortcut definitions default to the values in `config.local.json` and update live when the user edits bindings in the `ShortcutsSection` UI.

#### Arrow Key Navigation

When `arrowNavEnabled` is `true` (the default), `useShortcuts` also registers arrow key handlers:

- **Cmd+Left / Cmd+Right** -- Navigates between top-level pages in NavBar order. The `NAV_SLOTS` order is: workspace(branch), workspace(issues), activity, agents, hooks, integrations, configuration. Activity is positioned immediately after the two Workspace tabs. If the currently focused element has the `data-sidebar-search` attribute, Cmd+Left/Right still navigates pages (rather than moving the cursor in the search input).
- **Cmd+Down / Cmd+Up** -- Navigates the workspace sidebar vertically. Cmd+Down first focuses the workspace search input, then traverses sidebar items on subsequent presses. Cmd+Up traverses in reverse.

Sidebar traversal relies on DOM query selectors targeting elements with the `data-sidebar-item` attribute (present on `WorktreeItem`, `JiraIssueItem`, `LinearIssueItem`, and `CustomTaskItem` buttons) and the `data-sidebar-search` attribute (on the workspace search input).

The `arrowNavEnabled` toggle is exposed in the Keyboard Shortcuts settings card (`ShortcutsSection.tsx`) and persisted to `config.local.json`.

### Ngrok Connect Controls

Ngrok controls are handled in `App.tsx` and surfaced through `TabBar.tsx` in Electron mode:

- **Wi-Fi button** (left of the Settings icon) toggles `/api/ngrok/tunnel/enable` and `/api/ngrok/tunnel/disable`.
- On first successful enable per project/server, the app auto-opens a QR modal.
- **QR button** (left of Wi-Fi) calls `/api/ngrok/pairing/start` and opens the pairing modal with a generated QR image.
- The QR modal supports copy-to-clipboard for the pairing URL and tunnel URL regeneration.

---

## API Layer

The API layer uses a two-file pattern:

### `api.ts` -- Raw fetch functions

Every API function accepts an optional `serverUrl` parameter as its last argument:

```typescript
export async function startWorktree(
  id: string,
  serverUrl: string | null = null,
): Promise<{ success: boolean; error?: string }>;
```

When `serverUrl` is `null` (web mode), requests use relative URLs. When provided (Electron mode), requests use the full URL (e.g., `http://localhost:<project-port>/api/worktrees`).

The file contains functions for every API endpoint: worktree CRUD, git operations (commit, push, PR), Jira/Linear/GitHub integration management, terminal sessions, MCP server management, skills, plugins, notes, todos, hooks, configuration, and ngrok connect status/pairing helpers.

### `useApi.ts` -- Bound hook

The `useApi()` hook reads the current `serverUrl` from `ServerContext` and returns a memoized object where every API function is pre-bound to that URL:

```typescript
const api = useApi();
await api.startWorktree(worktreeId); // serverUrl is automatically included
```

This means components never need to think about which server they are talking to.

`useApi` also suppresses global API error toasts for recoverable worktree-conflict responses (`WORKTREE_EXISTS` / `WORKTREE_RECOVERY_REQUIRED`) on worktree-creation methods, because those flows open `WorktreeExistsModal` and should not show duplicate error toasts.

---

## Selection State Management

The `Selection` type is a discriminated union that tracks what the user has selected in the sidebar:

```typescript
type Selection =
  | { type: "worktree"; id: string }
  | { type: "issue"; key: string }
  | { type: "linear-issue"; identifier: string }
  | { type: "custom-task"; id: string }
  | null;
```

### Persistence

Selection state is persisted to `localStorage` under the key `OpenKit:wsSel:{scope}`.

Scope rules:

- Electron mode: `{scope}` = `project.id`
- Web mode: `{scope}` = `serverUrl`

Similarly persisted per scope:

- Active view: `OpenKit:view:{scope}`
- Active sidebar tab (branch/issues): `OpenKit:wsTab:{scope}`
- Sidebar width: `OpenKit:sidebarWidth` (global, not per-project)

In Electron mode, the app includes a one-time migration read path from legacy `serverUrl` keys to the new `project.id` keys.

### Auto-Selection

When no selection exists and worktrees are available, the first worktree is auto-selected. When the selected worktree is deleted, selection falls back to the first remaining worktree. When the worktree list becomes empty, selection is cleared.

### Adding a New Selection Type

When adding a new selection type (e.g., a new integration), you must update:

1. The `Selection` union type in `App.tsx`.
2. The conditional rendering in the detail panel section of `App.tsx`.
3. The `IssueList` component to accept and render the new entity type.
4. The `CreateForm` component if the new type needs a creation button.
5. Any cross-linking logic (e.g., `findLinkedWorktree` pattern for the new type).

---

## Multi-Project Support (Electron)

### ServerContext (`apps/web-app/src/contexts/ServerContext.tsx`)

The `ServerProvider` wraps the entire app and manages multi-project state:

```typescript
interface ServerContextValue {
  serverUrl: string | null;           // Active project's API URL
  projects: Project[];                // All open projects
  activeProject: Project | null;      // Currently selected project
  openProject: (path: string) => Promise<...>;
  closeProject: (id: string) => Promise<void>;
  switchProject: (id: string) => void;
  isElectron: boolean;
  selectFolder: () => Promise<string | null>;
}
```

Each project is a separate OpenKit server running on a different port. The `serverUrl` is derived from the active project's port: `http://localhost:{port}`.

Hooks like `useServerUrlOptional()` return `null` when no project is active, which disables API calls and SSE connections.

### TabBar

In Electron mode, a `TabBar` component appears at the bottom of the screen showing all open projects as tabs. Users can switch between projects, open new ones via a folder picker, and close projects.

### Web Mode

In web mode (no Electron), the app behaves as a single-project application. The `ServerProvider` still exists but `serverUrl` defaults to `null` (relative URLs), `projects` is empty, and `isElectron` is `false`.

---

## Resizable Sidebar

The sidebar width is adjustable via a `ResizableHandle` component positioned between the sidebar and detail panel. The width is constrained between 200px and 500px (default 300px) and persisted to both `localStorage` and Electron preferences (when available).

---

## Animation Patterns

The app uses Framer Motion for transitions:

- **View switching** -- `AnimatePresence` with `mode="wait"` for sidebar tab transitions (worktree list / issue list slide in from opposite directions).
- **Header fade-in** -- the header fades in on initial render.
- **Background blobs** -- the configuration, integrations, and hooks views have animated gradient blobs drifting in the background via CSS keyframe animations.
- **Sweeping border** (currently commented out) -- hook items previously displayed a teal gradient "comet" that sweeps around the card border during execution. The `SweepingBorder` component is still defined in `HooksTab.tsx` but its usage is commented out, replaced by a circular progress spinner (`Loader2`) in the status icon position. The CSS keyframes (`border-sweep`, `border-sweep-fade`) remain defined in `apps/web-app/src/index.css`.

---

## File Index

### Components (`apps/web-app/src/components/`)

| File                        | Description                                                                                                                                                                                                                                                                                                                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AgentsView.tsx`            | Top-level agents management view                                                                                                                                                                                                                                                                                                   |
| `ActivityPage.tsx`          | Dedicated Activity view with one card per project in a responsive `minmax(500px, 1fr)` grid; ops log list uses `@tanstack/react-virtual` for virtualized rendering                                                                                                                                                                 |
| `AgentsSidebar.tsx`         | Sidebar for agents view (MCP servers, skills, plugins lists)                                                                                                                                                                                                                                                                       |
| `AgentsToolbar.tsx`         | Toolbar for agents view actions                                                                                                                                                                                                                                                                                                    |
| `AppSettingsModal.tsx`      | Electron app settings (themes, preferences)                                                                                                                                                                                                                                                                                        |
| `AttachmentImage.tsx`       | Image attachment preview with lightbox                                                                                                                                                                                                                                                                                             |
| `Button.tsx`                | Reusable button component                                                                                                                                                                                                                                                                                                          |
| `ConfigurationPanel.tsx`    | Edit `.openkit/config.json` settings; includes retention limit controls (days + max size) for both activity and ops logs with Apply button and impact warning modal                                                                                                                                                                |
| `ConfirmDialog.tsx`         | Confirmation dialog for destructive actions                                                                                                                                                                                                                                                                                        |
| `ConfirmModal.tsx`          | Generic confirmation modal                                                                                                                                                                                                                                                                                                         |
| `CreateCustomTaskModal.tsx` | Create new custom task form                                                                                                                                                                                                                                                                                                        |
| `CreateForm.tsx`            | Sidebar tab switcher (Branch/Issues) with create buttons                                                                                                                                                                                                                                                                           |
| `CreateWorktreeModal.tsx`   | Create worktree modal (from branch, Jira, or Linear)                                                                                                                                                                                                                                                                               |
| `CustomTaskItem.tsx`        | Custom task sidebar list item                                                                                                                                                                                                                                                                                                      |
| `CustomTaskList.tsx`        | Custom task list in sidebar                                                                                                                                                                                                                                                                                                        |
| `DeployDialog.tsx`          | MCP server/skill deployment dialog                                                                                                                                                                                                                                                                                                 |
| `GitHubSetupModal.tsx`      | GitHub initial setup (commit + repo creation)                                                                                                                                                                                                                                                                                      |
| `Header.tsx`                | Top header bar with nav tabs, running count, and activity bell icon                                                                                                                                                                                                                                                                |
| `ImageModal.tsx`            | Full-screen image lightbox                                                                                                                                                                                                                                                                                                         |
| `IntegrationsPanel.tsx`     | Configure Jira/Linear/GitHub integrations, including per-integration auto-start and optional auto-transition status on agent start                                                                                                                                                                                                 |
| `IssueList.tsx`             | Aggregated issue list (Jira + Linear + custom tasks)                                                                                                                                                                                                                                                                               |
| `JiraIssueItem.tsx`         | Jira issue sidebar item                                                                                                                                                                                                                                                                                                            |
| `JiraIssueList.tsx`         | Jira-specific issue list                                                                                                                                                                                                                                                                                                           |
| `LinearIssueItem.tsx`       | Linear issue sidebar item                                                                                                                                                                                                                                                                                                          |
| `LinearIssueList.tsx`       | Linear-specific issue list                                                                                                                                                                                                                                                                                                         |
| `MarkdownContent.tsx`       | Markdown renderer with dark theme styling                                                                                                                                                                                                                                                                                          |
| `McpServerCreateModal.tsx`  | Create/edit MCP server modal                                                                                                                                                                                                                                                                                                       |
| `McpServerItem.tsx`         | MCP server sidebar item                                                                                                                                                                                                                                                                                                            |
| `McpServerScanModal.tsx`    | Scan and import MCP servers/skills/custom agents (supports direct device-scan entry from discovery banner and prefilled results from the latest banner scan; custom agents import as-is using detected deployment defaults)                                                                                                        |
| `Modal.tsx`                 | Base modal component (sm/md/lg widths, optional close/backdrop dismissal controls)                                                                                                                                                                                                                                                 |
| `NavBar.tsx`                | Navigation bar (defines View type)                                                                                                                                                                                                                                                                                                 |
| `PerformancePage.tsx`       | Real-time performance monitoring dashboard with per-worktree CPU/memory breakdown, expandable process trees, and system summary gauges                                                                                                                                                                                             |
| `PayloadCopyButton.tsx`     | Reusable hover-only payload copy control with clipboard integration and 3-second `Copied` feedback state                                                                                                                                                                                                                           |
| `PluginInstallModal.tsx`    | Install Claude plugin modal                                                                                                                                                                                                                                                                                                        |
| `PluginItem.tsx`            | Plugin sidebar item                                                                                                                                                                                                                                                                                                                |
| `ProjectSetupScreen.tsx`    | First-run setup for new Electron projects                                                                                                                                                                                                                                                                                          |
| `ResizableHandle.tsx`       | Drag handle for sidebar resizing                                                                                                                                                                                                                                                                                                   |
| `SetupCommitModal.tsx`      | Commit OpenKit config files modal                                                                                                                                                                                                                                                                                                  |
| `SkillCreateModal.tsx`      | Create/edit skill modal                                                                                                                                                                                                                                                                                                            |
| `SkillItem.tsx`             | Skill sidebar item                                                                                                                                                                                                                                                                                                                 |
| `Spinner.tsx`               | Loading spinner component                                                                                                                                                                                                                                                                                                          |
| `TabBar.tsx`                | Electron multi-project tab bar and bottom-right project controls (QR, Wi-Fi tunnel toggle, Settings)                                                                                                                                                                                                                               |
| `ActivityFeed.tsx`          | Shared activity feed panel (`ActivityFeedPanel`) plus dropdown wrapper (`ActivityFeed`) and bell button (`ActivityBell`), with multi-select filter chips, action-required prioritization, row-level subject navigation, grouped consecutive task-detected rows, and `@tanstack/react-virtual` for virtualized event list rendering |
| `errorToasts.tsx`           | Global `react-hot-toast` error renderer/runtime bridges; error toasts auto-dismiss after 5s and emit `OpenKit:error-toast` for backend ops logging                                                                                                                                                                                 |
| `Tooltip.tsx`               | Tooltip component (always use this instead of native `title` attribute)                                                                                                                                                                                                                                                            |
| `TruncatedTooltip.tsx`      | Text with automatic tooltip on overflow                                                                                                                                                                                                                                                                                            |
| `VerificationPanel.tsx`     | Hooks configuration view (trigger-based command steps, prompts, and skills across workflow + lifecycle triggers)                                                                                                                                                                                                                   |
| `WelcomeScreen.tsx`         | Initial welcome/onboarding screen                                                                                                                                                                                                                                                                                                  |
| `WorktreeExistsModal.tsx`   | Handle worktree already exists error                                                                                                                                                                                                                                                                                               |
| `WorktreeItem.tsx`          | Worktree sidebar list item                                                                                                                                                                                                                                                                                                         |
| `WorktreeList.tsx`          | Worktree list in sidebar                                                                                                                                                                                                                                                                                                           |

`main.tsx` configures the global `Toaster` (dark theme) plus React Query global error handlers so query and mutation failures consistently produce persistent error toasts.

### Detail Components (`apps/web-app/src/components/detail/`)

| File                        | Description                                                                                                                                                                                                                   |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DetailPanel.tsx`           | Worktree detail (logs, terminal, Claude/Codex/Gemini/OpenCode tabs, hooks, git actions)                                                                                                                                       |
| `DetailHeader.tsx`          | Worktree header with inline rename, action buttons, and split `Open` target control                                                                                                                                           |
| `CodeAgentSplitButton.tsx`  | Split "Code with ..." launcher (Claude/Codex/Gemini/OpenCode) used by issue/task detail views                                                                                                                                 |
| `JiraDetailPanel.tsx`       | Jira issue detail view                                                                                                                                                                                                        |
| `LinearDetailPanel.tsx`     | Linear issue detail view                                                                                                                                                                                                      |
| `CustomTaskDetailPanel.tsx` | Custom task detail with inline editing (description uses shared editable textarea card)                                                                                                                                       |
| `McpServerDetailPanel.tsx`  | MCP server detail (command or URL transport), env overrides, and deployment                                                                                                                                                   |
| `SkillDetailPanel.tsx`      | Skill detail with markdown editor using shared editable textarea cards + path annotations                                                                                                                                     |
| `AgentRuleDetailPanel.tsx`  | Agent rule file viewer/editor (CLAUDE.md, AGENTS.md)                                                                                                                                                                          |
| `AgentDetailPanel.tsx`      | Agent definition detail (custom + plugin metadata, source paths, deployment matrix as single enablement surface with plugin-disable confirmation for Claude scope, shared editable textarea cards for description/definition) |
| `PluginDetailPanel.tsx`     | Claude plugin detail                                                                                                                                                                                                          |
| `LogsViewer.tsx`            | Streaming ANSI log output                                                                                                                                                                                                     |
| `TerminalView.tsx`          | xterm.js interactive terminal                                                                                                                                                                                                 |
| `HooksTab.tsx`              | Hooks runner with multi-expand, pipeline auto-expand, and circular progress spinner                                                                                                                                           |
| `DiffViewerTab.tsx`         | Git diff viewer container with file sidebar, view mode toggle, and lazy Monaco diff sections                                                                                                                                  |
| `DiffFileSidebar.tsx`       | File list sidebar with status icons and line count badges                                                                                                                                                                     |
| `DiffFileSection.tsx`       | Per-file collapsible section with lazy content fetch and Monaco DiffEditor                                                                                                                                                    |
| `DiffMonacoEditor.tsx`      | Monaco DiffEditor wrapper with custom openkit-dark theme                                                                                                                                                                      |
| `GitActionInputs.tsx`       | Inline commit/PR input forms                                                                                                                                                                                                  |
| `ActionToolbar.tsx`         | Git action buttons                                                                                                                                                                                                            |
| `NotesSection.tsx`          | PersonalNotesSection + AgentSection (tabbed: Context, Todos, Git Policy, Hooks)                                                                                                                                               |
| `TodoList.tsx`              | Checkbox todo items                                                                                                                                                                                                           |
| `AgentPolicySection.tsx`    | Per-issue agent git policy overrides                                                                                                                                                                                          |

### Hooks (`apps/web-app/src/hooks/`)

| File                           | Description                                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `api.ts`                       | Raw fetch functions for all API endpoints                                                                                          |
| `useApi.ts`                    | Hook that pre-binds API functions to current server URL                                                                            |
| `useConfig.ts`                 | Fetch and cache `.openkit/config.json`                                                                                             |
| `useCustomTasks.ts`            | React Query hook for custom tasks list                                                                                             |
| `useCustomTaskDetail.ts`       | React Query hook for single custom task                                                                                            |
| `useJiraIssues.ts`             | React Query hook for Jira issues with search debouncing                                                                            |
| `useJiraIssueDetail.ts`        | React Query hook for single Jira issue                                                                                             |
| `useLinearIssues.ts`           | React Query hook for Linear issues with search debouncing                                                                          |
| `useLinearIssueDetail.ts`      | React Query hook for single Linear issue                                                                                           |
| `useMcpServers.ts`             | Hooks for MCP server data                                                                                                          |
| `useNotes.ts`                  | Hook for issue notes and todos                                                                                                     |
| `useSkills.ts`                 | Hooks for skills data                                                                                                              |
| `useTerminal.ts`               | WebSocket terminal session management                                                                                              |
| `useAgentRules.ts`             | React Query hook for agent rule file content                                                                                       |
| `useHooks.ts`                  | Hooks config and skill results fetching                                                                                            |
| `activityFilterPersistence.ts` | Helpers for per-project activity filter persistence across bell dropdown + Activity page                                           |
| `activityFeedUtils.ts`         | Shared activity feed upsert/history utilities, including hook aggregation and consecutive task-detected grouping                   |
| `useActivityFeed.ts`           | Activity feed state, unread count, chronological upserts, hook-run aggregation, and grouped-event rendering support                |
| `useProjectActivityFeeds.ts`   | Per-project activity feed state with one SSE stream per running project, cache-first hydration, and initial loading-state handling |
| `useProjectOpsLogs.ts`         | Per-project operational log state with one SSE stream per running project for Activity debug mode                                  |
| `usePerformanceMetrics.ts`     | SSE-based real-time performance metrics (CPU/memory per process, on-demand connection)                                             |
| `useWorktrees.ts`              | SSE-based real-time worktree updates + integration status hooks                                                                    |

### Context (`apps/web-app/src/contexts/`)

| File                | Description                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ServerContext.tsx` | Multi-project server URL management, Electron IPC bridge                                                                                                                             |
| `ToastContext.tsx`  | Toast notification state management with `addToast`, `upsertToast`, `upsertGroupedToast` (grouped children), `toggleToastExpanded`, auto-dismiss, `projectName`/`worktreeId` support |
