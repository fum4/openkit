<img src="docs/assets/openkit-icon.png" alt="OpenKit app icon" width="96" />

# OpenKit

OpenKit is an AI engineering workflow platform.
It gives agents a real execution loop: pick up tasks, work in isolated environments, run checks,
and ship pull requests with clear visibility.

Recent updates:

- Added per-project debug-log mode in Activity cards (Debug toggle) with operational traces for command execution, request traces, notification emissions, and UI error reports.
- Runtime command monitoring now captures all server-side `execFile` / `execFileSync` / `spawn` calls into `.openkit/ops-log.jsonl` and streams them live over SSE.
- UI error toasts now auto-dismiss after 5 seconds and are mirrored into operational logs for easier debugging.
- Hook lifecycle triggers (`worktree-created`, `worktree-removed`) now support command, prompt, and skill configuration.
- Consecutive task-detected activity events are grouped into a single feed entry with per-item detail rows.
- Worktree branch-ref collision errors now surface recovery choices (reuse existing or recreate fresh) in "Code with" flows.
- Worktree deletion now clears transient state and prunes stale git worktree metadata so the same worktree ID can be recreated immediately.
- Base-branch auto-detection now prefers local branch names (for example `main` instead of `origin/main`).

Check the official [docs](https://openkit.work/) for more info and usage patterns.

<br /><br />

## 🏗 Setup

### Prerequisites:

- Node.js >= 18 (LTS recommended)
- pnpm >= 10

<br />

**1. Enable Corepack**

```bash
$ corepack enable pnpm
```

<br />

**2. Install dependencies**

```bash
$ pnpm install
```

<br />

**3. Initialize local environment**

```bash
$ pnpm run setup
```

<br />

**4. Build once (recommended for first run)**

```bash
$ pnpm build
```

<br /><br />

## 🏃🏻‍♂️ Run the app

Run all first-class apps:

```bash
$ pnpm dev
```

Run specific app flows:

```bash
$ pnpm dev:cli
$ pnpm dev:server
$ pnpm dev:desktop-app
$ pnpm dev:mobile-app
$ pnpm dev:web-app
$ pnpm dev:website
```

<br /><br />

## ⚙️ Build

```bash
$ pnpm build
$ pnpm build:cli
$ pnpm build:server
$ pnpm build:web-app
$ pnpm build:desktop-app
$ pnpm build:website
$ pnpm build:mobile-app
```

Environment variables:

- `OPENKIT_SERVER_PORT` (default `6969`) — backend server base port
- `OPENKIT_WEB_APP_PORT` (default `5173`) — web-app Vite dev server port

<br /><br />

## 📦 Package

```bash
$ pnpm package
$ pnpm package:mac
$ pnpm package:linux
```

<br /><br />

## 🚀 Deploy

Everything is released from `master`.

- On pull requests targeting `master`, CI runs code quality, type checks, smoke tests, and build jobs with affected-target guards.
- On push/merge to `master`, the release workflow creates the release commit/tag and GitHub release only when `desktop-app` (or its packaging dependencies) is affected.
- A dedicated package workflow runs on release tag pushes and attaches macOS/Linux artifacts to that tag.

<br /><br />

## 📚 Docs

- [API Reference](docs/API.md)
- [Agents](docs/AGENTS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [CLI Reference](docs/CLI.md)
- [Configuration](docs/CONFIGURATION.md)
- [Development](docs/DEVELOPMENT.md)
- [Electron](docs/ELECTRON.md)
- [Frontend](docs/FRONTEND.md)
- [Hooks](docs/HOOKS.md)
- [Integrations](docs/INTEGRATIONS.md)
- [MCP](docs/MCP.md)
- [Notifications](docs/NOTIFICATIONS.md)
- [Port Mapping](docs/PORT-MAPPING.md)
- [Project Structure](docs/PROJECT_STRUCTURE.md)
- [Setup Flow](docs/SETUP-FLOW.md)
