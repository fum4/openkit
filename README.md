<img src="assets/icon.png" alt="OpenKit app icon" width="96" />

# OpenKit

OpenKit is an AI engineering workflow platform.
It gives agents a real execution loop: pick up tasks, work in isolated environments, run checks,
and ship pull requests with clear visibility.

🌐 [dawg-chi.vercel.app](https://dawg-chi.vercel.app/)

<br /><br />

## ✨ Features

- **Task-driven development**: Create and execute work from Jira, Linear, and local tasks in one
  consistent flow.
- **Isolated environments**: Each task runs independently on Git worktrees with automatic port
  conflict resolution.
- **Agent tooling hub**: Centralize agent tooling and workflow hooks instead of per-agent silos.
- **Real-time visibility**: Track execution across agents with live activity and high-signal
  blocker/approval notifications.

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

> [!IMPORTANT]
>
> Make sure `.env.local` exists before running the app (`pnpm run setup`).

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
$ pnpm package:desktop
```

Environment variables:

- `OPENKIT_SERVER_PORT` (default `6969`) — backend server base port
- `OPENKIT_WEB_APP_PORT` (default `5173`) — web-app Vite dev server port

<br /><br />

## 🚀 Deploy

Everything is released from `master`.

- On pull requests targeting `master`, CI runs code quality, type checks, smoke tests, and build jobs with affected-target guards (so non-impacted jobs are skipped).
- On push/merge to `master`, the release workflow creates the release commit/tag and GitHub release automatically.
- A dedicated package workflow runs on release tag pushes (`v*`) and attaches macOS/Linux artifacts to that tag.
- The website Vercel project uses an `ignoreCommand` to skip deploys when commits do not change files under `apps/website/`.
- Website metadata is host-aware for social sharing on preview deployments (`*.vercel.app`) while canonical URLs remain `https://openkit.dev`.

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
