# Agent Tooling System

OpenKit provides a unified system for managing agent tooling -- MCP servers, skills, and plugins -- across multiple AI coding agents. Rather than configuring each agent separately, OpenKit acts as a central registry and deployment manager.

## Table of Contents

- [Principles](#principles)
- [Built-in OpenKit MCP Server](#built-in-openkit-mcp-server)
- [MCP Server Management](#mcp-server-management)
- [Skills Management](#skills-management)
- [Claude Plugins](#claude-plugins)
- [Agent Git Policy](#agent-git-policy)
- [Hooks](#hooks)
- [UI: Agents View](#ui-agents-view)
- [API Reference](#api-reference)

---

## Principles

All agent-facing features follow four design principles:

1. **Agent-agnostic first** -- Exposed via MCP tools that any agent can use. Nothing is locked to a single vendor.
2. **Enhanced for Claude** -- When Claude is detected, OpenKit nudges toward useful plugins (Playwright MCP, etc.) but never requires them.
3. **Self-service** -- Plugins and servers are installed and configured through OpenKit's UI and MCP tools, not manual file editing.
4. **Discoverable** -- Agents can query what tooling is available and get context-aware recommendations.

---

## Built-in OpenKit MCP Server

OpenKit itself is always available as an MCP server. It exposes all worktree management tools to any connected agent.

### Running Modes

**Proxy mode** (preferred): When a OpenKit HTTP server is already running, `openkit mcp` connects to it via HTTP transport. This gives the agent shared state with the web UI -- changes made through MCP tools appear in the UI in real time, and vice versa.

**Standalone mode**: When no server is running, `openkit mcp` starts its own `WorktreeManager` instance with stdio transport. The agent gets full functionality but does not share state with the UI.

The mode is selected automatically. OpenKit checks for a running server by reading `.openkit/server.json` (which contains the server URL and PID) and verifying the process is alive.

### HTTP Transport

The running OpenKit server also exposes MCP over HTTP at `/mcp`. This is a stateless Streamable HTTP transport that any MCP client can connect to directly, without going through stdio.

### Configuration

To connect an agent to OpenKit, add it as an MCP server in the agent's configuration. The command is the same for all agents:

```json
{
  "mcpServers": {
    "OpenKit": {
      "command": "openkit",
      "args": ["mcp"]
    }
  }
}
```

For TOML-based agents (Codex):

```toml
[mcp_servers.openkit]
command = "openkit"
args = ["mcp"]
```

OpenKit's UI can deploy this configuration automatically to any supported agent (see [Supported Agents](#supported-agents)).
Set `OPENKIT_ENABLE_MCP_SETUP=1` to enable MCP setup routes (`/api/mcp/status`,
`/api/mcp/setup`, `/api/mcp/remove`).

### Auto-Approval of MCP Tools

When deploying agent instructions for Claude, OpenKit also merges `mcp__OpenKit__*` into `.claude/settings.json` → `permissions.allow`. This auto-approves all OpenKit MCP tools so agents can call them (e.g., `report_hook_status`) without prompting the user for permission each time. On removal, the permission entries are cleaned up from the settings file.

### Exposed Tools

The MCP server exposes the following tools (defined in `src/actions.ts`):

**Issue browsing:**

- `list_jira_issues` -- List assigned Jira issues, optionally filtered by text search
- `get_jira_issue` -- Get full Jira issue details (checks local cache first)
- `list_linear_issues` -- List assigned Linear issues
- `get_linear_issue` -- Get full Linear issue details (checks local cache first)

**Worktree management:**

- `list_worktrees` -- List all worktrees with status, ports, and git info
- `create_worktree` -- Create a worktree from a branch name
- `create_from_jira` -- Create a worktree from a Jira issue key
- `create_from_linear` -- Create a worktree from a Linear identifier
- `start_worktree` -- Start the dev server (allocates port offset, spawns process)
- `stop_worktree` -- Stop the dev server
- `remove_worktree` -- Remove a worktree entirely
- `get_logs` -- Get recent output logs from a running worktree

**Git operations (subject to [git policy](#agent-git-policy)):**

- `commit` -- Stage all changes and commit
- `push` -- Push commits to remote
- `create_pr` -- Create a GitHub pull request

**Task context:**

- `get_task_context` -- Get full task context (issue details, AI directions, todo checklist) and regenerate TASK.md
- `read_issue_notes` -- Read AI context notes for a worktree or issue
- `update_todo` -- Add, toggle, or delete todo checklist items
- `get_config` -- Get the current OpenKit configuration

**Git policy:**

- `get_git_policy` -- Check whether commit/push/PR operations are allowed for a worktree

**Hooks:**

- `get_hooks_config` -- Get hooks configuration (steps and skills by trigger type)
- `run_hooks` -- Run hook steps for a worktree
- `report_hook_status` -- Report a skill hook result (call twice: once before invoking to show loading, once after with the result)
- `get_hooks_status` -- Get current/last hook run status

### MCP Prompt

The server also exposes one MCP prompt:

- **`work-on-task`** -- Takes an `issueId` parameter and returns a structured workflow message instructing the agent to create a worktree, wait for creation, navigate to it, read TASK.md, and start implementing.

---

## MCP Server Management

OpenKit maintains a central registry of MCP server definitions and can deploy them to any supported agent's configuration files.

### Registry

The registry is stored at `~/.openkit/mcp-servers.json` and persists across projects. Each entry contains:

```typescript
interface McpServerDefinition {
  id: string; // Unique slug (auto-generated from name)
  name: string; // Human-readable name
  description: string; // What this server does
  tags: string[]; // Categorization tags
  command: string; // Executable command
  args: string[]; // Command arguments
  env: Record<string, string>; // Environment variables
  source?: string; // Where this was discovered/imported from
  createdAt: string;
  updatedAt: string;
}
```

### Per-Project Environment Variables

MCP servers often need different API keys or configuration per project. OpenKit supports per-project environment variable overrides stored at `.openkit/mcp-env.json`. When deploying a server, the global `env` from the registry is merged with per-project overrides (project values take precedence).

### Supported Agents

OpenKit can deploy MCP server configurations to the following agents, at both global and project scope:

| Agent        | Global Config Path                                      | Project Config Path     | Format |
| ------------ | ------------------------------------------------------- | ----------------------- | ------ |
| Claude Code  | `~/.claude/settings.json`                               | `.mcp.json`             | JSON   |
| Gemini CLI   | `~/.gemini/settings.json`                               | `.gemini/settings.json` | JSON   |
| OpenAI Codex | `~/.codex/config.toml`                                  | `.codex/config.toml`    | TOML   |
| Cursor       | `~/.cursor/mcp.json`                                    | `.cursor/mcp.json`      | JSON   |
| VS Code      | `~/Library/Application Support/Code/User/settings.json` | `.vscode/settings.json` | JSON   |

Deployment writes the server entry into the target config file's MCP section (e.g., `mcpServers` for JSON, `[mcp_servers.*]` for TOML). Undeployment removes it.

### Scanning and Discovery

OpenKit can scan the filesystem to discover existing MCP server configurations. Three scan modes are available:

- **Project** -- Scans the current project directory (depth 4)
- **Folder** -- Scans a specified directory (depth 8)
- **Device** -- Scans the home directory (depth 5)

The scanner looks for files named `.mcp.json`, `mcp.json`, `settings.json`, and `config.toml`, then extracts server definitions from known JSON paths (`mcpServers`, `mcp.servers`, `servers`) and TOML sections (`[mcp_servers.*]`).

Discovered servers can be bulk-imported into the registry.

### Deployment Status

The deployment status endpoint returns a matrix showing, for every server and every agent, whether it is deployed at global scope, project scope, or both. This powers the UI's deployment toggle grid.

---

## Skills Management

Skills are reusable instruction sets (prompt templates) that agents can invoke as slash commands. OpenKit manages them through a central registry with per-agent deployment via symlinks.
During project initialization, OpenKit auto-enables the bundled `work-on-task` skill in project skill directories.

### SKILL.md Format

Each skill is a directory containing a `SKILL.md` file with YAML frontmatter:

```markdown
---
name: My Skill
description: What this skill does
allowed-tools: Bash, Read, Write
context: repo
agent: claude
model: claude-sonnet-4-20250514
argument-hint: <file-path>
disable-model-invocation: false
user-invocable: true
mode: false
---

Instructions for the skill go here. This is the prompt body
that the agent receives when the skill is invoked.
```

**Frontmatter fields:**

| Field                      | Description                                                                 |
| -------------------------- | --------------------------------------------------------------------------- |
| `name`                     | Display name for the skill                                                  |
| `description`              | Brief description shown in skill listings                                   |
| `allowed-tools`            | Comma-separated list of tools the skill is allowed to use                   |
| `context`                  | Context scope (`repo`, `file`, etc.)                                        |
| `agent`                    | Target agent (e.g., `claude`)                                               |
| `model`                    | Preferred model for execution                                               |
| `argument-hint`            | Hint for argument format shown to the user                                  |
| `disable-model-invocation` | If `true`, the model cannot invoke this skill on its own (default: `false`) |
| `user-invocable`           | If `false`, only the model can invoke this skill (default: `true`)          |
| `mode`                     | If `true`, this skill acts as a persistent mode (default: `false`)          |

A skill directory may also contain optional companion files:

- `reference.md` -- Reference documentation included as context
- `examples.md` -- Example invocations and outputs

### Registry

Skills are stored in `~/.openkit/skills/`, with each skill in its own subdirectory:

```
~/.openkit/skills/
  code-review/
    SKILL.md
    reference.md
  refactor/
    SKILL.md
    examples.md
```

### Deployment

Skills are deployed to agents via symlinks. Each supported agent has a skills directory:

| Agent        | Global Path        | Project Path     |
| ------------ | ------------------ | ---------------- |
| Claude Code  | `~/.claude/skills` | `.claude/skills` |
| Cursor       | `~/.cursor/skills` | `.cursor/skills` |
| Gemini CLI   | `~/.gemini/skills` | `.gemini/skills` |
| OpenAI Codex | `~/.codex/skills`  | `.codex/skills`  |
| VS Code      | `~/.vscode/skills` | `.vscode/skills` |

Deploying a skill creates a symlink from the agent's skills directory to the registry:

```
~/.claude/skills/code-review -> ~/.openkit/skills/code-review
```

This means edits to the skill in the registry are immediately reflected in all agents it is deployed to. Undeployment removes the symlink.

### Scanning and Discovery

Skill scanning follows the same three modes as MCP server scanning (project, folder, device). The scanner looks for skills directories inside known agent config directories (`.claude/skills`, `.cursor/skills`, etc.) and reads `SKILL.md` files from subdirectories within them. Symlinks pointing back to the OpenKit registry are skipped to avoid duplicates.

### Installing from GitHub

Skills can also be installed directly from GitHub repositories using `npx skills add`. The install endpoint:

1. Runs `npx skills add <repo>` with the specified agent and scope
2. Scans the agent's skills directory for newly created skills
3. Copies them into the OpenKit registry for centralized management

---

## Claude Plugins

Claude plugins are managed through the `claude` CLI. OpenKit provides a UI layer on top of the CLI for listing, installing, enabling/disabling, and updating plugins.

### How It Works

All plugin operations delegate to the `claude` CLI:

- `claude plugin list --json` -- List installed plugins
- `claude plugin install <ref>` -- Install a plugin
- `claude plugin uninstall <id>` -- Uninstall a plugin
- `claude plugin enable <id>` / `claude plugin disable <id>` -- Toggle plugins
- `claude plugin update <id>` -- Update a plugin
- `claude plugin list --available --json` -- List marketplace plugins

If the `claude` CLI is not available, OpenKit falls back to reading plugin entries directly from settings files (`~/.claude/settings.json`, `.claude/settings.json`, `.claude/settings.local.json`).

### Plugin Component Scanning

When the CLI is available, OpenKit inspects each plugin's install directory to report its components:

- **Commands** (`commands/*.md`) -- Slash commands the plugin provides
- **Agents** (`agents/*.md`) -- Agent definitions
- **Skills** (`skills/*`) -- Bundled skills
- **MCP Servers** (`.mcp.json`) -- MCP servers the plugin exposes
- **Hooks** (`hooks/hooks.json`) -- Lifecycle hooks
- **LSP** (`.lsp.json`) -- Language server integration

### Plugin Health Checks

OpenKit probes each plugin's MCP servers to detect potential issues:

- **HTTP servers**: Sends an MCP `initialize` request. A 401/403 response or connection failure is flagged as "Needs authentication".
- **Command-based servers**: Checks if the command binary exists on the system.
- **Environment variables**: Flags unset or placeholder values (e.g., `YOUR_API_KEY`, `TODO`, `${...}`).

Health check results are cached for 30 seconds.

### Marketplaces

Plugin marketplaces are registries of available plugins. OpenKit supports:

- Listing configured marketplaces (`claude plugin marketplace list`)
- Adding a marketplace (`claude plugin marketplace add <source>`)
- Removing a marketplace (`claude plugin marketplace remove <name>`)
- Updating a marketplace index (`claude plugin marketplace update <name>`)

---

## Agent Git Policy

OpenKit provides a policy system that controls whether AI agents can perform git operations. This gives project owners fine-grained control over what agents are allowed to do.

### Operations

Three operations are governed by git policy:

| Operation   | Config Key          | Description                  |
| ----------- | ------------------- | ---------------------------- |
| `commit`    | `allowAgentCommits` | Stage and commit changes     |
| `push`      | `allowAgentPushes`  | Push commits to remote       |
| `create_pr` | `allowAgentPRs`     | Create a GitHub pull request |

### Global Settings

Global toggles are stored in `.openkit/config.json`:

```json
{
  "allowAgentCommits": false,
  "allowAgentPushes": false,
  "allowAgentPRs": false
}
```

All three default to `false` -- agents cannot perform git operations unless explicitly enabled.

### Per-Worktree Overrides

Each worktree (linked to an issue) can override the global policy. Overrides are stored in the issue's notes and can be one of three values:

| Override Value | Behavior                                          |
| -------------- | ------------------------------------------------- |
| `inherit`      | Falls through to the global config (default)      |
| `allow`        | Permits the operation regardless of global config |
| `deny`         | Blocks the operation regardless of global config  |

### Resolution Logic

The policy resolution function (`resolveGitPolicy` in `src/server/git-policy.ts`) follows this order:

1. **Check per-worktree override**: Look up the worktree's linked issue notes. If a per-worktree override exists and is `allow` or `deny`, return immediately.
2. **Fall through to global**: If the override is `inherit` or absent, check the global config key. If the global setting is `false` (or missing), the operation is denied.

The result is a `GitPolicyResult`:

```typescript
interface GitPolicyResult {
  allowed: boolean;
  reason?: string; // Explanation when denied
}
```

### Agent Workflow

Agents are instructed (via `MCP_INSTRUCTIONS`) to always check policy before attempting git operations:

1. Call `get_git_policy` with the worktree ID
2. The response contains the resolved policy for all three operations
3. If an operation is denied, inform the user and suggest they enable it in Settings or per-worktree

If an agent attempts a git operation without checking, the operation handler itself enforces the policy and returns an error with the denial reason.

### Commit Message Formatting

When agents commit through OpenKit, commit messages can be automatically formatted by a project-configured rule. Rules are JavaScript functions stored in `.openkit/scripts/`:

- `commit-message.mjs` -- Default rule for all commits
- `commit-message.jira.mjs` -- Override for Jira-linked commits
- `commit-message.linear.mjs` -- Override for Linear-linked commits
- `commit-message.local.mjs` -- Override for local-issue commits

A rule receives `{ message, issueId, source }` and returns a formatted string. The default built-in rule prefixes the message with the issue ID:

```javascript
({ issueId, message }) => {
  if (issueId) {
    return `[${issueId}] ${message}`;
  }
  return message;
};
```

---

## Hooks

OpenKit includes a hooks system that agents can use to run automated checks at defined points in a worktree's lifecycle. Hooks contain shell command steps and skill references, organized by trigger type.

### Trigger Types

| Trigger               | When it fires                                       |
| --------------------- | --------------------------------------------------- |
| `pre-implementation`  | Before agents start working on a task               |
| `post-implementation` | After agents finish implementing a task (default)   |
| `custom`              | Agent decides based on a natural-language condition |
| `on-demand`           | Manually triggered from the UI                      |
| `worktree-created`    | Automatically after worktree creation               |
| `worktree-removed`    | Automatically after worktree removal                |

### Item Types

| Type             | Execution                                                                                   |
| ---------------- | ------------------------------------------------------------------------------------------- |
| Command steps    | OpenKit runs shell commands in the worktree directory and returns stdout/stderr with pass/fail |
| Skill references | Agent is told which skills to invoke; results are reported back                             |

`worktree-created` and `worktree-removed` are command-only triggers (no skills).

The same skill can be used in multiple trigger types (e.g., code-review in both `post-implementation` and `on-demand`). Skills are identified by the composite key `skillName + trigger`.

### Configuration

Hooks config is stored in `.openkit/hooks.json`:

```json
{
  "steps": [
    {
      "id": "step-1234567890-1",
      "name": "Type check",
      "command": "pnpm check-types",
      "enabled": true,
      "trigger": "post-implementation"
    }
  ],
  "skills": [
    {
      "skillName": "review-changes",
      "enabled": true,
      "trigger": "post-implementation"
    }
  ]
}
```

### Per-Issue Skill Overrides

Each issue can override the global enable/disable state of skills. Overrides are stored in the issue's notes and can be `inherit` (default), `enable`, or `disable`.

### Agent Workflow

1. Read hook configuration to understand what checks are expected
2. Run `pre-implementation` hooks before starting work
3. While working, check `custom` hook conditions and run matching hooks
4. Run `post-implementation` hooks after completing a task
5. Report skill results back to OpenKit via `report_hook_status`
6. Check run status to verify all steps passed
7. After all work and hooks are done, ask the user if they'd like to start the worktree dev server automatically
8. Lifecycle command hooks (`worktree-created` / `worktree-removed`) are triggered automatically by CLI-backed create/remove flows

---

## UI: Agents View

The Agents view in the web UI provides a unified interface for managing all agent tooling.

### Layout

The view uses a sidebar + detail panel layout:

- **Sidebar** (resizable, 200-500px): Lists all MCP servers, skills, and Claude plugins in collapsible sections. The built-in OpenKit server always appears first and is auto-selected by default.
- **Detail panel**: Shows configuration and management options for the selected item.

### Sidebar Sections

**Rules**: Static items for editing project-level agent instruction files (CLAUDE.md, AGENTS.md). Each item shows an active status dot when the file exists on disk, with a toggle on hover to create or delete the file (deletion requires confirmation). Selecting one opens a detail panel with full-height markdown preview and click-to-edit editing with debounced auto-save.

**MCP Servers**: Lists servers from the registry. Each item shows deployment status indicators for each agent. The built-in OpenKit server is always present.

**Skills**: Lists skills from the registry with deployment status per agent.

**Claude Plugins**: Lists installed plugins with enable/disable status. Shows component counts (commands, agents, skills, MCP servers, hooks, LSP) and health warnings.

**Git Policy**: Displays global toggle switches for agent commit, push, and PR permissions.

### Detail Panels

**MCP Server Detail** (`McpServerDetailPanel`):

- Server metadata (name, description, command, args, tags)
- Per-project environment variable overrides
- Deployment grid: toggle deployment to each agent at global or project scope
- Delete server from registry

**Skill Detail** (`SkillDetailPanel`):

- Skill metadata from SKILL.md frontmatter
- SKILL.md editor (frontmatter + instructions body)
- Optional reference.md and examples.md editors
- Deployment grid: toggle deployment to each agent at global or project scope
- Delete skill from registry

**Agent Rule Detail** (`AgentRuleDetailPanel`):

- File name and path header with delete button
- Markdown preview (click to switch to edit mode)
- Textarea editor with debounced auto-save (600ms)
- Empty state with "Create" button when the file doesn't exist
- Delete confirmation dialog

**Plugin Detail** (`PluginDetailPanel`):

- Plugin metadata (name, version, marketplace, scope)
- README content
- Component breakdown (commands, agents, skills, MCP servers, hooks, LSP)
- Health status and warnings
- Enable/disable, update, and uninstall actions

### Toolbar Actions

The toolbar at the top of the sidebar provides:

- Search filter across all items
- Add MCP Server (opens create modal)
- Add Skill (opens create/install modal)
- Add Plugin (opens install modal)
- Scan and Import (opens scan modal for discovering servers and skills on the filesystem)

### Auto-Discovery Banner

On first visit, the Agents view automatically runs a device-wide scan for MCP servers and skills. If new items are found, a banner appears offering to import them. This helps users quickly populate the registry with their existing tooling.

---

## API Reference

### Agent Rules

| Method   | Endpoint                   | Description                              |
| -------- | -------------------------- | ---------------------------------------- |
| `GET`    | `/api/agent-rules/:fileId` | Get file content (`{ exists, content }`) |
| `PUT`    | `/api/agent-rules/:fileId` | Save file content (`{ content }`)        |
| `DELETE` | `/api/agent-rules/:fileId` | Delete the file from disk                |

Valid `fileId` values: `claude-md` (CLAUDE.md), `agents-md` (AGENTS.md).

### MCP Servers

| Method   | Endpoint                             | Description                             |
| -------- | ------------------------------------ | --------------------------------------- |
| `GET`    | `/api/mcp-servers`                   | List servers (query params: `q`, `tag`) |
| `GET`    | `/api/mcp-servers/:id`               | Get single server                       |
| `POST`   | `/api/mcp-servers`                   | Create server                           |
| `PATCH`  | `/api/mcp-servers/:id`               | Update server                           |
| `DELETE` | `/api/mcp-servers/:id`               | Delete server                           |
| `POST`   | `/api/mcp-servers/:id/deploy`        | Deploy to agent (`{ tool, scope }`)     |
| `POST`   | `/api/mcp-servers/:id/undeploy`      | Undeploy from agent (`{ tool, scope }`) |
| `GET`    | `/api/mcp-servers/deployment-status` | Bulk deployment status matrix           |
| `POST`   | `/api/mcp-servers/scan`              | Scan filesystem (`{ mode, scanPath }`)  |
| `POST`   | `/api/mcp-servers/import`            | Bulk import scanned servers             |
| `GET`    | `/api/mcp-env/:serverId`             | Get per-project env for a server        |
| `PUT`    | `/api/mcp-env/:serverId`             | Set per-project env for a server        |

### Skills

| Method   | Endpoint                        | Description                                  |
| -------- | ------------------------------- | -------------------------------------------- |
| `GET`    | `/api/skills`                   | List all skills                              |
| `GET`    | `/api/skills/:name`             | Get skill detail (frontmatter + content)     |
| `POST`   | `/api/skills`                   | Create skill in registry                     |
| `PATCH`  | `/api/skills/:name`             | Update skill (SKILL.md, reference, examples) |
| `DELETE` | `/api/skills/:name`             | Delete skill (cleans up all symlinks)        |
| `POST`   | `/api/skills/:name/deploy`      | Deploy to agent (`{ agent, scope }`)         |
| `POST`   | `/api/skills/:name/undeploy`    | Undeploy from agent (`{ agent, scope }`)     |
| `GET`    | `/api/skills/deployment-status` | Deployment status matrix per agent           |
| `POST`   | `/api/skills/scan`              | Scan filesystem for skills                   |
| `POST`   | `/api/skills/import`            | Import scanned skills into registry          |
| `POST`   | `/api/skills/install`           | Install from GitHub via `npx skills add`     |
| `GET`    | `/api/skills/npx-available`     | Check if `npx skills` CLI is available       |

### Claude Plugins

| Method   | Endpoint                                        | Description                       |
| -------- | ----------------------------------------------- | --------------------------------- |
| `GET`    | `/api/claude/plugins`                           | List installed plugins            |
| `GET`    | `/api/claude/plugins/:id`                       | Get plugin detail                 |
| `GET`    | `/api/claude/plugins/available`                 | List marketplace plugins          |
| `GET`    | `/api/claude/plugins/debug`                     | Raw CLI output for debugging      |
| `POST`   | `/api/claude/plugins/install`                   | Install plugin (`{ ref, scope }`) |
| `POST`   | `/api/claude/plugins/:id/uninstall`             | Uninstall plugin                  |
| `POST`   | `/api/claude/plugins/:id/enable`                | Enable plugin                     |
| `POST`   | `/api/claude/plugins/:id/disable`               | Disable plugin                    |
| `POST`   | `/api/claude/plugins/:id/update`                | Update plugin                     |
| `GET`    | `/api/claude/plugins/marketplaces`              | List configured marketplaces      |
| `POST`   | `/api/claude/plugins/marketplaces`              | Add marketplace (`{ source }`)    |
| `DELETE` | `/api/claude/plugins/marketplaces/:name`        | Remove marketplace                |
| `POST`   | `/api/claude/plugins/marketplaces/:name/update` | Update marketplace index          |

### MCP Transport

| Method | Endpoint | Description                            |
| ------ | -------- | -------------------------------------- |
| `ALL`  | `/mcp`   | Streamable HTTP MCP transport endpoint |
