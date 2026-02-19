# dawg REST API Reference

## Overview

dawg exposes a REST API via a [Hono](https://hono.dev/) HTTP server. The web UI, Electron app, MCP clients, and external integrations all communicate through this API. The server runs on `localhost` (default port `4040`, auto-incremented if occupied).

All endpoints return JSON unless otherwise noted. Standard response patterns:

- **Success**: `{ success: true, ... }` or domain-specific payloads
- **Error**: `{ success: false, error: "description" }` with appropriate HTTP status code
- **CORS**: Enabled for all origins (`*`)

---

## Worktree Management

Core CRUD and lifecycle operations for git worktrees.

#### `GET /api/worktrees`

List all managed worktrees with their current status.

- **Response**: `{ worktrees: WorktreeInfo[] }`

Each `WorktreeInfo` object includes: `id`, `path`, `branch`, `status` (`"running"` | `"stopped"` | `"starting"` | `"creating"`), `ports`, `offset`, `pid`, `lastActivity`, `jiraUrl`, `jiraStatus`, `githubPrUrl`, `githubPrState`, `linearUrl`, `linearStatus`, `localIssueId`, `localIssueStatus`, `hasUncommitted`, `hasUnpushed`, `commitsAhead`, `commitsAheadOfBase`.

#### `POST /api/worktrees`

Create a new worktree.

- **Request**:
  ```json
  {
    "branch": "feature/my-branch",
    "id": "optional-custom-id",
    "name": "optional-display-name"
  }
  ```
  Only `branch` is required.
- **Response** (201): `{ success: true, worktree: WorktreeInfo, ports?: number[], pid?: number }`
- **Error** (400): `{ success: false, error: "..." }`

#### `POST /api/worktrees/:id/start`

Start the dev server process for a worktree.

- **Response**: `{ success: true, ... }` with port and PID info
- **Error** (400): `{ success: false, error: "..." }`

#### `POST /api/worktrees/:id/stop`

Stop the running dev server process for a worktree.

- **Response**: `{ success: true, ... }`
- **Error** (400): `{ success: false, error: "..." }`

#### `PATCH /api/worktrees/:id`

Rename a worktree (directory name and/or branch).

- **Request**:
  ```json
  {
    "name": "new-directory-name",
    "branch": "new-branch-name"
  }
  ```
  Both fields are optional.
- **Response**: `{ success: true, ... }`
- **Error** (400): `{ success: false, error: "..." }`

#### `DELETE /api/worktrees/:id`

Remove a worktree. Also destroys any associated terminal sessions.

- **Response**: `{ success: true, ... }`
- **Error** (400): `{ success: false, error: "..." }`

#### `GET /api/worktrees/:id/logs`

Get process output logs for a worktree.

- **Response**: `{ logs: string[] }`

#### `POST /api/worktrees/:id/recover`

Recover a worktree that has become inconsistent (e.g., directory deleted externally).

- **Request**:
  ```json
  {
    "action": "reuse",
    "branch": "optional-branch-override"
  }
  ```
  `action` must be `"reuse"` or `"recreate"`.
- **Response**: `{ success: true, ... }`
- **Error** (400): `{ success: false, error: "..." }`

---

## Agent Rules

Read, write, and delete project-level agent instruction files (CLAUDE.md, AGENTS.md) at the project root.

#### `GET /api/agent-rules/:fileId`

Get the content of an agent rule file.

- **URL params**: `fileId` = `claude-md` | `agents-md`
- **Response**: `{ exists: boolean, content: string }`
- **Error** (404): `{ error: "Unknown file" }` (invalid fileId)

#### `PUT /api/agent-rules/:fileId`

Create or update an agent rule file. Creates parent directories if needed.

- **Request**:
  ```json
  { "content": "# CLAUDE.md\n\nInstructions here..." }
  ```
- **Response**: `{ success: true }`

#### `DELETE /api/agent-rules/:fileId`

Delete an agent rule file from disk.

- **Response**: `{ success: true }`
- **Error** (404): `{ error: "Unknown file" }` (invalid fileId)

---

## Configuration

Manage `.dawg/config.json` and related settings.

#### `GET /api/config`

Get the current project configuration.

- **Response**: `{ config: WorktreeConfig | null, projectName: string | null, hasBranchNameRule: boolean }`

Returns `null` for `config` and `projectName` if the config file has been deleted.

#### `PATCH /api/config`

Update project configuration fields.

- **Request**: Partial `WorktreeConfig` object (any fields to update)
- **Response**: `{ success: true, ... }`
- **Error** (400): `{ success: false, error: "..." }`

#### `GET /api/config/detect`

Auto-detect configuration values from the project directory without creating a config file. Inspects `package.json`, lockfiles, and git state.

- **Response**: `{ success: true, config: { startCommand, installCommand, baseBranch, ... } }`

#### `POST /api/config/init`

Initialize a new `.dawg/config.json` with provided or auto-detected values. Creates the `.dawg` directory, config file, and `.gitignore`. Will not overwrite existing config.

- **Request** (all optional, falls back to auto-detected):
  ```json
  {
    "startCommand": "pnpm dev",
    "installCommand": "pnpm install",
    "baseBranch": "origin/main"
  }
  ```
- **Response**: `{ success: true, config: {...} }`
- **Error** (400): `{ success: false, error: "Config already exists" }`

#### `GET /api/config/setup-status`

Check whether `.dawg` config files need to be committed and/or pushed to the remote.

- **Response**: `{ needsPush: boolean, files: string[] }`

#### `POST /api/config/commit-setup`

Commit and push the `.dawg/config.json` and `.dawg/.gitignore` files.

- **Request** (optional):
  ```json
  { "message": "chore: add dawg configuration" }
  ```
- **Response**: `{ success: true }` or `{ success: true, alreadyCommitted: true }` or `{ success: true, pushFailed: true }`
- **Error**: `{ success: false, error: "..." }`

#### `GET /api/ports`

Get discovered ports and offset step.

- **Response**: `{ discovered: number[], offsetStep: number }`

#### `POST /api/discover`

Run port discovery (starts the dev server, monitors with `lsof`, then stops it).

- **Response**: `{ success: boolean, ports: number[], logs: string[], error?: string }`

#### `POST /api/detect-env`

Auto-detect environment variable mappings that reference known ports.

- **Response**: `{ success: true, envMapping: Record<string, string> }`

#### `GET /api/config/branch-name-rule`

Get the branch name generation rule script content.

- **Query params**: `?source=jira|linear|local` (optional, for per-integration overrides)
- **Response**: `{ content: string, hasOverride?: boolean }`

#### `PUT /api/config/branch-name-rule`

Save or delete a branch name generation rule.

- **Request**:
  ```json
  {
    "content": "return `feature/${issueId}-${name}`",
    "source": "jira"
  }
  ```
  Send empty/null `content` to delete the rule. `source` is optional.
- **Response**: `{ success: true }`

#### `GET /api/config/branch-name-rule/status`

Check which per-integration branch name rule overrides exist.

- **Response**: `{ overrides: { jira: boolean, linear: boolean, local: boolean } }`

#### `GET /api/config/commit-message-rule`

Get the commit message generation rule script content.

- **Query params**: `?source=jira|linear|local` (optional)
- **Response**: `{ content: string, hasOverride?: boolean }`

#### `PUT /api/config/commit-message-rule`

Save or delete a commit message generation rule.

- **Request**:
  ```json
  {
    "content": "return `[${issueId}] ${message}`",
    "source": "jira"
  }
  ```
- **Response**: `{ success: true }`

#### `GET /api/config/commit-message-rule/status`

Check which per-integration commit message rule overrides exist.

- **Response**: `{ overrides: { jira: boolean, linear: boolean, local: boolean } }`

---

## GitHub Integration

GitHub operations via the `gh` CLI. Requires `gh` to be installed and authenticated.

#### `GET /api/github/status`

Get GitHub integration status.

- **Response**: `{ installed: boolean, authenticated: boolean, repo: string | null, hasRemote: boolean, hasCommits: boolean }`

#### `POST /api/github/install`

Install the `gh` CLI via Homebrew and start the authentication flow.

- **Response**: `{ success: true, code: string | null }` -- `code` is the one-time device code for browser auth

#### `POST /api/github/login`

Start the GitHub device login flow (assumes `gh` is already installed).

- **Response**: `{ success: true, code: string }` -- the one-time code; a browser window is also opened automatically
- **Error** (400): `{ success: false, error: "..." }`

#### `POST /api/github/logout`

Log out of GitHub via `gh auth logout`.

- **Response**: `{ success: true }`

#### `POST /api/github/initial-commit`

Create an initial commit in the repository (for new repos with no commits).

- **Response**: `{ success: true, ... }`

#### `POST /api/github/create-repo`

Create a new GitHub repository for the project.

- **Request**:
  ```json
  { "private": true }
  ```
- **Response**: `{ success: true, ... }`

#### `POST /api/worktrees/:id/commit`

Commit all changes in a worktree.

- **Request**:
  ```json
  { "message": "feat: add new feature" }
  ```
- **Response**: `{ success: true, ... }`
- **Error** (400/404): `{ success: false, error: "..." }`

#### `POST /api/worktrees/:id/push`

Push a worktree's branch to the remote.

- **Response**: `{ success: true, ... }`
- **Error** (400/404): `{ success: false, error: "..." }`

#### `POST /api/worktrees/:id/create-pr`

Create a GitHub pull request for a worktree's branch.

- **Request**:
  ```json
  {
    "title": "feat: new feature",
    "body": "Optional PR description"
  }
  ```
- **Response** (201): `{ success: true, ... }`
- **Error** (400/404): `{ success: false, error: "..." }`

---

## Jira Integration

Jira Cloud API integration with API token or OAuth authentication.

#### `GET /api/jira/status`

Get Jira integration status and configuration.

- **Response**:
  ```json
  {
    "configured": true,
    "defaultProjectKey": "PROJ",
    "refreshIntervalMinutes": 5,
    "email": "user@example.com",
    "domain": "yoursite.atlassian.net",
    "dataLifecycle": { ... }
  }
  ```

#### `POST /api/jira/setup`

Configure Jira with API token credentials. Validates the connection before saving.

- **Request**:
  ```json
  {
    "baseUrl": "https://yoursite.atlassian.net",
    "email": "user@example.com",
    "token": "your-api-token"
  }
  ```
- **Response**: `{ success: true }`
- **Error** (400): `{ success: false, error: "Connection failed: ..." }`

#### `PATCH /api/jira/config`

Update Jira project configuration.

- **Request**:
  ```json
  {
    "defaultProjectKey": "PROJ",
    "refreshIntervalMinutes": 10,
    "dataLifecycle": { ... }
  }
  ```
- **Response**: `{ success: true }`

#### `DELETE /api/jira/credentials`

Disconnect Jira by removing stored credentials.

- **Response**: `{ success: true }`

#### `GET /api/jira/issues`

List Jira issues assigned to the current user.

- **Query params**: `?query=search+text` (optional, filters by text match)
- **Response**: `{ issues: [{ key, summary, status, priority, type, assignee, updated, labels, url }] }`
- **Error** (400/502): `{ issues: [], error: "..." }`

Also performs background auto-cleanup of cached issue data if data lifecycle rules are configured.

#### `GET /api/jira/issues/:key`

Get detailed information for a specific Jira issue. Includes description (rendered from ADF), comments, attachments, and metadata.

- **Response**: `{ issue: { ... } }`
- **Error** (400/404/500): `{ error: "..." }`

Persists issue data to disk by default (controlled by `dataLifecycle.saveOn` setting). Downloads attachments in the background.

#### `GET /api/jira/attachment`

Proxy a Jira attachment URL through the server (handles authentication).

- **Query params**: `?url=https://yoursite.atlassian.net/rest/api/3/attachment/content/...`
- **Response**: The raw attachment file with appropriate `Content-Type` header
- **Error**: `{ error: "..." }`

#### `POST /api/jira/task`

Create a worktree from a Jira issue. Fetches the issue, generates a branch name, and creates the worktree.

- **Request**:
  ```json
  {
    "issueKey": "PROJ-123",
    "branch": "optional-custom-branch"
  }
  ```
- **Response** (201): `{ success: true, worktree: WorktreeInfo }`
- **Error** (400): `{ success: false, error: "..." }`

---

## Linear Integration

Linear issue tracker integration via API key.

#### `GET /api/linear/status`

Get Linear integration status and configuration.

- **Response**:
  ```json
  {
    "configured": true,
    "defaultTeamKey": "TEAM",
    "refreshIntervalMinutes": 5,
    "displayName": "User Name",
    "dataLifecycle": { ... }
  }
  ```

#### `POST /api/linear/setup`

Configure Linear with an API key. Validates the connection before saving.

- **Request**:
  ```json
  { "apiKey": "lin_api_..." }
  ```
- **Response**: `{ success: true }`
- **Error** (400): `{ success: false, error: "Connection failed: ..." }`

#### `PATCH /api/linear/config`

Update Linear project configuration.

- **Request**:
  ```json
  {
    "defaultTeamKey": "TEAM",
    "refreshIntervalMinutes": 10,
    "dataLifecycle": { ... }
  }
  ```
- **Response**: `{ success: true }`

#### `DELETE /api/linear/credentials`

Disconnect Linear by removing stored credentials.

- **Response**: `{ success: true }`

#### `GET /api/linear/issues`

List Linear issues assigned to the current user.

- **Query params**: `?query=search+text` (optional)
- **Response**: `{ issues: [{ identifier, title, state, priority, assignee, labels, url, ... }] }`
- **Error** (400/500): `{ issues: [], error: "..." }`

#### `GET /api/linear/issues/:identifier`

Get detailed information for a specific Linear issue.

- **Response**: `{ issue: { ... } }`
- **Error** (400/404/500): `{ error: "..." }`

#### `GET /api/linear/attachment`

Proxy a Linear attachment through the dawg server using the configured Linear API key. Use this URL for image previews/downloads in the UI to avoid auth/CORS failures.

- **Query params**: `?url=https://...` (required)
- **Response**: Raw attachment bytes with `Content-Type` + `Content-Disposition`
- **Error** (400/500): `{ error: "..." }`

#### `POST /api/linear/task`

Create a worktree from a Linear issue.

- **Request**:
  ```json
  {
    "identifier": "TEAM-123",
    "branch": "optional-custom-branch"
  }
  ```
- **Response** (201): `{ success: true, worktree: WorktreeInfo }`
- **Error** (400): `{ success: false, error: "..." }`

---

## Activity Feed

Query and stream activity events (agent actions, worktree lifecycle, git operations, etc.).

#### `GET /api/activity`

Query persisted activity events with optional filters.

- **Query params**:
  - `?since=<iso>` -- Only events after this ISO 8601 timestamp
  - `?category=<cat>` -- Filter by category (`agent`, `worktree`, `system`)
  - `?limit=<n>` -- Max number of events to return (default: 100)
- **Response**: `{ events: ActivityEvent[] }`

Each `ActivityEvent` includes: `id`, `timestamp`, `category`, `type`, `severity` (`info` | `success` | `warning` | `error`), `title`, `detail?`, `worktreeId?`, `projectName?`, `metadata?`.

Events are persisted to `.dawg/activity.json` (JSONL format) and pruned based on the `activity.retentionDays` config setting.

---

## Events (SSE)

Server-Sent Events stream for real-time worktree and activity updates.

#### `GET /api/events`

Opens an SSE connection. Immediately sends the current worktree state and recent activity history, then pushes updates as they occur.

- **Headers**: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- **Event format**:
  ```
  data: {"type":"worktrees","worktrees":[...]}
  data: {"type":"activity-history","events":[...]}
  data: {"type":"activity","event":{...}}
  ```
- **Event types**:
  - `worktrees` -- Full worktree list on every state change (status transitions, log updates, port changes, etc.)
  - `activity-history` -- Sent once on connection, contains the last 50 activity events
  - `activity` -- Individual activity events as they occur in real-time

The connection stays open until the client disconnects.

---

## MCP Management

Configure dawg as an MCP server in various AI agent tool configurations.

#### `GET /api/mcp/status`

Get MCP registration status across all supported agents (Claude, Cursor, Windsurf, etc.) at both global and project scope.

- **Response**:
  ```json
  {
    "statuses": {
      "claude": { "global": true, "project": false },
      "cursor": { "global": false, "project": true },
      ...
    }
  }
  ```

#### `POST /api/mcp/setup`

Register dawg as an MCP server in an agent's configuration file.

- **Request**:
  ```json
  {
    "agent": "claude",
    "scope": "global"
  }
  ```
  `scope` defaults to `"global"` if omitted. Valid agents depend on `AGENT_SPECS`.
- **Response**: `{ success: true }`

Also deploys agent-specific instruction files.

#### `POST /api/mcp/remove`

Remove dawg from an agent's MCP server configuration.

- **Request**:
  ```json
  {
    "agent": "claude",
    "scope": "global"
  }
  ```
- **Response**: `{ success: true }`

Also removes agent-specific instruction files.

---

## MCP Servers Registry

Manage a centralized registry of MCP servers stored at `~/.dawg/mcp-servers.json`. Deploy them to any agent's configuration.

#### `GET /api/mcp-servers`

List all registered MCP servers.

- **Query params**:
  - `?q=search` -- Filter by name, ID, description, or command
  - `?tag=tagname` -- Filter by tag
- **Response**: `{ servers: McpServerDefinition[] }`

Each server includes: `id`, `name`, `description`, `tags`, `command`, `args`, `env`, `source`, `createdAt`, `updatedAt`.

#### `GET /api/mcp-servers/deployment-status`

Get deployment status of all registry servers (plus built-in `dawg`) across all agents and scopes.

- **Response**:
  ```json
  {
    "status": {
      "server-id": {
        "claude": { "global": true, "project": false, "globalPath": "...", "projectPath": "..." },
        ...
      }
    }
  }
  ```

#### `GET /api/mcp-servers/:id`

Get a single MCP server definition.

- **Response**: `{ server: McpServerDefinition }`
- **Error** (404): `{ error: "Server not found" }`

#### `POST /api/mcp-servers`

Register a new MCP server.

- **Request**:
  ```json
  {
    "id": "optional-slug",
    "name": "My MCP Server",
    "description": "What it does",
    "tags": ["search", "web"],
    "command": "npx",
    "args": ["-y", "my-mcp-server"],
    "env": { "API_KEY": "..." }
  }
  ```
  `name` and `command` are required. `id` is auto-generated from name if omitted.
- **Response**: `{ success: true, server: McpServerDefinition }`
- **Error** (409): `{ success: false, error: "Server \"id\" already exists" }`

#### `PATCH /api/mcp-servers/:id`

Update an existing MCP server definition.

- **Request**: Partial server fields (`name`, `description`, `tags`, `command`, `args`, `env`)
- **Response**: `{ success: true, server: McpServerDefinition }`
- **Error** (404): `{ success: false, error: "Server not found" }`

#### `DELETE /api/mcp-servers/:id`

Remove a server from the registry.

- **Response**: `{ success: true }`
- **Error** (404): `{ success: false, error: "Server not found" }`

#### `POST /api/mcp-servers/:id/deploy`

Deploy a registry server to an agent's configuration file.

- **Request**:
  ```json
  {
    "tool": "claude",
    "scope": "global"
  }
  ```
- **Response**: `{ success: true }`

Merges global env with per-project env overrides before writing.

#### `POST /api/mcp-servers/:id/undeploy`

Remove a server from an agent's configuration file.

- **Request**:
  ```json
  {
    "tool": "claude",
    "scope": "project"
  }
  ```
- **Response**: `{ success: true }`

#### `POST /api/mcp-servers/scan`

Scan the filesystem for MCP server definitions in agent config files.

- **Request**:
  ```json
  {
    "mode": "project",
    "scanPath": "/optional/path"
  }
  ```
  `mode`: `"project"` (default), `"folder"`, or `"device"`.
- **Response**:
  ```json
  {
    "discovered": [
      {
        "key": "server-name",
        "command": "npx",
        "args": ["..."],
        "env": {},
        "foundIn": [{ "configPath": "..." }],
        "alreadyInRegistry": false
      }
    ]
  }
  ```

#### `POST /api/mcp-servers/import`

Bulk import discovered servers into the registry.

- **Request**:
  ```json
  {
    "servers": [
      {
        "key": "server-name",
        "name": "Display Name",
        "command": "npx",
        "args": ["..."],
        "env": {},
        "source": "/path/to/config"
      }
    ]
  }
  ```
- **Response**: `{ success: true, imported: ["server-name", ...] }`

#### `GET /api/mcp-env/:serverId`

Get per-project environment variable overrides for an MCP server.

- **Response**: `{ env: Record<string, string> }`

#### `PUT /api/mcp-env/:serverId`

Set per-project environment variable overrides for an MCP server.

- **Request**:
  ```json
  { "env": { "API_KEY": "project-specific-value" } }
  ```
  Send an empty object to clear overrides.
- **Response**: `{ success: true, env: Record<string, string> }`

---

## Skills

Manage a centralized skills registry stored at `~/.dawg/skills/`. Skills are directories containing a `SKILL.md` file with frontmatter metadata and instructions.

#### `GET /api/skills`

List all skills in the registry.

- **Response**: `{ skills: [{ name, displayName, description, path }] }`

#### `GET /api/skills/deployment-status`

Get per-agent deployment status for all registry skills.

- **Response**:
  ```json
  {
    "status": {
      "skill-name": {
        "inRegistry": true,
        "agents": {
          "claude": { "global": false, "project": true },
          ...
        }
      }
    }
  }
  ```

#### `GET /api/skills/:name`

Get detailed information about a skill, including its `SKILL.md` content, frontmatter, and optional `reference.md` / `examples.md`.

- **Response**:
  ```json
  {
    "skill": {
      "name": "my-skill",
      "displayName": "My Skill",
      "description": "...",
      "path": "/Users/.../.dawg/skills/my-skill",
      "skillMd": "---\nname: ...\n---\n...",
      "frontmatter": { "name": "...", "description": "...", ... },
      "hasReference": true,
      "referenceMd": "...",
      "hasExamples": false
    }
  }
  ```
- **Error** (404): `{ error: "Skill not found" }`

#### `POST /api/skills`

Create a new skill in the registry.

- **Request**:
  ```json
  {
    "name": "My Skill",
    "description": "What it does",
    "allowedTools": "Bash, Read, Write",
    "context": "file://reference.md",
    "agent": "",
    "model": "",
    "argumentHint": "",
    "disableModelInvocation": false,
    "userInvocable": true,
    "mode": false,
    "instructions": "Markdown body of SKILL.md"
  }
  ```
  Only `name` is required.
- **Response**: `{ success: true, skill: { name, displayName, description, path } }`
- **Error** (409): `{ success: false, error: "Skill \"name\" already exists" }`

#### `PATCH /api/skills/:name`

Update a skill's content.

- **Request**:
  ```json
  {
    "skillMd": "Full SKILL.md content",
    "referenceMd": "Reference content",
    "examplesMd": "Examples content",
    "frontmatter": { "description": "updated" }
  }
  ```
  All fields are optional. If `frontmatter` is provided without `skillMd`, it merges into the existing `SKILL.md`. Send empty string for `referenceMd`/`examplesMd` to delete those files.
- **Response**: `{ success: true }`

#### `DELETE /api/skills/:name`

Delete a skill from the registry. Also removes symlinks across all agent deploy directories.

- **Response**: `{ success: true }`
- **Error** (404): `{ success: false, error: "Skill not found" }`

#### `POST /api/skills/:name/deploy`

Deploy a skill to an agent's skills directory (creates a symlink).

- **Request**:
  ```json
  {
    "agent": "claude",
    "scope": "project"
  }
  ```
- **Response**: `{ success: true }`

#### `POST /api/skills/:name/undeploy`

Remove a skill deployment from an agent's skills directory.

- **Request**:
  ```json
  {
    "agent": "claude",
    "scope": "global"
  }
  ```
- **Response**: `{ success: true }`

#### `POST /api/skills/scan`

Scan the filesystem for skill directories.

- **Request**:
  ```json
  {
    "mode": "project",
    "scanPath": "/optional/path"
  }
  ```
  `mode`: `"project"` (default), `"folder"`, or `"device"`.
- **Response**: `{ discovered: [{ name, displayName, description, skillPath, alreadyInRegistry }] }`

#### `POST /api/skills/import`

Import discovered skills into the registry (copies files).

- **Request**:
  ```json
  {
    "skills": [{ "name": "skill-name", "skillPath": "/path/to/skill" }]
  }
  ```
- **Response**: `{ success: true, imported: ["skill-name", ...] }`

#### `POST /api/skills/install`

Install a skill from GitHub via `npx skills add`.

- **Request**:
  ```json
  {
    "repo": "owner/repo",
    "skill": "optional-skill-name",
    "agents": ["claude", "cursor"],
    "scope": "global"
  }
  ```
- **Response**: `{ success: true, installed: ["skill-name"] }`

#### `GET /api/skills/npx-available`

Check if `npx skills` CLI is available on the system.

- **Response**: `{ available: boolean }`

---

## Claude Plugins

Manage Claude Code plugins via the `claude` CLI. Falls back to reading settings files if the CLI is unavailable.

#### `GET /api/claude/plugins`

List installed Claude plugins with component counts and health status.

- **Response**:
  ```json
  {
    "plugins": [
      {
        "id": "plugin-id",
        "name": "Plugin Name",
        "description": "...",
        "version": "1.0.0",
        "scope": "user",
        "enabled": true,
        "marketplace": "...",
        "author": "...",
        "error": null,
        "warning": "Needs authentication",
        "componentCounts": {
          "commands": 2,
          "agents": 1,
          "skills": 3,
          "mcpServers": 1,
          "hooks": false,
          "lsp": false
        }
      }
    ],
    "cliAvailable": true
  }
  ```

Plugin health is probed by testing MCP server connectivity, checking command availability, and validating env vars.

#### `GET /api/claude/plugins/debug`

Get raw `claude plugin list --json` output for debugging.

- **Response**: `{ success: boolean, raw: string, parsed: any, stderr?: string }`

#### `GET /api/claude/plugins/available`

List available plugins from configured marketplaces.

- **Response**:
  ```json
  {
    "available": [
      {
        "pluginId": "...",
        "name": "...",
        "description": "...",
        "marketplaceName": "...",
        "version": "...",
        "installed": false
      }
    ]
  }
  ```

#### `GET /api/claude/plugins/:id`

Get detailed information about a specific plugin, including manifest, README, components list, and health check.

- **Response**:
  ```json
  {
    "plugin": {
      "id": "...", "name": "...", "description": "...",
      "version": "...", "scope": "...", "enabled": true,
      "installPath": "/path/to/plugin",
      "manifest": { ... },
      "components": {
        "commands": ["cmd1"], "agents": ["agent1"],
        "skills": ["skill1"], "mcpServers": ["server1"],
        "hasHooks": false, "hasLsp": false
      },
      "readme": "# Plugin README\n...",
      "homepage": "...", "repository": "...",
      "license": "MIT", "keywords": [...]
    }
  }
  ```
- **Error** (404): `{ error: "Plugin not found" }`
- **Error** (501): `{ error: "Claude CLI not available", cliAvailable: false }`

#### `POST /api/claude/plugins/install`

Install a plugin from a marketplace.

- **Request**:
  ```json
  {
    "ref": "plugin-reference",
    "scope": "user"
  }
  ```
- **Response**: `{ success: true }`

#### `POST /api/claude/plugins/:id/uninstall`

Uninstall a plugin.

- **Request** (optional): `{ "scope": "user" }`
- **Response**: `{ success: true }`

#### `POST /api/claude/plugins/:id/enable`

Enable a disabled plugin.

- **Request** (optional): `{ "scope": "user" }`
- **Response**: `{ success: true }`

#### `POST /api/claude/plugins/:id/disable`

Disable a plugin.

- **Request** (optional): `{ "scope": "user" }`
- **Response**: `{ success: true }`

#### `POST /api/claude/plugins/:id/update`

Update a plugin to the latest version.

- **Response**: `{ success: true }`

#### `GET /api/claude/plugins/marketplaces`

List configured plugin marketplaces.

- **Response**: `{ marketplaces: [{ name, source, repo }] }`

#### `POST /api/claude/plugins/marketplaces`

Add a new marketplace source.

- **Request**:
  ```json
  { "source": "https://marketplace.example.com" }
  ```
- **Response**: `{ success: true }`

#### `DELETE /api/claude/plugins/marketplaces/:name`

Remove a marketplace.

- **Response**: `{ success: true }`

#### `POST /api/claude/plugins/marketplaces/:name/update`

Update a marketplace's plugin index.

- **Response**: `{ success: true }`

---

## MCP Transport

Streamable HTTP transport endpoint for direct MCP protocol connections.

#### `ALL /mcp`

MCP Streamable HTTP transport. Handles `POST` requests with JSON-RPC MCP protocol messages, as well as `GET` for SSE-based streaming.

This is a stateless transport (no session tracking) designed for single-user local dev tool use. The endpoint connects to the same MCP server that `dawg mcp` exposes via stdio.

- **Request** (POST): JSON-RPC 2.0 messages per the MCP specification
- **Response**: JSON-RPC 2.0 responses (with `enableJsonResponse: true`)

Clients can connect to this endpoint using any MCP-compatible SDK with HTTP transport support.

---

## Notes

Per-issue notes with personal notes, AI context, and todo lists. Notes are scoped by issue source (`jira`, `linear`, or `local`) and issue ID.

#### `GET /api/notes/:source/:id`

Get notes for an issue.

- **URL params**: `source` = `jira` | `linear` | `local`, `id` = issue key/identifier
- **Response**: Full notes object with `personal`, `aiContext`, `todos`, `linkedWorktreeId`, `gitPolicy`

#### `PUT /api/notes/:source/:id`

Update a notes section.

- **Request**:
  ```json
  {
    "section": "personal",
    "content": "My notes about this issue"
  }
  ```
  `section` must be `"personal"` or `"aiContext"`.
- **Response**: Updated notes object

When updating `aiContext` and the issue has a linked worktree, `TASK.md` in the worktree is regenerated automatically.

#### `POST /api/notes/:source/:id/todos`

Add a todo item.

- **Request**:
  ```json
  { "text": "Implement the feature" }
  ```
- **Response**: Updated notes object

#### `PATCH /api/notes/:source/:id/todos/:todoId`

Update a todo item.

- **Request**:
  ```json
  {
    "text": "Updated text",
    "checked": true
  }
  ```
- **Response**: Updated notes object

#### `DELETE /api/notes/:source/:id/todos/:todoId`

Delete a todo item.

- **Response**: Updated notes object

#### `PATCH /api/notes/:source/:id/git-policy`

Update the git policy for an issue (controls agent commit/push/PR permissions).

- **Request**:
  ```json
  {
    "agentCommits": "allow",
    "agentPushes": "deny",
    "agentPRs": "inherit"
  }
  ```
  Valid values: `"inherit"`, `"allow"`, `"deny"`.
- **Response**: Updated notes object

---

## Local Tasks

CRUD operations for local (non-integrated) tasks stored at `.dawg/issues/local/`. Tasks use auto-incrementing identifiers (e.g., `LOCAL-1`, `LOCAL-2`).

#### `GET /api/tasks`

List all local tasks, enriched with linked worktree info and attachment counts.

- **Response**: `{ tasks: [{ id, identifier, title, description, status, priority, labels, linkedWorktreeId, attachmentCount, ... }] }`

#### `GET /api/tasks/:id`

Get a single task with full details and attachments.

- **Response**: `{ task: { ..., linkedWorktreeId, attachments: [{ filename, mimeType, size, localPath, createdAt }] } }`
- **Error** (404): `{ error: "Task not found" }`

#### `POST /api/tasks`

Create a new local task.

- **Request**:
  ```json
  {
    "title": "My task",
    "description": "Detailed description",
    "priority": "high",
    "labels": ["frontend", "urgent"]
  }
  ```
  Only `title` is required. `priority` defaults to `"medium"`.
- **Response**: `{ success: true, task: { ... } }`

#### `PATCH /api/tasks/:id`

Update a task.

- **Request**: Partial fields: `title`, `description`, `status` (`"todo"` | `"in-progress"` | `"done"`), `priority` (`"high"` | `"medium"` | `"low"`), `labels`
- **Response**: `{ success: true, task: { ... } }`
- **Error** (404): `{ success: false, error: "Task not found" }`

#### `DELETE /api/tasks/:id`

Delete a task and all its data.

- **Response**: `{ success: true }`
- **Error** (404): `{ success: false, error: "Task not found" }`

#### `POST /api/tasks/:id/create-worktree`

Create a worktree from a local task. Generates a branch name, writes a `TASK.md` file in the worktree, and links the task to the worktree.

- **Request** (optional):
  ```json
  { "branch": "custom-branch-name" }
  ```
- **Response**: `{ success: true, worktree: WorktreeInfo }`

#### `POST /api/tasks/:id/attachments`

Upload a file attachment to a task. Uses `multipart/form-data`.

- **Request**: Form data with `file` field
- **Response**:
  ```json
  {
    "success": true,
    "attachment": {
      "filename": "image.png",
      "mimeType": "image/png",
      "size": 12345,
      "localPath": "..."
    }
  }
  ```

Automatically deduplicates filenames (appends `_1`, `_2`, etc.).

#### `GET /api/tasks/:id/attachments/:filename`

Serve an attachment file.

- **Response**: Raw file content with appropriate `Content-Type` header and 1-hour cache

#### `DELETE /api/tasks/:id/attachments/:filename`

Delete an attachment.

- **Response**: `{ success: true }`
- **Error** (404): `{ success: false, error: "Attachment not found" }`

---

## Terminal

WebSocket-based PTY terminal sessions for worktrees.

#### `POST /api/worktrees/:id/terminals`

Create a new terminal session for a worktree.

- **Request** (optional):
  ```json
  {
    "cols": 120,
    "rows": 40,
    "startupCommand": "exec claude 'Implement task in TASK.md'"
  }
  ```
  Defaults to 80 columns and 24 rows. `startupCommand` (optional) runs via shell startup (`$SHELL -lc <command>`) when the PTY is first created.
- **Response**: `{ success: true, sessionId: "string" }`
- **Error** (404): `{ success: false, error: "Worktree not found" }`

#### `DELETE /api/terminals/:sessionId`

Destroy a terminal session.

- **Response**: `{ success: true }`
- **Error** (404): `{ success: false, error: "Session not found" }`

#### `GET /api/terminals/:sessionId/ws` (WebSocket)

WebSocket endpoint for bidirectional terminal communication. Upgrades the HTTP connection to a WebSocket.

**Protocol**:

- **Client to Server**: Send raw terminal input as text/binary frames
- **Server to Client**: Receive PTY output as text/binary frames
- **Connection**: Automatically attaches to the PTY session on open; closes with code `1008` if session not found

---

## Hooks

Automated checks and agent skills organized by trigger type. Supports shell command steps and skill references from the registry.

#### `GET /api/hooks/config`

Get the hooks configuration.

- **Response**: `HooksConfig` object with `steps` and `skills` arrays

#### `PUT /api/hooks/config`

Save the full hooks configuration.

- **Request**: `HooksConfig` object
- **Response**: `{ success: true, config: HooksConfig }`

#### `POST /api/hooks/steps`

Add a hook step (command or prompt).

- **Request**:
  ```json
  { "name": "Type check", "command": "pnpm check-types", "kind": "command" }
  ```
  Prompt steps use: `{ "name": "Architecture review", "kind": "prompt", "prompt": "Review the implementation and list architectural risks." }`
- **Response**: `{ success: true, config: HooksConfig }`

#### `PATCH /api/hooks/steps/:stepId`

Update a step.

- **Request**: Partial fields: `name`, `command`, `prompt`, `kind`, `enabled`, `trigger`, `condition`
- **Response**: `{ success: true, config: HooksConfig }`

#### `DELETE /api/hooks/steps/:stepId`

Remove a step.

- **Response**: `{ success: true, config: HooksConfig }`

#### `POST /api/hooks/skills/import`

Import a skill from the registry into hooks.

- **Request**:
  ```json
  { "skillName": "review-changes", "trigger": "post-implementation", "condition": "optional" }
  ```
  The same skill can be imported into multiple trigger types. Deduplication is by `skillName + trigger`.
- **Response**: `{ success: true, config: HooksConfig }`

#### `GET /api/hooks/skills/available`

List available skills from the `~/.dawg/skills/` registry.

- **Response**: `{ available: [{ name, displayName, description }] }`

#### `PATCH /api/hooks/skills/:name`

Toggle a skill's enabled state.

- **Request**:
  ```json
  { "enabled": true, "trigger": "post-implementation" }
  ```
  `trigger` identifies which instance to toggle when the same skill exists in multiple trigger types.
- **Response**: `{ success: true, config: HooksConfig }`

#### `DELETE /api/hooks/skills/:name`

Remove a skill from hooks.

- **Query params**: `?trigger=post-implementation` (identifies which instance to remove)
- **Response**: `{ success: true, config: HooksConfig }`

#### `POST /api/worktrees/:id/hooks/run`

Run all enabled steps for a worktree.

- **Request** (optional):
  ```json
  { "trigger": "pre-implementation" }
  ```
  Trigger defaults to `"post-implementation"` when omitted.
- **Response**: `PipelineRun` object with `id`, `worktreeId`, `status`, `startedAt`, `steps`

#### `POST /api/worktrees/:id/hooks/run/:stepId`

Run a single step for a worktree.

- **Response**: `StepResult` object

#### `GET /api/worktrees/:id/hooks/status`

Get the latest hook run status for a worktree.

- **Response**: `{ status: PipelineRun | null }`

#### `POST /api/worktrees/:id/hooks/report`

Report a skill hook result from an agent.

- **Request**:
  ```json
  {
    "skillName": "review-changes",
    "trigger": "post-implementation",
    "success": true,
    "summary": "No critical issues found",
    "content": "Optional detailed markdown content"
  }
  ```
- **Response**: `{ success: true }`

#### `GET /api/worktrees/:id/hooks/skill-results`

Get skill hook results for a worktree.

- **Response**: `{ results: SkillHookResult[] }`

---

## Integration Verification

#### `GET /api/integrations/verify`

Background verification of all integration connections. Tests GitHub (`gh auth status`), Jira (API call), and Linear (GraphQL query) in parallel.

- **Response**:
  ```json
  {
    "github": { "ok": true },
    "jira": { "ok": true },
    "linear": null
  }
  ```
  Returns `null` for integrations that are not configured.
