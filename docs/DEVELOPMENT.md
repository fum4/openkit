# Development Guide

This document covers everything you need to develop, build, and extend OpenKit.

## Prerequisites

- **Node.js** >= 18
- **pnpm** >= 10 (package manager)
- **macOS or Linux** (Unix-only -- depends on `lsof` and `pgrep`)
- **Optional:** `gh` CLI for GitHub integration (PR creation, status checks)
- **Optional:** Electron for desktop app development (`electron` and `electron-builder` are dev dependencies)

## Getting Started

```bash
git clone <repo-url>
cd worktree-manager
pnpm install
pnpm run setup
pnpm build
pnpm dev
```

`pnpm dev` runs all app dev targets in parallel (`cli`, `server`, `web-app`, `desktop-app`, `website`, `mobile-app`).

## Build Commands

| Command                      | Description                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------- |
| `pnpm build`                 | Run Nx `build` target across workspace projects that define it                                           |
| `pnpm build:cli`             | Build CLI app (`cli`)                                                                                    |
| `pnpm build:server`          | Build backend server app (`server`)                                                                      |
| `pnpm build:web-app`         | Build web app (`web-app`)                                                                                |
| `pnpm build:desktop-app`     | Build desktop app runtime (without packaging) (`desktop-app`)                                            |
| `pnpm build:website`         | Build Astro marketing site (`website`)                                                                   |
| `pnpm build:mobile-app`      | Build mobile app export (`mobile-app`)                                                                   |
| `pnpm package:desktop`       | Package desktop app artifacts for all supported desktop targets (`desktop-app`)                          |
| `pnpm package:desktop:mac`   | Package macOS desktop app artifacts (`desktop-app`)                                                      |
| `pnpm package:desktop:linux` | Package Linux desktop app artifacts (`desktop-app`)                                                      |
| `pnpm run setup`             | Create `.env.local` from `.env.example` if missing                                                       |
| `pnpm dev`                   | Start all first-class app dev flows (`cli`, `server`, `web-app`, `desktop-app`, `website`, `mobile-app`) |
| `pnpm dev:cli`               | Start CLI dev watch flow (`cli`)                                                                         |
| `pnpm dev:server`            | Start backend server watch flow (`server`)                                                               |
| `pnpm dev:web-app`           | Start web app + backend together (`web-app`, `server`)                                                   |
| `pnpm dev:desktop-app`       | Start desktop app with required deps (`desktop-app`, `web-app`, `cli`)                                   |
| `pnpm dev:website`           | Start Astro website dev server (`website`)                                                               |
| `pnpm dev:mobile-app`        | Start Expo mobile dev server (`mobile-app`)                                                              |
| `pnpm nx run cli:start`      | Build and run CLI from app scripts (`apps/cli`)                                                          |
| `pnpm check:affected`        | Format + Nx affected lint/typecheck/build (`NX_BASE`/`NX_HEAD` override supported)                       |
| `pnpm check:types`           | Nx typecheck across projects that define `typecheck` (apps + libs)                                       |
| `pnpm check:format`          | Run oxfmt in check mode                                                                                  |
| `pnpm check:lint`            | Nx lint across projects that define `lint` (apps + libs)                                                 |
| `pnpm lint-staged`           | Run formatter/linter checks only for currently staged files                                              |
| `pnpm check:all`             | Run format + Nx run-many lint/typecheck/build                                                            |
| `pnpm fix:format`            | Run oxfmt to apply formatting                                                                            |
| `pnpm fix:lint`              | Run oxlint with `--fix`                                                                                  |
| `pnpm fix:all`               | Run format + lint auto-fixes                                                                             |

There is no test runner configured.

Runtime note: UI assets are optional in core installs. The CLI can install optional UI components with `openkit ui` (web bundle and/or desktop app).

App script contract: app packages expose a non-watch `preview` script for running built artifacts and a `start` script that builds first, then runs preview. `desktop-app` follows the same direction and uses Nx (`desktop-app:build`) inside its `start` script so dependent app artifacts are built before launch.

## Nx Workspace

OpenKit uses Nx for workspace orchestration and task caching while keeping app-level build tools (tsup, Vite, electron-builder).

- Workspace config lives in `nx.json`
- pnpm workspace config lives in `pnpm-workspace.yaml` (globs `apps/*`, `libs/*`, and `packages/*`; only directories with their own `package.json` are treated as pnpm packages)
- Project configs are colocated as `project.json` in:
  - `apps/web-app` (`web-app`)
  - `apps/cli` (`cli`)
  - `apps/server` (`server`)
  - `apps/desktop-app` (`desktop-app`)
  - `apps/website` (`website`)
  - `apps/mobile-app` (`mobile-app`)

Package layout:

- Root `package.json` is the workspace orchestration entrypoint (marked `private` to prevent accidental npm publish).
- `apps/cli`, `apps/server`, `apps/web-app`, and `apps/desktop-app` own their direct scripts and dependencies.
- Root `tsconfig.base.json` + `tsconfig.json` provide shared TypeScript workspace configuration.
- `apps/website/package.json` and `apps/mobile-app/package.json` remain independently tooled ecosystems (Astro and Expo).

Common commands:

```bash
pnpm nx show projects
pnpm nx run web-app:build
pnpm nx run cli:typecheck
pnpm run check:affected
```

## Git Hooks

OpenKit uses Husky. Hooks are installed by `pnpm install` through the root `prepare` script.

The configured `.husky/pre-commit` hook runs `pnpm lint-staged` (staged files only for speed).
Run `pnpm check:all` manually or in CI for full-repository validation.

## VS Code Run Configurations

The workspace includes script-oriented launch configurations in `.vscode/launch.json` for common flows:

- App development (`dev`, `dev:cli`, `dev:server`, `dev:web-app`, `dev:desktop-app`, `dev:website`, `dev:mobile-app`)
- App builds (`build` plus app-specific `build:*`)
- Desktop packaging (`package:desktop`, `package:desktop:mac`, `package:desktop:linux`)
- Quality helpers (`check:all`, `check:affected`, `fix:all`)

## Dev Port Environment Variables

OpenKit dev scripts use root-level port environment variables (with defaults):

- `OPENKIT_SERVER_PORT` (default `6969`) for the backend server
- `OPENKIT_WEB_APP_PORT` (default `5173`) for the web app Vite dev server

Run `pnpm run setup` to create `.env.local` from `.env.example` (without overwriting an existing file). Nx automatically loads `.env` files for task execution.

## npm Publishing (Paused)

npm publishing is currently paused.

- Code quality and smoke-test workflows run on pull requests targeting `master` (not on direct push to `master`).
- The code quality workflow runs format globally, and runs lint/typecheck via `nx affected` against PR base/head commits.
- The PR build workflow (`.github/workflows/build.yml`) determines affected build app projects via `nx show projects --affected --withTarget=build` against PR base/head commits, and runs per-app build jobs only for affected apps (with a global fallback for shared/config/workflow changes).
- The PR packaging workflow (`.github/workflows/pull-request-package.yml`) runs on PR comments with slash commands:
  - `/build` packages both macOS and Linux desktop artifacts.
  - `/build:mac` packages only macOS desktop artifacts.
  - `/build:linux` packages only Linux desktop artifacts.
    It reacts to the triggering comment, posts a status comment, and updates that same comment with final platform status and artifact download links.
- The release workflow still runs `pnpm check:all` and creates release tags plus the GitHub release.
- Desktop release assets are built/uploaded in `.github/workflows/package.yml` on release tag pushes (`v*`).
- npm-specific publish steps are commented out in `.github/workflows/release.yml`.

## Dependency Updates

Dependabot is configured in `.github/dependabot.yml` to open weekly dependency update PRs for:

- Root npm workspace (`/`)
- CLI app npm workspace (`/apps/cli`)
- Server app npm workspace (`/apps/server`)
- Web app npm workspace (`/apps/web-app`)
- Desktop app npm workspace (`/apps/desktop-app`)
- Website npm workspace (`/apps/website`)
- Mobile app npm workspace (`/apps/mobile-app`)
- GitHub Actions workflows (`github-actions`)

### What `pnpm build` Does

`pnpm build` runs:

```bash
pnpm nx run-many -t build
```

Build outputs are split by product role:

1. **Core runtime outputs:**
   - `cli:build` (tsup with `apps/cli/tsup.config.ts` -> `apps/cli/dist/*`)
   - `server:build` (tsup bundles standalone server runtime to `apps/server/dist/standalone.js` and copies `apps/server/src/runtime/port-hook.cjs` to `apps/server/dist/runtime/port-hook.cjs`)
   - `web-app:build` (Vite -> `apps/web-app/dist/*`)
   - `desktop-app:build` (tsgo + preload copy -> `apps/desktop-app/dist/*`)
2. **Standalone app outputs (app-owned):**
   - `website:build` -> `apps/website/dist/*`
   - `mobile-app:build` -> `apps/mobile-app/dist/{ios,android}/*`

## Dev Mode

```bash
pnpm dev
```

This runs:

```bash
pnpm nx run-many -t dev --parallel=6
```

For desktop-only development, use:

```bash
pnpm dev:desktop-app
```

`pnpm dev:desktop-app` runs:

```bash
pnpm nx run-many -t dev --projects web-app,cli,desktop-app --parallel=3
```

This ensures desktop dependencies are running before/alongside the shell. The desktop target itself still executes the app-local `apps/desktop-app` desktop script (two concurrent processes):

| Process               | What it does                                                                                                     |
| --------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `dev:desktop:compile` | TypeScript watcher for `apps/desktop-app/src/*.ts` -> `apps/desktop-app/dist/`                                   |
| `dev:desktop:run`     | Waits for the Vite server and compiled Electron main, then launches Electron via `electronmon` with auto-restart |

### How Changes Propagate

- **Frontend changes** (`apps/web-app/src/`): Vite HMR picks them up instantly. No restart needed.
- **Backend changes** (`apps/server/src/`, `apps/cli/src/`): `cli` uses tsup watch, while `server` uses `tsx watch`. Restart the running process when needed (or let `electronmon` handle it in Electron mode).
- **Electron changes** (`apps/desktop-app/src/`): TypeScript watcher recompiles, `electronmon` auto-restarts the Electron process.
- **port-hook.cjs**: copied by `server:build` into `apps/server/dist/runtime/`. This file is pure CommonJS with zero dependencies and is loaded via `--require` in spawned processes.

### Vite Dev Server

The Vite config (`apps/web-app/vite.config.ts`) sets the root to `apps/web-app/src`, outputs to `apps/web-app/dist`, and runs a dev server on `OPENKIT_WEB_APP_PORT` (default `5173`) with API proxy to `OPENKIT_SERVER_PORT` (default `6969`). In Electron dev mode, `UI_DEV_SERVER_URL=http://localhost:$OPENKIT_WEB_APP_PORT` tells Electron to load from Vite instead of built files.

## Project Structure

The canonical repository layout is documented in [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md).

In this guide, file references focus on contribution workflows (where to add routes, hooks, components, integrations, etc.) rather than repeating the full tree.

## Build System Details

### Backend Builds (CLI + Server)

Both `cli` and `server` use tsup for production build output:

- `apps/cli/tsup.config.ts`
  - **Entry points:** `apps/cli/src/index.ts` (CLI), `apps/cli/src/electron-entry.ts` (Electron bridge export)
  - **Format:** ESM (`"type": "module"` in package.json)
  - **Externals:** `node-pty` (native module) and `electron`
  - **esbuild loader:** `.md` files are inlined as text strings (used by `libs/instructions/src/`)
  - **Output:** `apps/cli/dist/`
- `apps/server/tsup.config.ts`
  - **Entry point:** `apps/server/src/standalone.ts`
  - **Format:** ESM
  - **Externals:** `node-pty` and `ws`
  - **esbuild loader:** `.md` files are inlined as text strings
  - **Output:** `apps/server/dist/standalone.js` (+ chunk files)

### Frontend (Vite + React)

Vite builds the React SPA. Config in `apps/web-app/vite.config.ts`:

- **Root:** `apps/web-app/src/`
- **Output:** `apps/web-app/dist/`
- **Base:** `./` (relative paths for file:// protocol compatibility in Electron)
- **Dev server:** Port `OPENKIT_WEB_APP_PORT` (default 5173) with API proxy to backend port `OPENKIT_SERVER_PORT` (default 6969)
- **Plugin:** `@vitejs/plugin-react` for JSX/Fast Refresh

### Electron

Electron has its own TypeScript config (`apps/desktop-app/tsconfig.json`) targeting ES2022 with NodeNext module resolution, outputting to `apps/desktop-app/dist/`. The preload script (`apps/desktop-app/src/preload.cjs`) is plain CommonJS and gets copied during build.

`electronmon` handles auto-restart during development. Its config (`apps/desktop-app/electronmon.config.cjs`) watches `./dist/**/*.js` and `../cli/dist/**/*.js`, while ignoring `../../apps/web-app/dist/` (which has its own HMR).

### Website (Astro)

The marketing site in `apps/website` uses Astro. `pnpm build:website` (or `nx run website:build`) outputs static assets to `apps/website/dist/`.

For Vercel deployments with `apps/website` as the project root, `apps/website/vercel.json` uses an `ignoreCommand` that skips builds when the current commit does not modify files in `apps/website/`.

### Mobile (Expo)

`pnpm build:mobile-app` (or `nx run mobile-app:build`) exports platform bundles to:

- `apps/mobile-app/dist/ios/`
- `apps/mobile-app/dist/android/`

### Tailwind CSS

The web app uses Tailwind v4 through CSS-first configuration in `apps/web-app/src/index.css` (`@import "tailwindcss"` and `@theme` tokens). PostCSS integration lives in `apps/web-app/postcss.config.js`.

### TypeScript

TypeScript uses a layered setup:

- Root `tsconfig.base.json` defines shared compiler defaults.
- Root `tsconfig.json` defines workspace-wide aliases and defaults.
- Each app owns `apps/<app>/tsconfig.json`, extending root config and adding app-local overrides (for example `apps/desktop-app` uses NodeNext emit settings, `apps/web-app` adds `vite/client` types).

- **Target/Module:** ES2022 / ESNext with Bundler resolution
- **Strict mode** enabled
- **JSX:** `react-jsx` (automatic runtime)
- **noEmit:** true (tsup and Vite handle compilation; `tsgo` is used for type checking)

## Architecture Patterns

### Route Registration

Backend routes follow a consistent pattern. Each route file exports a `register*Routes` function:

```typescript
// apps/server/src/routes/my-feature.ts
import type { Hono } from "hono";
import type { WorktreeManager } from "../manager";

export function registerMyFeatureRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/my-feature", (c) => {
    // ...
    return c.json({ data });
  });

  app.post("/api/my-feature", async (c) => {
    const body = await c.req.json();
    // ...
    return c.json({ success: true });
  });
}
```

Routes are registered in `apps/server/src/index.ts`:

```typescript
import { registerMyFeatureRoutes } from "./routes/my-feature";
// ...
registerMyFeatureRoutes(app, manager);
```

Some routes receive additional managers (e.g., `terminalManager`, `notesManager`, `hooksManager`) depending on their needs.

### API Layer (Frontend)

The frontend API layer has two parts:

1. **`apps/web-app/src/hooks/api.ts`** -- Raw fetch functions that accept an optional `serverUrl` parameter. When `null`, they use relative URLs (single-project web mode). When provided, they use full URLs (multi-project Electron mode).

2. **`apps/web-app/src/hooks/useApi.ts`** -- A hook that returns all API functions pre-bound to the current `serverUrl` from `ServerContext`. Components call `useApi()` and use the returned functions directly.

```typescript
// In a component:
const api = useApi();
await api.createWorktree("feature/my-branch");
```

### React Query Hooks

Data-fetching hooks follow React Query patterns:

```typescript
// apps/web-app/src/hooks/useMyFeature.ts
import { useQuery } from "@tanstack/react-query";
import { fetchMyData } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

export function useMyFeature() {
  const serverUrl = useServerUrlOptional();

  return useQuery({
    queryKey: ["my-feature", serverUrl],
    queryFn: () => fetchMyData(serverUrl),
    enabled: serverUrl !== null,
    staleTime: 30_000,
  });
}
```

### SSE for Real-Time Updates

State is pushed from the server via Server-Sent Events. The `useWorktrees` hook connects to `/api/events` and handles `worktrees` (worktree state updates), `notification` (direct user-action success/failure messages displayed as toasts), `hook-update` (triggers auto-refetch of hook results in the HooksTab), plus `activity` / `activity-history` (workflow and agent updates routed to the Activity feed). This is how the UI reflects process start/stop, log output, status changes, and agent-reported hook results without polling.

### Theme System

All colors and Tailwind utility classes are centralized in `apps/web-app/src/theme.ts`. This file exports named objects (`palette`, `surface`, `border`, `text`, `status`, `action`, `button`, etc.) containing Tailwind class fragments.

```typescript
import { surface, text, border } from '../theme';

// In JSX:
<div className={`${surface.panel} ${border.subtle} border rounded`}>
  <span className={text.primary}>Hello</span>
</div>
```

Never hardcode Tailwind color classes directly in components. Always import from `theme.ts`.

### Selection Union

The main `App.tsx` manages selection state with a discriminated union:

```typescript
type Selection =
  | { type: "worktree"; id: string }
  | { type: "issue"; key: string }
  | { type: "linear-issue"; identifier: string }
  | { type: "custom-task"; id: string }
  | null;
```

When adding a new selectable entity type, update: the Selection type, CreateForm tab visibility, IssueList props, and the detail panel conditional rendering in App.tsx.

## Adding New Features

### Adding a New Route

1. Create `apps/server/src/routes/my-feature.ts`.
2. Export a `registerMyFeatureRoutes(app, manager)` function with Hono route handlers.
3. Import and call it in `apps/server/src/index.ts` alongside the other route registrations.

### Adding a New UI Component

1. Create the component in `apps/web-app/src/components/` (or `apps/web-app/src/components/detail/` for right-panel views).
2. Import all colors from `apps/web-app/src/theme.ts`. Never hardcode Tailwind color classes.
3. Use the `Tooltip` component (`apps/web-app/src/components/Tooltip.tsx`) instead of the native `title` attribute.
4. Use the `Modal` component for dialogs (supports `width: 'sm' | 'md' | 'lg'`).
5. Use icon components from `apps/web-app/src/icons/index.tsx` for app/custom icons. Use `lucide-react` for generic utility icons when a custom asset component is not needed.
6. When adding a new app/custom SVG icon, place the file in `apps/web-app/src/icons/`, import it in `apps/web-app/src/icons/index.tsx` as `*.svg?raw`, and expose exactly one icon component for it. Do not import raw assets in feature components.

### Adding a New Hook

1. Create the hook in `apps/web-app/src/hooks/`.
2. For data fetching, follow the React Query pattern with `useQuery`, `queryKey`, `enabled`, and `staleTime`.
3. Add raw API functions to `apps/web-app/src/hooks/api.ts` (with the `serverUrl` parameter).
4. Add bound versions to `apps/web-app/src/hooks/useApi.ts` if they are imperative actions (mutations).

### Adding a New Integration

1. Create a directory in `libs/integrations/src/my-service/`.
2. Implement the API client, credential storage, and type definitions.
3. Add server routes in `apps/server/src/routes/my-service.ts`.
4. Add UI components for configuration (typically in `IntegrationsPanel.tsx`).
5. Add status checking to the `/api/integrations/verify` endpoint in `apps/server/src/index.ts`.
6. Add sidebar list and detail panel components if the integration surfaces items.

### Adding a Sidebar Entity (Issues, Tasks, etc.)

This follows an established pattern. You will need:

1. **Backend route** in `apps/server/src/routes/` for CRUD operations.
2. **Types** for summary and detail views.
3. **API functions** in `apps/web-app/src/hooks/api.ts`.
4. **Hooks** -- a list hook (`useMyItems.ts`) and a detail hook (`useMyItemDetail.ts`).
5. **Sidebar components** -- `MyItemList.tsx` and `MyItemItem.tsx` (follow existing patterns like `JiraIssueItem.tsx` or `LinearIssueItem.tsx`).
6. **Detail panel** -- `apps/web-app/src/components/detail/MyItemDetailPanel.tsx`.
7. **Selection type** -- add to the `Selection` union in `App.tsx`.
8. **Theme colors** -- add a section in `theme.ts` for the entity accent color.

## Code Organization

- **Extract into separate components and modules when it makes sense.** Don't let files grow into monoliths. When a function, hook, or UI section becomes complex enough to reason about independently, pull it into its own file.
- **Strive for clean, maintainable architecture.** Code should be easy to navigate and understand, especially at the structural level (files and folders). A new contributor should be able to find things by name and location without needing a tour.
- **Keep files focused.** Each file should have a clear, single responsibility. If a component file contains multiple large sub-components, helper functions, or unrelated logic, split them out.
- **Follow existing patterns.** The codebase has established conventions for routes, hooks, sidebar items, detail panels, etc. When adding something new, look at how similar things are already done and follow that structure.

## Important Conventions

- **No backwards compatibility needed.** There are no external users. Data gets deleted and recreated from scratch. Do not add migration code, backfill logic, or compatibility shims.
- **Never use native `title` attribute for tooltips.** Always use the `Tooltip` component.
- **All colors in `theme.ts`.** Components import Tailwind class fragments from there. No hardcoded color classes.
- **ESM throughout.** The project uses `"type": "module"`. The only CommonJS file is `apps/server/src/runtime/port-hook.cjs`, which must remain CJS because it is loaded via Node's `--require` flag.
- **Hono for HTTP.** The backend uses Hono with `@hono/node-server`, not Express.
- **React 18 + React Query.** State management is via React Query for server state and `useState`/`useContext` for UI state. No Redux or Zustand.
- **Motion (Framer Motion v12+).** Animations use the `motion/react` import path.
- **Keep agent instructions in sync with MCP changes.** When modifying MCP tools, workflows, or hooks behavior, update the relevant `.md` files in `libs/instructions/src/` (MCP instructions, agent skills/rules, hook skill definitions). All instruction text is centralized there — consumer files import from the barrel at `libs/instructions/src/index.ts`. Also update the inline instructions block in `docs/MCP.md`.

## Platform Constraints

- **Unix/macOS only.** Port discovery depends on `lsof`, process detection uses `pgrep`.
- **Node.js processes only** for port hooking. The `--require port-hook.cjs` mechanism does not work with non-Node runtimes (Python, Go, etc.).
- **GitHub integration** requires the `gh` CLI installed and authenticated.
- **Jira integration** requires OAuth setup via the Integrations panel in the UI.
- **Linear integration** requires an API key configured via the Integrations panel.

## Key Dependencies

| Package                     | Purpose                                       |
| --------------------------- | --------------------------------------------- |
| `hono`                      | HTTP server framework                         |
| `@hono/node-server`         | Node.js adapter for Hono                      |
| `@hono/node-ws`             | WebSocket support for Hono                    |
| `@tanstack/react-query`     | Server state management                       |
| `@modelcontextprotocol/sdk` | MCP server/client for agent integration       |
| `@monaco-editor/react`      | Code editor (used in configuration)           |
| `@xterm/xterm`              | Terminal emulator in the browser              |
| `node-pty`                  | Native PTY for terminal sessions              |
| `motion`                    | Animation library (Framer Motion)             |
| `lucide-react`              | Icon library                                  |
| `react-markdown`            | Markdown rendering (Jira descriptions, notes) |
| `zod`                       | Schema validation                             |
| `picocolors`                | CLI colored output                            |
| `@inquirer/prompts`         | Interactive CLI prompts (init wizard)         |

## CLI Subcommands

For reference, these are the CLI entry points (all in `apps/cli/src/`):

| Command               | Description                                               |
| --------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| `OpenKit`             | Start the server and open UI (Electron or browser)        |
| `openkit init`        | Interactive setup wizard to create `.openkit/config.json` |
| `openkit connect`     | Connect to an existing running OpenKit server             |
| `openkit mcp`         | Start as an MCP server (for Claude Code integration)      |
| `openkit task [source | resolve] [ID...]`                                         | Resolve issues and create worktrees (jira, linear, local) |

## Configuration

The project config lives at `.openkit/config.json` in the project root. Key fields:

- `projectDir` -- absolute path to the project root
- `startCommand` -- command to start the dev server (e.g., `pnpm dev`)
- `installCommand` -- command to install dependencies (e.g., `pnpm install`)
- `baseBranch` -- default base branch (e.g., `main`)
- `serverPort` -- OpenKit server port (default 6969)
- `ports` -- array of discovered ports with `offsetStep`
- `envMapping` -- environment variable mappings for port offsetting
- Integration settings for Jira, GitHub, and Linear

Worktrees are stored in `.openkit/worktrees/`. The server writes `server.json` to `.openkit/` for agent discovery (contains URL and PID of the running server).
