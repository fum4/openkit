# Configuration Reference

OpenKit uses several configuration files at both the project level (`.openkit/` directory) and the global level (`~/.openkit/` directory). This document covers every file and field.

---

## Table of Contents

- [Project Configuration (`.openkit/config.json`)](#project-configuration-openkitconfigjson)
- [Integrations (`.openkit/integrations.json`)](#integrations-openkitintegrationsjson)
- [Hooks (`.openkit/hooks.json`)](#hooks-openkithooksjson)
- [Branch Naming Rules (`.openkit/scripts/branch-name.mjs`)](#branch-naming-rules)
- [Commit Message Rules (`.openkit/scripts/commit-message.mjs`)](#commit-message-rules)
- [Server Discovery (`.openkit/server.json`)](#server-discovery-openkitserverjson)
- [Issue Data (`.openkit/issues/`)](#issue-data-openkitissues)
- [Issue Notes (`.openkit/issues/<source>/<id>/notes.json`)](#issue-notes)
- [MCP Environment Overrides (`.openkit/mcp-env.json`)](#mcp-environment-overrides-openkitmcp-envjson)
- [Worktree Directory (`.openkit/worktrees/`)](#worktree-directory-openkitworktrees)
- [Git Ignore (`.openkit/.gitignore`)](#git-ignore-openkitgitignore)
- [Global Preferences (`~/.openkit/app-preferences.json`)](#global-preferences-openkitapp-preferencesjson)
- [MCP Server Registry (`~/.openkit/mcp-servers.json`)](#mcp-server-registry-openkitmcp-serversjson)

---

## Project Configuration (`.openkit/config.json`)

The primary configuration file. Created by `openkit init` (interactive CLI) or via the UI's setup wizard. This file should be committed to your repository so that all team members share the same configuration.

### Full Example

```json
{
  "projectDir": ".",
  "startCommand": "pnpm dev",
  "installCommand": "pnpm install",
  "baseBranch": "origin/main",
  "autoInstall": true,
  "localIssuePrefix": "LOCAL",
  "localAutoStartAgent": "claude",
  "localAutoStartClaudeOnNewIssue": false,
  "localAutoStartClaudeSkipPermissions": true,
  "localAutoStartClaudeFocusTerminal": true,
  "openProjectTarget": "cursor",
  "allowAgentCommits": false,
  "allowAgentPushes": false,
  "allowAgentPRs": false,
  "ports": {
    "discovered": [3000, 3001, 5173],
    "offsetStep": 1
  },
  "envMapping": {
    "VITE_API_URL": "http://localhost:${3001}"
  }
}
```

### Field Reference

#### `projectDir`

| Property     | Value    |
| ------------ | -------- |
| **Type**     | `string` |
| **Default**  | `"."`    |
| **Required** | No       |

Subdirectory to `cd` into before running the start command, relative to the repository root. Useful for monorepos where the dev server lives in a subdirectory (e.g., `"apps/storefront"`). Set to `"."` for single-package repositories.

#### `startCommand`

| Property     | Value        |
| ------------ | ------------ |
| **Type**     | `string`     |
| **Default**  | `""` (empty) |
| **Required** | Yes          |

Command to start the dev server in each worktree. Auto-detected from the package manager lockfile during `openkit init`.

Examples: `"pnpm dev"`, `"npm run dev"`, `"yarn dev"`, `"bun dev"`

#### `installCommand`

| Property     | Value        |
| ------------ | ------------ |
| **Type**     | `string`     |
| **Default**  | `""` (empty) |
| **Required** | Yes          |

Command to install dependencies when a new worktree is created. Auto-detected from the package manager lockfile during `openkit init`.

Examples: `"pnpm install"`, `"npm install"`, `"yarn install"`, `"bun install"`

#### `baseBranch`

| Property     | Value           |
| ------------ | --------------- |
| **Type**     | `string`        |
| **Default**  | `"origin/main"` |
| **Required** | No              |

The base branch from which new worktrees are created. During `openkit init`, this is auto-detected by checking `refs/remotes/origin/HEAD` and then falling back to `origin/develop`, `origin/main`, or `origin/master` in that order.

Examples: `"origin/main"`, `"origin/develop"`, `"origin/master"`

#### `autoInstall`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `true`    |
| **Required** | No        |

Whether to automatically run the `installCommand` when creating a new worktree. Set to `false` if you prefer to install dependencies manually.

#### `localIssuePrefix`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `string`  |
| **Default**  | `"LOCAL"` |
| **Required** | No        |

Prefix used for local issue identifiers. Local issues are auto-numbered with this prefix, producing identifiers like `LOCAL-1`, `LOCAL-2`, etc. Change this to match your project's naming convention (e.g., `"TASK"`, `"TODO"`).

#### `localAutoStartAgent`

| Property     | Value                                           |
| ------------ | ----------------------------------------------- |
| **Type**     | `"claude" \| "codex" \| "gemini" \| "opencode"` |
| **Default**  | `"claude"`                                      |
| **Required** | No                                              |

Selected coding agent for local-task auto-start.

#### `localAutoStartClaudeOnNewIssue`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `false`   |
| **Required** | No        |

Whether newly created local issues should auto-create/open a worktree and auto-start the selected agent.

#### `localAutoStartClaudeSkipPermissions`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `true`    |
| **Required** | No        |

Whether local auto-start runs with the selected agent's skip-permissions mode.

#### `localAutoStartClaudeFocusTerminal`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `true`    |
| **Required** | No        |

Whether the UI should switch focus to the auto-started local-task agent terminal.

#### `openProjectTarget`

| Property     | Value            |
| ------------ | ---------------- |
| **Type**     | `string`         |
| **Default**  | `"file-manager"` |
| **Required** | No               |

Preferred app target for the worktree detail panel's split `Open` button. This value is updated when a user opens a worktree via a selected target in the UI.

Allowed values:

- `"file-manager"` (Finder on macOS, file manager on Linux)
- `"cursor"`
- `"vscode"`
- `"zed"`
- `"intellij"`
- `"webstorm"`
- `"terminal"`
- `"warp"`
- `"ghostty"`
- `"neovim"`

At runtime, the UI only shows targets that are autodetected on the current machine. If the configured value is unavailable, the server falls back to the first detected target by priority.

#### `allowAgentCommits`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `false`   |
| **Required** | No        |

Global policy controlling whether MCP agents (e.g., Claude Code) are allowed to create git commits in worktrees. Can be overridden per-worktree via the issue notes git policy.

#### `allowAgentPushes`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `false`   |
| **Required** | No        |

Global policy controlling whether MCP agents are allowed to push commits to the remote. Can be overridden per-worktree via the issue notes git policy.

#### `allowAgentPRs`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `boolean` |
| **Default**  | `false`   |
| **Required** | No        |

Global policy controlling whether MCP agents are allowed to create pull requests. Can be overridden per-worktree via the issue notes git policy.

#### `ports`

| Property     | Value                                   |
| ------------ | --------------------------------------- |
| **Type**     | `object`                                |
| **Default**  | `{ "discovered": [], "offsetStep": 1 }` |
| **Required** | No                                      |

Port configuration for the automatic port-offsetting system.

##### `ports.discovered`

| Property    | Value      |
| ----------- | ---------- |
| **Type**    | `number[]` |
| **Default** | `[]`       |

Array of ports that the dev server listens on. Populated automatically via the "Discover Ports" feature in the UI, which runs the `startCommand` and uses `lsof` to detect which ports are opened.

Example: `[3000, 3001, 5173]`

##### `ports.offsetStep`

| Property    | Value    |
| ----------- | -------- |
| **Type**    | `number` |
| **Default** | `1`      |

How much to increment ports per worktree instance. The first worktree gets offset `1 * offsetStep`, the second gets `2 * offsetStep`, etc.

With `offsetStep: 1` and `discovered: [3000, 5173]`:

- Worktree 1: ports 3001, 5174
- Worktree 2: ports 3002, 5175

With `offsetStep: 10`:

- Worktree 1: ports 3010, 5183
- Worktree 2: ports 3020, 5193

#### `activity`

| Property     | Value     |
| ------------ | --------- |
| **Type**     | `object`  |
| **Default**  | See below |
| **Required** | No        |

Activity feed configuration. Controls event retention plus per-category/per-event filtering. Workflow/agent/live updates are tracked in the Activity feed; toasts are reserved for direct user-action success/failure. Native OS notifications (Electron) are reserved for agent-attention events.

```json
{
  "activity": {
    "retentionDays": 7,
    "categories": {
      "agent": true,
      "worktree": true,
      "system": true
    },
    "disabledEvents": [],
    "osNotificationEvents": ["agent_awaiting_input"]
  }
}
```

| Sub-field              | Type                      | Default    | Description                                                                            |
| ---------------------- | ------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| `retentionDays`        | `number`                  | `7`        | How many days to keep activity events before pruning                                   |
| `categories`           | `Record<string, boolean>` | All `true` | Per-category toggles for which events appear in the feed                               |
| `disabledEvents`       | `string[]`                | `[]`       | Event-type toggles. Any listed event type is disabled for the Activity feed/SSE stream |
| `toastEvents`          | `string[]`                | See above  | Legacy compatibility field; do not use it for workflow/agent/live updates              |
| `osNotificationEvents` | `string[]`                | See above  | Default notification event list (`agent_awaiting_input`) kept in activity config       |

Activity events are persisted to `.openkit/activity.jsonl` in JSONL format. The file is pruned on server startup and periodically (every hour).

#### `envMapping`

| Property     | Value                    |
| ------------ | ------------------------ |
| **Type**     | `Record<string, string>` |
| **Default**  | `undefined`              |
| **Required** | No                       |

Environment variable templates with port references. When a worktree process starts, these variables are set in the process environment with ports replaced by their offset values.

Port references use the `${PORT}` syntax where `PORT` is the original (base) port number:

```json
{
  "envMapping": {
    "VITE_API_URL": "http://localhost:${3001}",
    "DATABASE_URL": "postgresql://localhost:${5432}/mydb"
  }
}
```

If the worktree gets offset 1, `${3001}` becomes `3002` and `${5432}` becomes `5433`.

The UI includes a "Detect Env Mapping" button that scans your project's `.env` files and source code to find references to discovered ports.

---

## Integrations (`.openkit/integrations.json`)

Stores credentials and per-project settings for issue tracker integrations. This file is **not** committed to git (covered by `.openkit/.gitignore`).

### Structure

```json
{
  "jira": {
    "authMethod": "oauth",
    "oauth": { ... },
    "defaultProjectKey": "PROJ",
    "refreshIntervalMinutes": 5,
    "dataLifecycle": { ... },
    "autoStartAgent": "claude",
    "autoStartClaudeOnNewIssue": false,
    "autoStartClaudeSkipPermissions": true,
    "autoStartClaudeFocusTerminal": true
  },
  "linear": {
    "apiKey": "lin_api_...",
    "displayName": "My Workspace",
    "defaultTeamKey": "ENG",
    "refreshIntervalMinutes": 5,
    "dataLifecycle": { ... },
    "autoStartAgent": "claude",
    "autoStartClaudeOnNewIssue": false,
    "autoStartClaudeSkipPermissions": true,
    "autoStartClaudeFocusTerminal": true
  }
}
```

### Jira Credentials

Jira supports two authentication methods:

**OAuth (recommended):**

| Field                | Type      | Description                                          |
| -------------------- | --------- | ---------------------------------------------------- |
| `authMethod`         | `"oauth"` | Authentication method selector                       |
| `oauth.clientId`     | `string`  | Jira OAuth app client ID                             |
| `oauth.clientSecret` | `string`  | Jira OAuth app client secret                         |
| `oauth.accessToken`  | `string`  | Current access token (auto-refreshed)                |
| `oauth.refreshToken` | `string`  | Refresh token                                        |
| `oauth.expiresAt`    | `number`  | Token expiry timestamp                               |
| `oauth.cloudId`      | `string`  | Atlassian Cloud ID                                   |
| `oauth.siteUrl`      | `string`  | Jira site URL (e.g., `https://myteam.atlassian.net`) |

**API Token:**

| Field              | Type          | Description                    |
| ------------------ | ------------- | ------------------------------ |
| `authMethod`       | `"api-token"` | Authentication method selector |
| `apiToken.baseUrl` | `string`      | Jira instance URL              |
| `apiToken.email`   | `string`      | Account email                  |
| `apiToken.token`   | `string`      | API token                      |

### Jira Project Config

| Field                            | Type                                            | Default     | Description                                                                 |
| -------------------------------- | ----------------------------------------------- | ----------- | --------------------------------------------------------------------------- |
| `defaultProjectKey`              | `string`                                        | `undefined` | Default Jira project key for issue fetching (e.g., `"PROJ"`)                |
| `refreshIntervalMinutes`         | `number`                                        | `undefined` | How often to re-fetch issue lists (in minutes)                              |
| `dataLifecycle`                  | `object`                                        | `undefined` | Controls when and how issue data is cached/cleaned                          |
| `autoStartAgent`                 | `"claude" \| "codex" \| "gemini" \| "opencode"` | `"claude"`  | Which agent is launched for Jira auto-start                                 |
| `autoStartClaudeOnNewIssue`      | `boolean`                                       | `undefined` | Whether newly fetched Jira issues should auto-start the selected agent      |
| `autoStartClaudeSkipPermissions` | `boolean`                                       | `undefined` | Whether auto-started Jira sessions run with skip-permissions enabled        |
| `autoStartClaudeFocusTerminal`   | `boolean`                                       | `true`      | Whether UI should auto-focus the Jira agent terminal when auto-start begins |

### Linear Credentials

| Field         | Type     | Description                     |
| ------------- | -------- | ------------------------------- |
| `apiKey`      | `string` | Linear API key                  |
| `displayName` | `string` | Optional workspace display name |

### Linear Project Config

| Field                            | Type                                            | Default     | Description                                                                   |
| -------------------------------- | ----------------------------------------------- | ----------- | ----------------------------------------------------------------------------- |
| `defaultTeamKey`                 | `string`                                        | `undefined` | Default Linear team key for issue fetching (e.g., `"ENG"`)                    |
| `refreshIntervalMinutes`         | `number`                                        | `undefined` | How often to re-fetch issue lists (in minutes)                                |
| `dataLifecycle`                  | `object`                                        | `undefined` | Controls when and how issue data is cached/cleaned                            |
| `autoStartAgent`                 | `"claude" \| "codex" \| "gemini" \| "opencode"` | `"claude"`  | Which agent is launched for Linear auto-start                                 |
| `autoStartClaudeOnNewIssue`      | `boolean`                                       | `undefined` | Whether newly fetched Linear issues should auto-start the selected agent      |
| `autoStartClaudeSkipPermissions` | `boolean`                                       | `undefined` | Whether auto-started Linear sessions run with skip-permissions enabled        |
| `autoStartClaudeFocusTerminal`   | `boolean`                                       | `true`      | Whether UI should auto-focus the Linear agent terminal when auto-start begins |

### Data Lifecycle Config

Both Jira and Linear share the same data lifecycle structure:

```json
{
  "dataLifecycle": {
    "saveOn": "view",
    "autoCleanup": {
      "enabled": false,
      "statusTriggers": ["Done", "Closed"],
      "actions": {
        "issueData": true,
        "attachments": true,
        "notes": false,
        "linkedWorktree": false
      }
    }
  }
}
```

| Field                                | Type       | Values                                     | Description                         |
| ------------------------------------ | ---------- | ------------------------------------------ | ----------------------------------- |
| `saveOn`                             | `string`   | `"view"`, `"worktree-creation"`, `"never"` | When to cache issue data locally    |
| `autoCleanup.enabled`                | `boolean`  |                                            | Whether to auto-clean cached data   |
| `autoCleanup.statusTriggers`         | `string[]` |                                            | Issue statuses that trigger cleanup |
| `autoCleanup.actions.issueData`      | `boolean`  |                                            | Delete cached `issue.json`          |
| `autoCleanup.actions.attachments`    | `boolean`  |                                            | Delete downloaded attachments       |
| `autoCleanup.actions.notes`          | `boolean`  |                                            | Delete user notes                   |
| `autoCleanup.actions.linkedWorktree` | `boolean`  |                                            | Unlink the associated worktree      |

---

## Hooks (`.openkit/hooks.json`)

Configures automated checks (command steps) and agent skills organized by trigger type. Managed through the UI's Hooks panel or the MCP API.

For full documentation of the hooks system including trigger types, item types, configuration schema, execution details, and API endpoints, see [Hooks](HOOKS.md).

### Run Results

Hook run results are stored per-worktree at:

```
.openkit/worktrees/<worktreeId>/hooks/latest-run.json
.openkit/worktrees/<worktreeId>/hooks/skill-results.json
```

---

## Branch Naming Rules

Branch names are generated from issue metadata when creating worktrees from issues. The rules are JavaScript functions stored as `.mjs` files.

### File Locations

| File                                      | Scope                        |
| ----------------------------------------- | ---------------------------- |
| `.openkit/scripts/branch-name.mjs`        | Default rule for all sources |
| `.openkit/scripts/branch-name.jira.mjs`   | Override for Jira issues     |
| `.openkit/scripts/branch-name.linear.mjs` | Override for Linear issues   |
| `.openkit/scripts/branch-name.local.mjs`  | Override for local issues    |

Source-specific overrides take priority over the default rule when the issue comes from that source.

### Rule Format

Each file must export a default function that receives an object with `issueId`, `name`, and `type` properties, and returns a branch name string:

```javascript
export default ({ issueId, name, type }) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return `${issueId}/${slug}`;
};
```

**Parameters:**

| Parameter | Type     | Description                                                    |
| --------- | -------- | -------------------------------------------------------------- |
| `issueId` | `string` | Issue identifier (e.g., `"PROJ-123"`, `"ENG-45"`, `"LOCAL-1"`) |
| `name`    | `string` | Issue title / summary                                          |
| `type`    | `string` | Issue source: `"jira"`, `"linear"`, or `"local"`               |

**Built-in default** (used when no custom rule file exists):

```javascript
({ issueId, name }) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

  return `${issueId}/${slug}`;
};
```

This produces branches like `PROJ-123/fix_login_page_crash`.

### Example: Feature Branch Convention

```javascript
export default ({ issueId, name }) => {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

  return `feature/${issueId}-${slug}`;
};
```

Produces: `feature/PROJ-123-fix-login-page-crash`

---

## Commit Message Rules

Similar to branch naming, commit messages can be formatted via JavaScript functions.

### File Locations

| File                                         | Scope                                     |
| -------------------------------------------- | ----------------------------------------- |
| `.openkit/scripts/commit-message.mjs`        | Default rule for all sources              |
| `.openkit/scripts/commit-message.jira.mjs`   | Override for Jira-linked worktrees        |
| `.openkit/scripts/commit-message.linear.mjs` | Override for Linear-linked worktrees      |
| `.openkit/scripts/commit-message.local.mjs`  | Override for local-issue-linked worktrees |

Source-specific overrides take priority over the default rule.

### Rule Format

Each file must export a default function:

```javascript
export default ({ issueId, message, source }) => {
  if (issueId) {
    return `[${issueId}] ${message}`;
  }
  return message;
};
```

**Parameters:**

| Parameter | Type             | Description                                               |
| --------- | ---------------- | --------------------------------------------------------- |
| `message` | `string`         | The commit message entered by the user or agent           |
| `issueId` | `string \| null` | Linked issue identifier, or `null` if no issue is linked  |
| `source`  | `string \| null` | Issue source (`"jira"`, `"linear"`, `"local"`), or `null` |

**Built-in default** (used when no custom rule file exists): Returns `message` unchanged.

### Example: Conventional Commits

```javascript
export default ({ issueId, message }) => {
  if (issueId) {
    return `${message}\n\nRef: ${issueId}`;
  }
  return message;
};
```

---

## Server Discovery (`.openkit/server.json`)

A runtime file written when the OpenKit server starts and deleted on shutdown. It is **not** committed to git.

### Structure

```json
{
  "url": "http://localhost:6969",
  "pid": 12345
}
```

| Field | Type     | Description                                   |
| ----- | -------- | --------------------------------------------- |
| `url` | `string` | The URL where the OpenKit server is listening |
| `pid` | `number` | The operating system process ID of the server |

### Purpose

- Used by `openkit mcp` to find a running server and start in proxy mode (relaying MCP messages to the HTTP server instead of spawning a standalone instance).
- Used by `openkit connect` to connect the Electron app to an existing server.
- The `pid` is validated with `process.kill(pid, 0)` to check whether the process is still alive. If the process is dead, the stale `server.json` is ignored.

---

## Issue Data (`.openkit/issues/`)

Cached issue data from integrations, organized by source and issue identifier.

### Directory Structure

```
.openkit/issues/
  jira/
    <issueKey>/           # e.g., "PROJ-123"
      issue.json          # Cached Jira issue data (JiraTaskData)
      notes.json          # User notes, todos, git policy (see Issue Notes)
  linear/
    <identifier>/         # e.g., "ENG-45"
      issue.json          # Cached Linear issue data (LinearTaskData)
      notes.json          # User notes, todos, git policy
  local/
    <uuid>/               # UUID of the local task
      task.json           # Local task data (CustomTask)
      notes.json          # User notes, todos, git policy
      attachments/        # Uploaded files
        screenshot.png
    .counter              # Auto-increment counter for LOCAL-N identifiers
```

### `issue.json` (Jira)

Contains the full cached Jira issue including summary, description (Markdown), status, priority, type, assignee, reporter, labels, comments, attachments metadata, and the fetch timestamp.

### `issue.json` (Linear)

Contains the full cached Linear issue including identifier, title, description, state, priority, assignee, labels, comments, attachments, and the fetch timestamp.

### `task.json` (Local Issues)

```json
{
  "id": "uuid-here",
  "identifier": "LOCAL-1",
  "title": "Implement dark mode toggle",
  "description": "Add a toggle in the settings panel...",
  "status": "todo",
  "priority": "medium",
  "labels": ["ui", "settings"],
  "createdAt": "2025-01-15T10:00:00.000Z",
  "updatedAt": "2025-01-15T10:00:00.000Z"
}
```

| Field         | Type       | Values                              | Description                         |
| ------------- | ---------- | ----------------------------------- | ----------------------------------- |
| `id`          | `string`   | UUID                                | Unique identifier (directory name)  |
| `identifier`  | `string`   |                                     | Human-readable ID (e.g., `LOCAL-1`) |
| `title`       | `string`   |                                     | Task title                          |
| `description` | `string`   |                                     | Task description                    |
| `status`      | `string`   | `"todo"`, `"in-progress"`, `"done"` | Current status                      |
| `priority`    | `string`   | `"high"`, `"medium"`, `"low"`       | Priority level                      |
| `labels`      | `string[]` |                                     | Free-form labels                    |
| `createdAt`   | `string`   | ISO 8601                            | Creation timestamp                  |
| `updatedAt`   | `string`   | ISO 8601                            | Last update timestamp               |

---

## Issue Notes

Each issue (regardless of source) can have a `notes.json` file stored alongside its issue data.

### File Location

```
.openkit/issues/<source>/<id>/notes.json
```

### Structure

```json
{
  "linkedWorktreeId": "PROJ-123",
  "personal": {
    "content": "Remember to check the edge case with empty arrays",
    "updatedAt": "2025-01-15T10:00:00.000Z"
  },
  "aiContext": {
    "content": "This issue requires changes to the auth module...",
    "updatedAt": "2025-01-15T10:00:00.000Z"
  },
  "todos": [
    {
      "id": "uuid-here",
      "text": "Update unit tests",
      "checked": false,
      "createdAt": "2025-01-15T10:00:00.000Z"
    }
  ],
  "gitPolicy": {
    "agentCommits": "inherit",
    "agentPushes": "deny",
    "agentPRs": "deny"
  }
}
```

| Field                 | Type             | Description                                         |
| --------------------- | ---------------- | --------------------------------------------------- |
| `linkedWorktreeId`    | `string \| null` | ID of the worktree created from this issue          |
| `personal`            | `object \| null` | Free-form personal notes (visible only in UI)       |
| `personal.content`    | `string`         | Note text                                           |
| `personal.updatedAt`  | `string`         | ISO 8601 timestamp                                  |
| `aiContext`           | `object \| null` | Context injected into the `TASK.md` file for agents |
| `aiContext.content`   | `string`         | Context text                                        |
| `aiContext.updatedAt` | `string`         | ISO 8601 timestamp                                  |
| `todos`               | `array`          | Checklist items (trackable by agents via MCP tools) |
| `todos[].id`          | `string`         | UUID                                                |
| `todos[].text`        | `string`         | Todo text                                           |
| `todos[].checked`     | `boolean`        | Whether completed                                   |
| `todos[].createdAt`   | `string`         | ISO 8601 timestamp                                  |
| `gitPolicy`           | `object`         | Per-worktree git policy overrides                   |

### Git Policy Overrides

The `gitPolicy` object allows overriding the global agent git policy on a per-worktree basis:

| Field          | Type     | Values                           | Description                          |
| -------------- | -------- | -------------------------------- | ------------------------------------ |
| `agentCommits` | `string` | `"inherit"`, `"allow"`, `"deny"` | Override for commit permissions      |
| `agentPushes`  | `string` | `"inherit"`, `"allow"`, `"deny"` | Override for push permissions        |
| `agentPRs`     | `string` | `"inherit"`, `"allow"`, `"deny"` | Override for PR creation permissions |

**Resolution order:**

1. Per-worktree override (from the linked issue's `notes.json`) -- if `"allow"` or `"deny"`, use that
2. Global config (`allowAgentCommits`, `allowAgentPushes`, `allowAgentPRs` in `config.json`) -- used when override is `"inherit"` or absent
3. Default: `false` (deny)

---

## MCP Environment Overrides (`.openkit/mcp-env.json`)

Per-project environment variable overrides for MCP servers. When deploying an MCP server to an agent's config, these values are merged on top of the server's global `env` (from the registry).

### Structure

```json
{
  "my-server": {
    "API_KEY": "project-specific-key",
    "BASE_URL": "https://api.example.com"
  }
}
```

The keys are MCP server IDs (from the registry), and the values are `Record<string, string>` maps of environment variables.

---

## Worktree Directory (`.openkit/worktrees/`)

Git worktrees are stored under `.openkit/worktrees/<worktreeId>/`. Each subdirectory is a full git worktree checkout. When a worktree is created from an issue, a `TASK.md` file is generated in the worktree root containing the issue context, description, comments, AI context notes, and todos.

The `TASK.md` file is automatically added to the worktree's git exclude file (`.git/worktrees/<name>/info/exclude`) so it does not appear as an untracked file.

### Per-Worktree Hooks Data

```
.openkit/worktrees/<worktreeId>/hooks/
  latest-run.json       # Most recent command step run results
  skill-results.json    # Agent-reported skill results
```

---

## Git Ignore (`.openkit/.gitignore`)

Created automatically during `openkit init`. Uses a whitelist approach: everything in `.openkit/` is ignored except the files that should be shared with the team.

```gitignore
# Ignore everything in .openkit by default
*

# Except these files (tracked/shared)
!.gitignore
!config.json
```

This means:

- **Committed**: `config.json`, `.gitignore`
- **Not committed**: `integrations.json`, `server.json`, `hooks.json`, `mcp-env.json`, `worktrees/`, `issues/`, `scripts/`

If you want to share branch naming or commit message rules with your team, add the scripts directory to the whitelist:

```gitignore
!scripts/
!scripts/**
```

---

## Global Preferences (`~/.openkit/app-preferences.json`)

User-level preferences stored in the home directory. Not project-specific.

### Structure

```json
{
  "basePort": 6969,
  "setupPreference": "ask",
  "sidebarWidth": 300,
  "windowBounds": {
    "x": 100,
    "y": 100,
    "width": 1200,
    "height": 800
  }
}
```

### Field Reference

| Field                 | Type             | Default | Description                                                                                                             |
| --------------------- | ---------------- | ------- | ----------------------------------------------------------------------------------------------------------------------- |
| `basePort`            | `number`         | `6969`  | The port the OpenKit server listens on                                                                                  |
| `setupPreference`     | `string`         | `"ask"` | How to handle missing config: `"auto"` (auto-detect and create), `"manual"` (prompt), or `"ask"` (show UI setup screen) |
| `sidebarWidth`        | `number`         | `300`   | Sidebar width in pixels (persisted across sessions)                                                                     |
| `windowBounds`        | `object \| null` | `null`  | Electron window position and size                                                                                       |
| `windowBounds.x`      | `number`         |         | Window X position                                                                                                       |
| `windowBounds.y`      | `number`         |         | Window Y position                                                                                                       |
| `windowBounds.width`  | `number`         |         | Window width                                                                                                            |
| `windowBounds.height` | `number`         |         | Window height                                                                                                           |

---

## MCP Server Registry (`~/.openkit/mcp-servers.json`)

A global registry of MCP servers that can be deployed to various AI agents (Claude Code, Cursor, Windsurf, etc.). Managed via the OpenKit UI.

### Structure

```json
{
  "version": 1,
  "servers": {
    "my-server": {
      "id": "my-server",
      "name": "My MCP Server",
      "description": "Does useful things",
      "tags": ["tools", "search"],
      "command": "node",
      "args": ["/path/to/server.js"],
      "env": {
        "API_KEY": "global-default-key"
      },
      "source": "/path/where/discovered",
      "createdAt": "2025-01-15T10:00:00.000Z",
      "updatedAt": "2025-01-15T10:00:00.000Z"
    }
  }
}
```

### Server Entry Fields

| Field         | Type                     | Description                                              |
| ------------- | ------------------------ | -------------------------------------------------------- |
| `id`          | `string`                 | Unique identifier (slugified from name)                  |
| `name`        | `string`                 | Human-readable server name                               |
| `description` | `string`                 | What the server does                                     |
| `tags`        | `string[]`               | Categorization tags                                      |
| `command`     | `string`                 | Executable command (e.g., `"node"`, `"npx"`, `"python"`) |
| `args`        | `string[]`               | Command arguments                                        |
| `env`         | `Record<string, string>` | Default environment variables                            |
| `source`      | `string`                 | Where this server was discovered from (if scanned)       |
| `createdAt`   | `string`                 | ISO 8601 creation timestamp                              |
| `updatedAt`   | `string`                 | ISO 8601 last update timestamp                           |

Servers in this registry can be deployed (written to agent config files) or undeployed via the UI. The deployment supports both global and project-level scopes depending on the target agent.

---

## Constants

For reference, the following constants are defined in the codebase:

| Constant          | Value        | Description                                      |
| ----------------- | ------------ | ------------------------------------------------ |
| `APP_NAME`        | `"OpenKit"`  | Application name used in CLI output and branding |
| `CONFIG_DIR_NAME` | `".openkit"` | Name of the config directory at the project root |
| `DEFAULT_PORT`    | `6969`       | Default server port                              |
