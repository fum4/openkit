# CLI Commands Reference

dawg is primarily a CLI tool. Running `dawg` with no arguments starts the server and opens the web UI. All other functionality is accessed through subcommands.

```
dawg [command] [options]
```

## Command Inventory

| Command                                                 | Description                                                              |
| ------------------------------------------------------- | ------------------------------------------------------------------------ |
| `dawg [--no-open] [--auto-init]`                        | Start dawg server/UI for the current project.                            |
| `dawg init`                                             | Run setup wizard and create `.dawg/config.json`.                         |
| `dawg add [github\|linear\|jira]`                       | Connect or configure an integration.                                     |
| `dawg mcp`                                              | Run dawg as an MCP server for agents.                                    |
| `dawg activity await-input ...`                         | Emit an "agent awaiting user input" activity event for the UI.           |
| `dawg activity phase ...`                               | Emit a canonical workflow phase checkpoint event for a worktree.         |
| `dawg activity check-flow ...`                          | Validate whether required workflow phases/hooks were completed.           |
| `dawg task`                                             | Open interactive task flow (choose source, then pick or enter issue ID). |
| `dawg task [ID...] [--init] [--save] [--link]`          | Auto-resolve source from ID(s), then continue with selected action.      |
| `dawg task [source] [--init] [--save] [--link]`         | Open source-specific issue picker, then continue with selected action.   |
| `dawg task [source] [ID...] [--init] [--save] [--link]` | Fetch task(s) from explicit source and optionally initialize/link/save.  |
| `dawg task resolve [ID...] [--json]`                    | Resolve issue source/normalized key without creating worktrees.          |

---

## Commands

### `dawg` (default)

Start the server and open the UI.

```bash
dawg
dawg --no-open
dawg --auto-init
```

When run without a subcommand, dawg does the following:

1. Loads global preferences from `~/.dawg/app-preferences.json`
2. Determines the server port (see [Port Selection](#port-selection))
3. If the Electron app is already running, opens the current project as a new tab in the existing window and exits
4. If no `.dawg/config.json` is found:
   - With `--auto-init`: auto-initializes config using detected defaults (start command, install command, base branch)
   - In an interactive terminal: launches the setup wizard (`dawg init`)
   - Non-interactive (e.g., spawned by Electron): proceeds with defaults
5. Starts the Hono HTTP server
6. Writes `server.json` to `.dawg/` for agent discovery (contains the server URL and PID)
7. Opens the UI:
   - If the Electron app is installed, opens it via the `dawg://` protocol
   - If running in dev mode with Electron available, spawns Electron directly
   - If no Electron is found and the terminal is interactive, prompts to install the desktop app (macOS only — downloads and installs the latest DMG from GitHub Releases)
   - If the user declines or the terminal is non-interactive, just prints the server URL

**Options:**

| Option        | Environment Variable | Description                                                         |
| ------------- | -------------------- | ------------------------------------------------------------------- |
| `--no-open`   | `DAWG_NO_OPEN=1`     | Start the server without opening the UI                             |
| `--auto-init` | `DAWG_AUTO_INIT=1`   | Auto-initialize config if none is found (skips interactive prompts) |

On first run, dawg also installs itself into `~/.local/bin/` (as a shell wrapper) so the `dawg` command is available system-wide. If `~/.local/bin` is not in your `PATH`, it will print a warning with instructions.

---

### `dawg init`

Interactive setup wizard to create `.dawg/config.json`.

```bash
dawg init
```

Must be run inside a git repository. Exits with an error if a config file already exists.

The wizard prompts for:

| Prompt            | Default                                              | Description                                      |
| ----------------- | ---------------------------------------------------- | ------------------------------------------------ |
| Project directory | `.` (current directory)                              | Absolute or relative path to the project root    |
| Base branch       | Auto-detected (e.g., `origin/main`)                  | Branch that new worktrees are created from       |
| Dev start command | Auto-detected from `package.json` scripts            | Command to start the dev server in each worktree |
| Install command   | Auto-detected (`pnpm install`, `yarn install`, etc.) | Command to install dependencies in each worktree |

After writing the config, `init` also:

- Creates a `.dawg/.gitignore` with a whitelist approach (ignores everything except `config.json` and `.gitignore`)
- Auto-enables the default project skill (`work-on-task`) in per-agent project skill directories
- Stages both files with `git add` so they are ready to commit
- Detects environment variable mappings if ports are already configured
- Prints next steps for getting started

The generated config file (`.dawg/config.json`) looks like:

```json
{
  "startCommand": "pnpm dev",
  "installCommand": "pnpm install",
  "baseBranch": "origin/main",
  "ports": {
    "discovered": [],
    "offsetStep": 1
  }
}
```

---

### `dawg add [name]`

Set up an integration.

```bash
dawg add            # Interactive picker
dawg add github     # Set up GitHub directly
dawg add linear     # Set up Linear directly
dawg add jira       # Set up Jira directly
```

Requires an existing config (`dawg init` must have been run first). If no integration name is provided, an interactive picker is shown with the current status of each integration.

#### `dawg add github`

Checks for the GitHub CLI (`gh`) and verifies authentication. Does not store any credentials -- GitHub integration relies entirely on the `gh` CLI being installed and authenticated.

Prerequisites:

- Install `gh`: `brew install gh` (macOS) or see [GitHub CLI docs](https://github.com/cli/cli)
- Authenticate: `gh auth login`

Once set up, enables PR creation, commit, and push from the dawg UI.

#### `dawg add linear`

Connects to Linear for issue tracking.

Prompts for:

- **API Key** -- create one at https://linear.app/settings/account/security/api-keys/new
- **Default team key** (optional, e.g., `ENG`)

Tests the connection before saving. Credentials are stored in `.dawg/integrations.json` (gitignored by default).

#### `dawg add jira`

Connects to Atlassian Jira for issue tracking. Offers two authentication methods:

**OAuth 2.0 (recommended):**

- Requires creating an OAuth app at https://developer.atlassian.com/console
- Prompts for Client ID and Client Secret
- Runs a browser-based OAuth authorization flow
- Auto-discovers the Jira Cloud ID and site URL

**API Token:**

- Simpler setup, no app registration needed
- Create a token at https://id.atlassian.com/manage-profile/security/api-tokens
- Prompts for site URL, email, and API token

Both methods prompt for an optional default project key (e.g., `PROJ`). Credentials are stored in `.dawg/integrations.json`.

---

### `dawg mcp`

Start as an MCP (Model Context Protocol) server for AI coding agents.

```bash
dawg mcp
```

Uses stdio for JSON-RPC communication. All `console.log` output is redirected to stderr because stdout is reserved for JSON-RPC messages.

Operates in one of two modes:

- **Proxy mode**: If a dawg server is already running (detected via `.dawg/server.json`), relays JSON-RPC messages between stdio and the HTTP server's `/mcp` endpoint. This gives the agent shared state with the UI.
- **Standalone mode**: If no server is running, creates its own `WorktreeManager` instance and operates independently.

Typical usage in a Claude Code MCP configuration:

```json
{
  "mcpServers": {
    "dawg": {
      "command": "dawg",
      "args": ["mcp"]
    }
  }
}
```

---

### `dawg activity await-input`

Emit an activity event when an agent is blocked waiting for user input/approval. This powers the special **Input needed** badge shown to the left of the bell icon in the header.

```bash
dawg activity await-input --message "Need approval to run DB migration"
dawg activity await-input "Need product decision on checkout copy" --worktree NOM-18
dawg activity await-input --message "Need confirmation" --detail "Ship with flag on?" --severity warning
```

Behavior:

1. Finds the running project server via `.dawg/server.json`
2. Posts `agent_awaiting_input` to `POST /api/activity`
3. Sets `metadata.requiresUserAction=true` so the event appears in the Activity feed's action-required section

Options:

- `--message <text>` (required, positional text also supported)
- `--worktree <id>` (optional, inferred from `.dawg/worktrees/<id>/...` path when omitted)
- `--detail <text>` (optional)
- `--severity <info|success|warning|error>` (optional, default `warning`)

---

### `dawg activity phase`

Emit a canonical workflow checkpoint event so agents can prove they respected the required flow.

```bash
dawg activity phase --phase task-started --worktree NOM-18
dawg activity phase pre-hooks-started --worktree NOM-18
dawg activity phase --phase implementation-completed --detail "Core feature done; preparing post-hooks"
```

Supported phases:

- `task-started`
- `pre-hooks-started`
- `pre-hooks-completed`
- `implementation-started`
- `implementation-completed`
- `post-hooks-started`
- `post-hooks-completed`

Options:

- `--phase <name>` (required, positional also supported)
- `--worktree <id>` (optional, inferred from `.dawg/worktrees/<id>/...` path when omitted)
- `--message <text>` (optional custom title; defaults to `Workflow phase: <phase>`)
- `--detail <text>` (optional)
- `--severity <info|success|warning|error>` (optional, default `info`)

---

### `dawg activity check-flow`

Validate flow compliance for a worktree. This checks required workflow phases plus required hook/skill execution evidence.

```bash
dawg activity check-flow --worktree NOM-18
dawg activity check-flow --worktree NOM-18 --json
```

Behavior:

1. Calls `GET /api/worktrees/:id/flow-compliance`
2. Reports pass/fail, missing phases, hook/skill gaps, and required follow-up actions
3. Exits non-zero when compliance fails (useful as a pre-finalization gate)

Options:

- `--worktree <id>` (optional, inferred from current worktree path when omitted)
- `--json` (optional, prints full JSON report)

---

### `dawg task [source|resolve] [ID...]`

Create worktrees from issue IDs. Supports Jira, Linear, and local issues.

```bash
dawg task
dawg task jira
dawg task jira PROJ-123
dawg task linear ENG-42
dawg task local 7
dawg task PROJ-123 --init
dawg task local LOCAL-1 --init
dawg task jira PROJ-123 --save
dawg task jira PROJ-123 PROJ-456
dawg task jira 123
dawg task resolve ENG-42 --json
```

The first argument can be:

- a source (`jira`, `linear`, `local`) followed by IDs
- a source only (`jira`, `linear`, `local`) to open an interactive issue picker
- `resolve` followed by IDs (resolution-only mode)
- an ID directly (source auto-resolution mode)

Requires the relevant integration to be connected (`dawg add jira` for Jira, `dawg add linear` for Linear). Local issues don't require an integration.

**Single task mode:** Fetches the issue, prints a summary, saves task data, then prompts for an action (create worktree, link to existing, or just save).

When source is provided without an ID (for example `dawg task jira`), CLI shows:

- `Type issue ID manually`
- followed by tracker issues in the format `<ID> — <title>`

**Batch mode** (multiple IDs): Fetches each issue, auto-creates a worktree for each, and skips interactive prompts. Errors on individual tasks are logged but don't stop the batch.

**Action flags** (optional): Skip interactive action prompts in single-task mode.

- `--init` -- initialize (create/link) worktree immediately
- `--save` -- fetch/save task only
- `--link` -- jump directly to "select existing worktree"
- `--json` -- machine-readable output for `dawg task resolve`

**Resolver behavior (`dawg task resolve`)**

Resolution checks happen in this order:

1. Existing issue files under `.dawg/issues/` (local/jira/linear)
2. Connected integrations in `.dawg/integrations.json`
3. Default keys when both integrations are connected:
   - Jira: `jira.defaultProjectKey`
   - Linear: `linear.defaultTeamKey`

If the source is ambiguous, the command exits with an error and asks you to specify source explicitly.
When a prefixed Jira/Linear key is validated, dawg updates the corresponding default key in `.dawg/integrations.json` automatically.

This command:

1. Resolves the source and task key (from cache/integrations/default keys when needed)
2. Fetches issue details (summary, status, priority, assignee, labels)
3. Prints a summary of the issue
4. Saves task data locally
5. Downloads any attachments (Jira only)
6. In single mode, prompts for an action:
   - **Create a worktree** -- creates a new git worktree with the issue key as the branch name, copies `.env` files, runs the install command, then runs `worktree-created` command hooks (if configured)
   - **Link to an existing worktree** -- associates the task with a worktree that already exists
   - **Just save the data** -- saves the task data without creating or linking a worktree
7. In batch mode, automatically creates a worktree for each task and runs `worktree-created` command hooks per successful creation

---

### `--help`, `-h`

Show the help message with a summary of all commands and options.

```bash
dawg --help
dawg -h
```

Output:

```
dawg -- git worktree manager with automatic port offsetting

Usage: dawg [command] [options]

Commands:
  (default)     Start the server and open the UI
  init          Interactive setup wizard to create .dawg/config.json
  add [name]    Set up an integration (github, linear, jira)
  mcp           Start as an MCP server (for AI coding agents)
  activity      Emit workflow activity events (for agent/user coordination)
  task [source|resolve] [ID...] Manage task resolution and worktree creation

Options:
  --no-open     Start the server without opening the UI
  --auto-init   Auto-initialize config if none found
  --help, -h    Show this help message
  --version, -v Show version
```

---

### `--version`, `-v`

Show the current version.

```bash
dawg --version
dawg -v
```

---

## Configuration Discovery

When dawg starts, it searches for `.dawg/config.json` by walking up the directory tree from the current working directory:

1. Check `$CWD/.dawg/config.json`
2. Check `$CWD/../.dawg/config.json`
3. Continue up to the filesystem root

Config files found inside worktree directories (paths containing `.dawg/worktrees/`) are skipped. This ensures that when you `cd` into a worktree checkout, dawg still finds the main project's config rather than a config from the worktree's source tree.

Once found, dawg changes the working directory to the project root (the parent of `.dawg/`).

If no config is found, dawg uses defaults:

| Setting            | Default       |
| ------------------ | ------------- |
| `projectDir`       | `.`           |
| `startCommand`     | `""` (empty)  |
| `installCommand`   | `""` (empty)  |
| `baseBranch`       | `origin/main` |
| `ports.discovered` | `[]`          |
| `ports.offsetStep` | `1`           |

---

## Port Selection

The server port is determined by the following priority (highest first):

1. **`DAWG_PORT` environment variable** -- e.g., `DAWG_PORT=7070 dawg`
2. **Global preferences** -- `basePort` in `~/.dawg/app-preferences.json` (configurable through the Electron app or API)
3. **Default** -- `6969`

If the chosen port is already in use, dawg automatically increments and tries the next port until it finds an available one.

---

## Environment Variables

| Variable         | Description                                                                       |
| ---------------- | --------------------------------------------------------------------------------- |
| `DAWG_PORT`      | Override the server port (highest priority)                                       |
| `DAWG_NO_OPEN`   | Set to `1` to start the server without opening the UI (equivalent to `--no-open`) |
| `DAWG_AUTO_INIT` | Set to `1` to auto-initialize config if none found (equivalent to `--auto-init`)  |
| `DAWG_ENABLE_MCP_SETUP` | Set to `1` to enable MCP setup routes |

---

## Global Preferences

Stored at `~/.dawg/app-preferences.json`. These preferences persist across all projects.

| Key               | Type                          | Default | Description                       |
| ----------------- | ----------------------------- | ------- | --------------------------------- |
| `basePort`        | `number`                      | `6969`  | Default server port               |
| `setupPreference` | `"auto" \| "manual" \| "ask"` | `"ask"` | How to handle missing config      |
| `sidebarWidth`    | `number`                      | `300`   | UI sidebar width in pixels        |
| `windowBounds`    | `object \| null`              | `null`  | Electron window position and size |

---

## File Layout

After initialization, the `.dawg/` directory contains:

```
.dawg/
  config.json          # Project configuration (committed to git)
  .gitignore           # Whitelist gitignore (committed to git)
  server.json          # Running server info (auto-generated, gitignored)
  integrations.json    # Integration credentials (gitignored)
  worktrees/           # Git worktree checkouts
  tasks/               # Jira task data and attachments
  local-issues/        # Local issue storage
```

The global `~/.dawg/` directory contains:

```
~/.dawg/
  app-preferences.json # Global preferences
  electron.lock        # Electron process lock file
```
