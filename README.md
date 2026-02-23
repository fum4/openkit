# OpenKit

A CLI tool and desktop UI for managing multiple git worktrees with automatic port offsetting, issue tracker integration, and AI agent support. It solves the fundamental problem of running multiple dev server instances concurrently — when your app binds ports 3000 and 3001, a second copy can't start without conflicts. OpenKit transparently offsets all known ports per worktree by monkey-patching Node.js `net.Server.listen` and `net.Socket.connect` at runtime.

Beyond port management, OpenKit provides a full development workflow: create worktrees from Jira or Linear issues, track progress with todos, run hooks (automated checks and agent skills), and integrate with AI coding agents via MCP (Model Context Protocol).

## Quick Start

```bash
# In your project directory
cd /path/to/your/project
openkit init    # interactive setup — discovers ports, configures commands
openkit         # start the server and open the UI
# or: ok
```

## Install CLI

```bash
npm install -g openkit
openkit --help
ok --help
```

The package name is `openkit`. Command aliases shipped by the package are `openkit` and `ok`.

## Developer Git Hooks

This repository uses Husky for git hooks. Hooks are installed automatically by `pnpm install` via the `prepare` script.

The configured `.husky/pre-commit` hook runs `pnpm lint-staged` for fast staged-file checks.
Use `pnpm check:all` when you want full-repo validation.

In the UI:

1. Click **Discover Ports** to auto-detect all ports your dev command binds
2. Create worktrees from branches or issue tracker tickets
3. Start them — ports are offset automatically, no conflicts

## How Port Offsetting Works

```
Main repo:    api:3000, web:3001  (no offset)
Worktree 1:   api:3010, web:3011  (offset 1 × step 10)
Worktree 2:   api:3020, web:3021  (offset 2 × step 10)
```

A pure CommonJS hook (`port-hook.cjs`) is injected via `NODE_OPTIONS=--require` into all spawned processes. It intercepts `listen()` and `connect()` calls, offsetting known ports. Since `NODE_OPTIONS` propagates to child processes, the entire process tree (turborepo, yarn, tsx, vite, etc.) is covered.

See [Port Mapping](docs/PORT-MAPPING.md) for the full technical details.

## Features

### Worktree Management

Create, start, stop, and remove git worktrees from the UI or CLI. Each worktree gets its own port offset, environment variables, and process lifecycle.
In the worktree detail header, the split **Open** button auto-detects supported local apps (IDE/file manager/terminal), remembers the selected target per project, and shows it directly in the primary action label (for example `Open in Cursor`).

### Issue Tracker Integration

Connect to **Jira** (OAuth or API token), **Linear** (API key), or create **local issues**. Create worktrees directly from tickets — OpenKit fetches issue details, generates a TASK.md with context, and sets up the branch.
Optionally enable auto-start per integration so newly fetched Jira/Linear issues are claimed automatically. You can choose the auto-start agent (Claude, Codex, Gemini CLI, or OpenCode), whether skip-permissions mode is used, and whether the UI auto-focuses the selected agent terminal when work begins.
Issue/task detail views now use a split **Code with ...** button with Claude, Codex, Gemini CLI, and OpenCode options. The last selected agent becomes the default action for subsequent issue/task launches. On manual launch, OpenKit checks whether the selected CLI is installed and offers a one-click Homebrew install action when missing. Manual launches prompt for safe mode vs skip-permissions mode.

See [Integrations](docs/INTEGRATIONS.md) for setup details.

### AI Agent Support (MCP)

OpenKit exposes 20+ tools via MCP (Model Context Protocol) that any AI coding agent can use — browse issues, create worktrees, manage todos, commit/push/PR, run hooks. Agents get a structured workflow: pick an issue, create a worktree, read TASK.md, work through todos, run hooks, and ship.
When a project is initialized (`openkit init` or setup flow), OpenKit auto-enables the bundled `work-on-task` skill in project skill directories.
Set `OPENKIT_ENABLE_MCP_SETUP=1` to enable MCP setup routes.

See [MCP](docs/MCP.md) for the tool reference and [Agents](docs/AGENTS.md) for the agent tooling system.

### Activity Feed & Notifications

Real-time activity feed tracks everything happening across your projects — agent actions (commits, pushes, PRs), worktree lifecycle events, hook results, and more. A bell icon in the header shows unread events, supports multi-select filter chips (`Worktree`, `Hooks`, `Agents`, `System`), and Settings lets you enable/disable every activity event type individually. Workflow/agent/live updates stay in the Activity feed, while toasts are reserved for direct user-action success/failure. In the Electron app, native OS notifications fire when the window is unfocused and an agent is awaiting user input.

If an agent is blocked waiting on user approval/instructions, it should emit a dedicated awaiting-input event with `openkit activity await-input --message "..."`, which shows an **Input needed** badge to the left of the bell.

See [Notifications](docs/NOTIFICATIONS.md) for the full architecture, event types, and configuration.

### Hooks

Automated checks and agent skills organized by trigger type (pre-implementation, post-implementation, custom, on-demand, worktree-created, worktree-removed). Lifecycle triggers are command-only and run automatically on worktree create/remove flows.
When Claude, Codex, Gemini CLI, or OpenCode is launched from issue/task flows, OpenKit also runs pre-implementation command hooks automatically before launch and post-implementation command hooks after a clean agent exit.

See [Hooks](docs/HOOKS.md) for configuration and usage.

### Electron Desktop App

Optional native app with multi-project tab support, `OpenKit://` deep linking, native OS notifications, and window state persistence.

See [Electron](docs/ELECTRON.md) for details.

## CLI Commands

| Command                            | Description                                             |
| ---------------------------------- | ------------------------------------------------------- | --------------------------------------------------------- |
| `openkit`                          | Start the server and open the UI                        |
| `ok`                               | Alias for `openkit`                                     |
| `openkit init`                     | Interactive setup wizard                                |
| `openkit add [name]`               | Set up an integration (github, linear, jira)            |
| `openkit mcp`                      | Start as an MCP server for AI agents                    |
| `openkit activity await-input ...` | Emit an "agent awaiting input" activity event           |
| `openkit activity todo ...`        | Check/uncheck issue todo checkboxes from terminal flows |
| `openkit task [source              | resolve] [ID...]`                                       | Resolve issues and create worktrees (jira, linear, local) |
| `openkit connect`                  | Connect to an existing OpenKit server                   |

See [CLI Reference](docs/CLI.md) for full details.

## Configuration

OpenKit stores its configuration in `.openkit/config.json` at the project root. Key settings include start/install commands, discovered ports, offset step, environment variable mappings, and integration credentials.

See [Configuration](docs/CONFIGURATION.md) for the complete reference.

## Documentation

| Document                                       | Description                                           |
| ---------------------------------------------- | ----------------------------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)           | System layers, components, data flow, build system    |
| [Project Structure](docs/PROJECT_STRUCTURE.md) | Canonical repository/file layout map                  |
| [CLI Reference](docs/CLI.md)                   | All CLI commands and options                          |
| [Configuration](docs/CONFIGURATION.md)         | Config files, settings, and data storage              |
| [API Reference](docs/API.md)                   | REST API endpoints                                    |
| [MCP Tools](docs/MCP.md)                       | Model Context Protocol integration and tool reference |
| [Agents](docs/AGENTS.md)                       | Agent tooling system, skills, plugins, git policy     |
| [Integrations](docs/INTEGRATIONS.md)           | Jira, Linear, and GitHub setup                        |
| [Port Mapping](docs/PORT-MAPPING.md)           | Port discovery, offset algorithm, runtime hook        |
| [Hooks](docs/HOOKS.md)                         | Hooks system (trigger types, commands, skills)        |
| [Electron](docs/ELECTRON.md)                   | Desktop app, deep linking, multi-project              |
| [Frontend](docs/FRONTEND.md)                   | React UI architecture, theme, components              |
| [Development](docs/DEVELOPMENT.md)             | Developer guide, build commands, conventions          |
| [Notifications](docs/NOTIFICATIONS.md)         | Activity feed, toasts, OS notifications, event types  |
| [Setup Flow](docs/SETUP-FLOW.md)               | Project setup wizard, state machine, integrations     |

## Website

The landing page lives in `/website`, built with [Astro](https://astro.build/). It's a static site with OS-aware download links (macOS/Linux defaults plus a full release-option selector), feature overview, and install instructions.

```bash
cd website
pnpm install
pnpm dev      # Dev server
pnpm build    # Static build → website/dist/
```

## Platform Constraints

- **Unix only (macOS and Linux)** — depends on `lsof` for port discovery and process group signals
- **Node.js processes only** — the `--require` hook doesn't work with non-Node runtimes
- **GitHub integration** requires `gh` CLI installed and authenticated
- **Jira integration** requires OAuth setup via the Integrations panel
