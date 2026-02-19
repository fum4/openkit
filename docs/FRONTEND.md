# Frontend Architecture

## Overview

The dawg frontend is a React single-page application built with TypeScript, Tailwind CSS, React Query, and Framer Motion. Vite bundles it into `dist/ui/`, which the Hono backend serves as static files. The UI connects to the backend via REST API calls, Server-Sent Events (SSE) for real-time worktree status, and WebSockets for interactive terminal sessions.

The app operates in two modes:

- **Web mode** (single-project) -- served directly by the dawg server, uses relative URLs for API calls.
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
| Lucide React         | Icon library                               |

---

## View System

The application has five top-level views, defined as the `View` type in `src/ui/components/NavBar.tsx`:

```typescript
type View = "workspace" | "agents" | "hooks" | "configuration" | "integrations";
```

### Workspace

The main view. Displays a two-panel layout: a sidebar with worktree and issue lists on the left, and a context-dependent detail panel on the right. This is where users create, start, stop, and manage worktrees and their associated issues.

### Agents

Manages MCP servers, skills, and plugins. This is the hub for configuring agent tooling -- registering MCP servers, creating/deploying skills to coding agents (Claude, Cursor, etc.), and managing Claude plugins.
On initial load, Agents triggers a background device scan for MCP servers/skills and shows a discovery banner with quick `Scan again` and `Import` actions when items are found. If opened from that banner, the import dialog reuses the already-scanned results (no second scan).

### Hooks

Configures automated checks and agent skills organized by trigger type (pre-implementation, post-implementation, custom, on-demand). Users add shell command steps and import skills from the registry into each trigger type section.

### Configuration

Edits the `.dawg/config.json` settings: start commands, install commands, base branch, port discovery, environment variable mappings, and agent policy defaults.

### Integrations

Configures external service connections: Jira (OAuth credentials, project key, refresh interval), Linear (API key, team key), and GitHub (CLI installation, authentication).

The active view is persisted to `localStorage` per server URL, so switching between projects in Electron mode restores each project's last-viewed tab.

---

## Theme System

**All colors are centralized in `src/ui/theme.ts`.** Components must import from this file instead of hardcoding Tailwind color classes. This makes it possible to adjust the entire visual appearance from a single location.

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

| Export        | Purpose                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------ |
| `palette`     | Raw hex/rgba color values                                                                              |
| `surface`     | Background classes for page, panels, modals, overlays                                                  |
| `border`      | Border classes (subtle, section, modal, input, accent, focus)                                          |
| `input`       | Input field backgrounds, text, placeholder, ring styles                                                |
| `text`        | Text hierarchy: primary, secondary, muted, dimmed, error                                               |
| `status`      | Worktree status indicators (running, stopped, creating, deleting)                                      |
| `action`      | Ghost-style action button colors (start, stop, delete, commit, push, PR)                               |
| `button`      | Filled button variants (primary, secondary, confirm/destructive)                                       |
| `tab`         | Tab active/inactive styles                                                                             |
| `badge`       | Integration and status badge colors                                                                    |
| `integration` | Per-integration accent colors (jira=blue, linear=indigo, localIssue=amber, worktree=teal, mcp=purple)  |
| `header`      | Header bar specific styles                                                                             |
| `nav`         | Navigation bar active/inactive styles                                                                  |
| `settings`    | Configuration panel label/description/card styles                                                      |
| `detailTab`   | Detail panel tab (Logs/Terminal/Hooks) active/inactive styles                                          |
| `errorBanner` | Error banner backgrounds and borders                                                                   |
| `infoBanner`  | Informational banner (teal accent) styles                                                              |
| `customTask`  | Custom task accent, badge, button, status, priority, and label colors                                  |
| `skill`       | Skill accent (pink) and badge styles                                                                   |
| `plugin`      | Plugin accent (warm copper) and badge styles                                                           |
| `mcpServer`   | MCP server accent (purple), deployment status dot colors                                               |
| `hooks`       | Hooks accent (emerald), step result status colors                                                      |
| `notes`       | Notes tab styles, todo checkbox colors                                                                 |
| `agentRule`   | Agent rule accent (cyan), background, border styles                                                    |
| `activity`    | Activity feed category colors (agent=purple, worktree=teal, git=blue, system=red), severity dot colors |

### Integration Color Mapping

Each entity type has a consistent accent color used across the entire UI:

- **Worktree** -- teal (`#2dd4bf`)
- **Jira** -- blue (`text-blue-400`)
- **Linear** -- indigo (`#5E6AD2`)
- **Custom Task / Local Issue** -- amber (`text-amber-400`)
- **MCP Server** -- purple (`text-purple-400`)
- **Skill** -- pink (`text-pink-400`)
- **Plugin** -- warm copper (`#D4A574`)
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
+-- Header                    (top bar: nav tabs, running count badge, activity bell icon)
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
|   +-- AgentsView            (MCP servers, skills, plugins management)
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

### CreateForm (`src/ui/components/CreateForm.tsx`)

Tab switcher at the top of the sidebar with two tabs:

- **Branch** -- shows worktrees. Provides a "New Worktree" button.
- **Issues** -- always available, even without Jira/Linear configured. Shows local tasks by default and adds Jira/Linear sections when integrations are connected.

### WorktreeList / WorktreeItem (`src/ui/components/WorktreeList.tsx`, `WorktreeItem.tsx`)

Displays all worktrees with filtering support. Each `WorktreeItem` shows the worktree name, branch, status indicator (running/stopped/creating), and linked issue badges (Jira, Linear, custom task). Clicking a worktree selects it and shows its detail panel.

### Issue Lists

- **JiraIssueList / JiraIssueItem** -- Jira issues with priority icons, status badges, and type indicators.
- **LinearIssueList / LinearIssueItem** -- Linear issues with state badges and priority indicators.
- **CustomTaskList / CustomTaskItem** -- Local custom tasks with status, priority dots, and label badges.

### IssueList (`src/ui/components/IssueList.tsx`)

Aggregator component that renders all issue types in a single scrollable list. Receives issues from all sources and delegates rendering to the type-specific list/item components. Jira/Linear issue queries are initialized in the background once integrations are configured (they do not wait for the Issues tab to be opened). The Local section is always shown so users can work with local issues even when no external integration is configured.

---

## Detail Panel Components

All detail panels live in `src/ui/components/detail/`.

### DetailPanel (`DetailPanel.tsx`)

The worktree detail view. Contains:

- **DetailHeader** -- worktree name (editable inline), branch name, status badge, start/stop/delete action buttons, linked issue badges.
- **Tab bar** -- Logs | Terminal | Hooks, plus Claude controls. `Claude` appears as its own tab only when opened, otherwise a `+ Claude` quick action is shown.
- **Git action toolbar** -- contextual buttons for Commit (when uncommitted changes exist), Push (when unpushed commits exist), and PR (when pushed but no PR exists). Each expands an inline input form.
- **LogsViewer** -- streaming process output for running worktrees.
- **TerminalView** -- interactive xterm.js terminal. Sessions are lazily created and reused; terminal and Claude use separate session scopes. Closing the Claude tab explicitly destroys its session.
- **HooksTab** -- runs and displays hook results with visual state indicators (dashed/no-bg for unrun and running items, spinner during execution, solid card background for completed/disabled items). Supports command, prompt, and skill entries; auto-expands items with output when the pipeline completes. Receives real-time updates via `hook-update` SSE events.

### JiraDetailPanel (`JiraDetailPanel.tsx`)

Shows Jira issue details: summary, description (rendered as Markdown from Atlassian Document Format), status, priority, assignee, and comments. Provides both "Create Worktree" and "Code with Claude" actions.

### LinearDetailPanel (`LinearDetailPanel.tsx`)

Similar to JiraDetailPanel but for Linear issues. Shows title, description, state, priority, assignee, labels, and attachment previews/download links via a Linear attachment proxy endpoint to avoid auth/CORS failures. Also supports "Code with Claude".

### CustomTaskDetailPanel (`CustomTaskDetailPanel.tsx`)

Detail view for local custom tasks. Supports inline editing of title, description, status, priority, and labels. Shows file attachments with image preview support and supports "Code with Claude".

### Other Detail Panels

- **McpServerDetailPanel** -- MCP server configuration, environment variables, deployment status across agents.
- **SkillDetailPanel** -- Skill markdown editing (skill.md, reference.md, examples.md), frontmatter editing, deployment status.
- **PluginDetailPanel** -- Claude plugin details, install/uninstall/enable/disable actions.

### Supporting Components

| Component                | Purpose                                                                         |
| ------------------------ | ------------------------------------------------------------------------------- |
| `LogsViewer.tsx`         | ANSI-aware streaming log output with auto-scroll                                |
| `TerminalView.tsx`       | xterm.js terminal with WebSocket connection                                     |
| `HooksTab.tsx`           | Hooks runner with animated running state and step/skill result display          |
| `GitActionInputs.tsx`    | Inline commit message and PR title input forms                                  |
| `ActionToolbar.tsx`      | Git action buttons (commit, push, PR)                                           |
| `DetailHeader.tsx`       | Worktree name/branch display with inline edit and action buttons                |
| `NotesSection.tsx`       | PersonalNotesSection + AgentSection (tabbed: Context, Todos, Git Policy, Hooks) |
| `TodoList.tsx`           | Checkbox todo items attached to issues                                          |
| `AgentPolicySection.tsx` | Per-issue agent git policy overrides                                            |

---

## Hooks and Data Fetching

All hooks live in `src/ui/hooks/`.

### Real-Time Updates via SSE

**`useWorktrees`** (`useWorktrees.ts`) establishes an `EventSource` connection to `/api/events`. The server pushes several event types:

- `worktrees` -- worktree state updates (status, logs, git state)
- `notification` -- error/info notifications displayed as toast messages
- `hook-update` -- signals that hook results changed for a worktree, triggering auto-refetch in the HooksTab
- `activity-history` -- batch of recent events on initial connection (dispatched as `dawg:activity-history` CustomEvent)
- `activity` -- individual real-time activity events (dispatched as `dawg:activity` CustomEvent)

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

Issue hooks support configurable refresh intervals (from integration settings) and search query debouncing (300ms).

### WebSocket Terminal

**`useTerminal`** (`useTerminal.ts`) manages interactive PTY sessions:

1. `connect()` -- POST to `/api/worktrees/:id/terminals` to create a session, then opens a WebSocket to `/api/terminals/:sessionId/ws`.
2. `createSessionStartupCommand` (optional) -- when provided (Claude flow), the session starts with a shell startup command.
3. `sendData(data)` -- forwards keystrokes to the PTY via WebSocket.
4. `sendResize(cols, rows)` -- sends terminal resize events.
5. `disconnect()` -- closes WebSocket only (session stays alive for reconnect/tab switches).
6. `destroy()` -- explicitly destroys the server-side session.

Sessions are keyed by `worktreeId + scope` (`terminal` or `claude`). `TerminalView` keeps sessions alive across tab switches/navigation and reattaches on reconnect.

### Configuration

**`useConfig`** (`useConfig.ts`) fetches `.dawg/config.json` from the server. Returns the config object, project name, whether a branch name rule exists, and loading state.

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

When `serverUrl` is `null` (web mode), requests use relative URLs. When provided (Electron mode), requests use the full URL (e.g., `http://localhost:6970/api/worktrees`).

The file contains functions for every API endpoint: worktree CRUD, git operations (commit, push, PR), Jira/Linear/GitHub integration management, terminal sessions, MCP server management, skills, plugins, notes, todos, hooks, and configuration.

### `useApi.ts` -- Bound hook

The `useApi()` hook reads the current `serverUrl` from `ServerContext` and returns a memoized object where every API function is pre-bound to that URL:

```typescript
const api = useApi();
await api.startWorktree(worktreeId); // serverUrl is automatically included
```

This means components never need to think about which server they are talking to.

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

Selection state is persisted to `localStorage` under the key `dawg:wsSel:{serverUrl}`. This means each project in Electron mode remembers its own selection independently.

Similarly persisted per server URL:

- Active view: `dawg:view:{serverUrl}`
- Active sidebar tab (branch/issues): `dawg:wsTab:{serverUrl}`
- Sidebar width: `dawg:sidebarWidth` (global, not per-project)

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

### ServerContext (`src/ui/contexts/ServerContext.tsx`)

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

Each project is a separate dawg server running on a different port. The `serverUrl` is derived from the active project's port: `http://localhost:{port}`.

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
- **Sweeping border** (currently commented out) -- hook items previously displayed a teal gradient "comet" that sweeps around the card border during execution. The `SweepingBorder` component is still defined in `HooksTab.tsx` but its usage is commented out, replaced by a circular progress spinner (`Loader2`) in the status icon position. The CSS keyframes (`border-sweep`, `border-sweep-fade`) remain defined in `src/ui/index.css`.

---

## File Index

### Components (`src/ui/components/`)

| File                        | Description                                                                                                                                                  |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AgentsView.tsx`            | Top-level agents management view                                                                                                                             |
| `AgentsSidebar.tsx`         | Sidebar for agents view (MCP servers, skills, plugins lists)                                                                                                 |
| `AgentsToolbar.tsx`         | Toolbar for agents view actions                                                                                                                              |
| `AppSettingsModal.tsx`      | Electron app settings (themes, preferences)                                                                                                                  |
| `AttachmentImage.tsx`       | Image attachment preview with lightbox                                                                                                                       |
| `Button.tsx`                | Reusable button component                                                                                                                                    |
| `ConfigurationPanel.tsx`    | Edit `.dawg/config.json` settings                                                                                                                            |
| `ConfirmDialog.tsx`         | Confirmation dialog for destructive actions                                                                                                                  |
| `ConfirmModal.tsx`          | Generic confirmation modal                                                                                                                                   |
| `CreateCustomTaskModal.tsx` | Create new custom task form                                                                                                                                  |
| `CreateForm.tsx`            | Sidebar tab switcher (Branch/Issues) with create buttons                                                                                                     |
| `CreateWorktreeModal.tsx`   | Create worktree modal (from branch, Jira, or Linear)                                                                                                         |
| `CustomTaskItem.tsx`        | Custom task sidebar list item                                                                                                                                |
| `CustomTaskList.tsx`        | Custom task list in sidebar                                                                                                                                  |
| `DeployDialog.tsx`          | MCP server/skill deployment dialog                                                                                                                           |
| `GitHubSetupModal.tsx`      | GitHub initial setup (commit + repo creation)                                                                                                                |
| `Header.tsx`                | Top header bar with nav tabs, running count, and activity bell icon                                                                                          |
| `ImageModal.tsx`            | Full-screen image lightbox                                                                                                                                   |
| `IntegrationsPanel.tsx`     | Configure Jira/Linear/GitHub integrations                                                                                                                    |
| `IssueList.tsx`             | Aggregated issue list (Jira + Linear + custom tasks)                                                                                                         |
| `JiraIssueItem.tsx`         | Jira issue sidebar item                                                                                                                                      |
| `JiraIssueList.tsx`         | Jira-specific issue list                                                                                                                                     |
| `LinearIssueItem.tsx`       | Linear issue sidebar item                                                                                                                                    |
| `LinearIssueList.tsx`       | Linear-specific issue list                                                                                                                                   |
| `MarkdownContent.tsx`       | Markdown renderer with dark theme styling                                                                                                                    |
| `McpServerCreateModal.tsx`  | Create/edit MCP server modal                                                                                                                                 |
| `McpServerItem.tsx`         | MCP server sidebar item                                                                                                                                      |
| `McpServerScanModal.tsx`    | Scan and import MCP servers/skills (supports direct device-scan entry from discovery banner and prefilled results from the latest banner scan)               |
| `Modal.tsx`                 | Base modal component (sm/md/lg widths)                                                                                                                       |
| `NavBar.tsx`                | Navigation bar (defines View type)                                                                                                                           |
| `PluginInstallModal.tsx`    | Install Claude plugin modal                                                                                                                                  |
| `PluginItem.tsx`            | Plugin sidebar item                                                                                                                                          |
| `ProjectSetupScreen.tsx`    | First-run setup for new Electron projects                                                                                                                    |
| `ResizableHandle.tsx`       | Drag handle for sidebar resizing                                                                                                                             |
| `SetupCommitModal.tsx`      | Commit dawg config files modal                                                                                                                               |
| `SkillCreateModal.tsx`      | Create/edit skill modal                                                                                                                                      |
| `SkillItem.tsx`             | Skill sidebar item                                                                                                                                           |
| `Spinner.tsx`               | Loading spinner component                                                                                                                                    |
| `TabBar.tsx`                | Electron multi-project tab bar                                                                                                                               |
| `ActivityFeed.tsx`          | Activity feed dropdown panel with bell icon, action-required top section, expandable hook-run entries, and clickable worktree links                          |
| `Toast.tsx`                 | Animated toast notification (error=red, success=green, info=teal, loading=amber) with groupKey deduplication, grouped children, project name, worktree links |
| `Tooltip.tsx`               | Tooltip component (always use this instead of native `title` attribute)                                                                                      |
| `TruncatedTooltip.tsx`      | Text with automatic tooltip on overflow                                                                                                                      |
| `VerificationPanel.tsx`     | Hooks configuration view (trigger-based command steps and skills)                                                                                            |
| `WelcomeScreen.tsx`         | Initial welcome/onboarding screen                                                                                                                            |
| `WorktreeExistsModal.tsx`   | Handle worktree already exists error                                                                                                                         |
| `WorktreeItem.tsx`          | Worktree sidebar list item                                                                                                                                   |
| `WorktreeList.tsx`          | Worktree list in sidebar                                                                                                                                     |

### Detail Components (`src/ui/components/detail/`)

| File                        | Description                                                                         |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `DetailPanel.tsx`           | Worktree detail (logs, terminal, hooks, git actions)                                |
| `DetailHeader.tsx`          | Worktree header with inline rename and action buttons                               |
| `JiraDetailPanel.tsx`       | Jira issue detail view                                                              |
| `LinearDetailPanel.tsx`     | Linear issue detail view                                                            |
| `CustomTaskDetailPanel.tsx` | Custom task detail with inline editing                                              |
| `McpServerDetailPanel.tsx`  | MCP server detail and deployment                                                    |
| `SkillDetailPanel.tsx`      | Skill detail with markdown editor                                                   |
| `AgentRuleDetailPanel.tsx`  | Agent rule file viewer/editor (CLAUDE.md, AGENTS.md)                                |
| `PluginDetailPanel.tsx`     | Claude plugin detail                                                                |
| `LogsViewer.tsx`            | Streaming ANSI log output                                                           |
| `TerminalView.tsx`          | xterm.js interactive terminal                                                       |
| `HooksTab.tsx`              | Hooks runner with multi-expand, pipeline auto-expand, and circular progress spinner |
| `GitActionInputs.tsx`       | Inline commit/PR input forms                                                        |
| `ActionToolbar.tsx`         | Git action buttons                                                                  |
| `NotesSection.tsx`          | PersonalNotesSection + AgentSection (tabbed: Context, Todos, Git Policy, Hooks)     |
| `TodoList.tsx`              | Checkbox todo items                                                                 |
| `AgentPolicySection.tsx`    | Per-issue agent git policy overrides                                                |

### Hooks (`src/ui/hooks/`)

| File                      | Description                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------- |
| `api.ts`                  | Raw fetch functions for all API endpoints                                                      |
| `useApi.ts`               | Hook that pre-binds API functions to current server URL                                        |
| `useConfig.ts`            | Fetch and cache `.dawg/config.json`                                                            |
| `useCustomTasks.ts`       | React Query hook for custom tasks list                                                         |
| `useCustomTaskDetail.ts`  | React Query hook for single custom task                                                        |
| `useJiraIssues.ts`        | React Query hook for Jira issues with search debouncing                                        |
| `useJiraIssueDetail.ts`   | React Query hook for single Jira issue                                                         |
| `useLinearIssues.ts`      | React Query hook for Linear issues with search debouncing                                      |
| `useLinearIssueDetail.ts` | React Query hook for single Linear issue                                                       |
| `useMcpServers.ts`        | Hooks for MCP server data                                                                      |
| `useNotes.ts`             | Hook for issue notes and todos                                                                 |
| `useSkills.ts`            | Hooks for skills data                                                                          |
| `useTerminal.ts`          | WebSocket terminal session management                                                          |
| `useAgentRules.ts`        | React Query hook for agent rule file content                                                   |
| `useHooks.ts`             | Hooks config and skill results fetching                                                        |
| `useActivityFeed.ts`      | Activity feed state, unread count, chronological upserts, hook-run aggregation, toast triggers |
| `useWorktrees.ts`         | SSE-based real-time worktree updates + integration status hooks                                |

### Context (`src/ui/contexts/`)

| File                | Description                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `ServerContext.tsx` | Multi-project server URL management, Electron IPC bridge                                                                                                                             |
| `ToastContext.tsx`  | Toast notification state management with `addToast`, `upsertToast`, `upsertGroupedToast` (grouped children), `toggleToastExpanded`, auto-dismiss, `projectName`/`worktreeId` support |
