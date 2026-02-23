# Development Guide

This document covers everything you need to develop, build, and extend OpenKit.

## Prerequisites

- **Node.js** >= 18
- **pnpm** (package manager)
- **macOS or Linux** (Unix-only -- depends on `lsof` and `pgrep`)
- **Optional:** `gh` CLI for GitHub integration (PR creation, status checks)
- **Optional:** Electron for desktop app development (`electron` and `electron-builder` are dev dependencies)

## Getting Started

```bash
git clone <repo-url>
cd worktree-manager
pnpm install
pnpm build
pnpm start
```

`pnpm start` launches the server and opens the UI -- in the Electron app if available, otherwise in the default browser. The server runs on port **6969** by default and automatically finds the next available port if that one is in use.

## Build Commands

| Command               | Description                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm build`          | Full production build (tsup backend + Electron compile + copy port-hook.cjs + Vite frontend) |
| `pnpm dev`            | Dev mode with concurrent watchers for UI, backend, and Electron                              |
| `pnpm start`          | Run the built CLI (`node dist/cli/index.js`)                                                 |
| `pnpm check:types`    | TypeScript type checking (`tsc --noEmit`)                                                    |
| `pnpm check:format`   | Run oxfmt in check mode                                                                      |
| `pnpm check:lint`     | Run oxlint                                                                                   |
| `pnpm check:all`      | Run typecheck + format check + lint                                                          |
| `pnpm fix:format`     | Run oxfmt to apply formatting                                                                |
| `pnpm fix:lint`       | Run oxlint with `--fix`                                                                      |
| `pnpm fix:all`        | Run format + lint auto-fixes                                                                 |
| `pnpm verify:package` | Verify npm package metadata and required build artifacts                                     |
| `pnpm smoke:tarball`  | Pack and unpack the local tarball, then smoke-test the packaged CLI entrypoint               |
| `pnpm release:verify` | Full release gate: typecheck, lint, build, package verification, tarball smoke test          |
| `pnpm build:app`      | Full build + package as macOS Electron app via `electron-builder`                            |

There is no test runner configured.

## npm Publishing

OpenKit is published on npm as `openkit`.

- `prepack` runs `pnpm build && pnpm verify:package`, so local and CI publishes fail fast if required artifacts are missing.
- GitHub Actions release workflow runs `pnpm release:verify` before creating a release.
- After `release-it` bumps/tags, the workflow publishes to npm via `npm publish --access public --provenance` using `NPM_TOKEN`.
- Installed command aliases are `openkit`, `ok`, and `OpenKit`.

### What `pnpm build` Does

The build script chains several steps:

1. **tsup** bundles `src/cli/index.ts` and `src/electron-entry.ts` into ESM (`dist/`) with `.d.ts` declarations. Config in `tsup.config.ts` externalizes `node-pty` and `electron`, and enables the `.md` text loader for inlining instruction files.
2. **tsc** compiles the Electron main process (`electron/tsconfig.json` -> `dist/electron/`).
3. **cp** copies `electron/preload.cjs` to `dist/electron/preload.cjs`.
4. **cp** copies `src/runtime/port-hook.cjs` to `dist/runtime/port-hook.cjs` (this file must remain CommonJS with zero dependencies).
5. **Vite** builds the React SPA from `src/ui/` into `dist/ui/`.

## Dev Mode

```bash
pnpm dev
```

This runs four concurrent processes via `concurrently`:

| Process                | What it does                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `dev:ui`               | Vite dev server on `http://localhost:6969` with HMR                                                                   |
| `dev:backend`          | tsup in watch mode, rebuilding `src/cli/index.ts` and `src/electron-entry.ts` on changes                              |
| `dev:electron:compile` | TypeScript watcher for `electron/*.ts` -> `dist/electron/`                                                            |
| `dev:electron:run`     | Waits for both the Vite server and compiled Electron main, then launches Electron via `electronmon` with auto-restart |

### How Changes Propagate

- **Frontend changes** (`src/ui/`): Vite HMR picks them up instantly. No restart needed.
- **Backend changes** (`src/server/`, `src/cli/`): tsup rebuilds; restart the CLI manually to pick up changes (or let `electronmon` handle it in Electron mode).
- **Electron changes** (`electron/`): TypeScript watcher recompiles, `electronmon` auto-restarts the Electron process.
- **port-hook.cjs**: Must be manually copied to `dist/runtime/` (or run a full `pnpm build`). This file is pure CommonJS with zero dependencies and is loaded via `--require` in spawned processes.

### Vite Dev Server

The Vite config (`vite.config.ts`) sets the root to `src/ui/`, outputs to `dist/ui/`, and runs a dev server on port 6969 with API proxy to the backend. In Electron dev mode, the environment variable `UI_DEV_SERVER_URL=http://localhost:6969` tells Electron to load from Vite instead of the built files.

## Project Structure

The canonical repository layout is documented in [PROJECT_STRUCTURE.md](./PROJECT_STRUCTURE.md).

In this guide, file references focus on contribution workflows (where to add routes, hooks, components, integrations, etc.) rather than repeating the full tree.

## Build System Details

### Backend (tsup)

tsup bundles the backend as ESM. Configuration lives in `tsup.config.ts` at the project root:

- **Entry points:** `src/cli/index.ts` (CLI), `src/electron-entry.ts` (Electron)
- **Format:** ESM (`"type": "module"` in package.json)
- **Externals:** `node-pty` (native module) and `electron`
- **esbuild loader:** `.md` files are inlined as text strings (used by `src/instructions/`)
- **Output:** `dist/` (tsup flattens the directory structure)

CLI flags `--dts --clean` are passed in the `build` script only (not needed in dev watch mode).

### Frontend (Vite + React)

Vite builds the React SPA. Config in `vite.config.ts`:

- **Root:** `src/ui/`
- **Output:** `dist/ui/`
- **Base:** `./` (relative paths for file:// protocol compatibility in Electron)
- **Dev server:** Port 6969 with API proxy to the backend
- **Plugin:** `@vitejs/plugin-react` for JSX/Fast Refresh

### Electron

Electron has its own TypeScript config (`electron/tsconfig.json`) targeting ES2022 with NodeNext module resolution, outputting to `dist/electron/`. The preload script (`electron/preload.cjs`) is plain CommonJS and gets copied during build.

`electronmon` handles auto-restart during development. Its config (`electronmon.config.cjs`) watches `dist/electron/**/*.js` and `dist/*.js` while ignoring `dist/ui/` (which has its own HMR).

### Tailwind CSS

Tailwind 3.x with custom theme extensions in `tailwind.config.js`:

- **Content paths:** `src/ui/**/*.{ts,tsx,html}`
- **Custom colors:** `surface` (page, panel, raised, input) and `accent` (teal palette)
- **PostCSS:** autoprefixer via `postcss.config.js`

### TypeScript

Single `tsconfig.json` for the main codebase:

- **Target/Module:** ES2022 / ESNext with Bundler resolution
- **Strict mode** enabled
- **JSX:** `react-jsx` (automatic runtime)
- **noEmit:** true (tsup and Vite handle compilation; tsc is for type checking only)

## Architecture Patterns

### Route Registration

Backend routes follow a consistent pattern. Each route file exports a `register*Routes` function:

```typescript
// src/server/routes/my-feature.ts
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

Routes are registered in `src/server/index.ts`:

```typescript
import { registerMyFeatureRoutes } from "./routes/my-feature";
// ...
registerMyFeatureRoutes(app, manager);
```

Some routes receive additional managers (e.g., `terminalManager`, `notesManager`, `hooksManager`) depending on their needs.

### API Layer (Frontend)

The frontend API layer has two parts:

1. **`src/ui/hooks/api.ts`** -- Raw fetch functions that accept an optional `serverUrl` parameter. When `null`, they use relative URLs (single-project web mode). When provided, they use full URLs (multi-project Electron mode).

2. **`src/ui/hooks/useApi.ts`** -- A hook that returns all API functions pre-bound to the current `serverUrl` from `ServerContext`. Components call `useApi()` and use the returned functions directly.

```typescript
// In a component:
const api = useApi();
await api.createWorktree("feature/my-branch");
```

### React Query Hooks

Data-fetching hooks follow React Query patterns:

```typescript
// src/ui/hooks/useMyFeature.ts
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

All colors and Tailwind utility classes are centralized in `src/ui/theme.ts`. This file exports named objects (`palette`, `surface`, `border`, `text`, `status`, `action`, `button`, etc.) containing Tailwind class fragments.

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

1. Create `src/server/routes/my-feature.ts`.
2. Export a `registerMyFeatureRoutes(app, manager)` function with Hono route handlers.
3. Import and call it in `src/server/index.ts` alongside the other route registrations.

### Adding a New UI Component

1. Create the component in `src/ui/components/` (or `src/ui/components/detail/` for right-panel views).
2. Import all colors from `src/ui/theme.ts`. Never hardcode Tailwind color classes.
3. Use the `Tooltip` component (`src/ui/components/Tooltip.tsx`) instead of the native `title` attribute.
4. Use the `Modal` component for dialogs (supports `width: 'sm' | 'md' | 'lg'`).
5. Use icon components from `src/ui/icons/index.tsx` for app/custom icons. Use `lucide-react` for generic utility icons when a custom asset component is not needed.
6. When adding a new app/custom SVG icon, place the file in `src/ui/icons/`, import it in `src/ui/icons/index.tsx` as `*.svg?raw`, and expose exactly one icon component for it. Do not import raw assets in feature components.

### Adding a New Hook

1. Create the hook in `src/ui/hooks/`.
2. For data fetching, follow the React Query pattern with `useQuery`, `queryKey`, `enabled`, and `staleTime`.
3. Add raw API functions to `src/ui/hooks/api.ts` (with the `serverUrl` parameter).
4. Add bound versions to `src/ui/hooks/useApi.ts` if they are imperative actions (mutations).

### Adding a New Integration

1. Create a directory in `src/integrations/my-service/`.
2. Implement the API client, credential storage, and type definitions.
3. Add server routes in `src/server/routes/my-service.ts`.
4. Add UI components for configuration (typically in `IntegrationsPanel.tsx`).
5. Add status checking to the `/api/integrations/verify` endpoint in `src/server/index.ts`.
6. Add sidebar list and detail panel components if the integration surfaces items.

### Adding a Sidebar Entity (Issues, Tasks, etc.)

This follows an established pattern. You will need:

1. **Backend route** in `src/server/routes/` for CRUD operations.
2. **Types** for summary and detail views.
3. **API functions** in `src/ui/hooks/api.ts`.
4. **Hooks** -- a list hook (`useMyItems.ts`) and a detail hook (`useMyItemDetail.ts`).
5. **Sidebar components** -- `MyItemList.tsx` and `MyItemItem.tsx` (follow existing patterns like `JiraIssueItem.tsx` or `LinearIssueItem.tsx`).
6. **Detail panel** -- `src/ui/components/detail/MyItemDetailPanel.tsx`.
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
- **ESM throughout.** The project uses `"type": "module"`. The only CommonJS file is `src/runtime/port-hook.cjs`, which must remain CJS because it is loaded via Node's `--require` flag.
- **Hono for HTTP.** The backend uses Hono with `@hono/node-server`, not Express.
- **React 18 + React Query.** State management is via React Query for server state and `useState`/`useContext` for UI state. No Redux or Zustand.
- **Motion (Framer Motion v12+).** Animations use the `motion/react` import path.
- **Keep agent instructions in sync with MCP changes.** When modifying MCP tools, workflows, or hooks behavior, update the relevant `.md` files in `src/instructions/` (MCP instructions, agent skills/rules, hook skill definitions). All instruction text is centralized there — consumer files import from the barrel at `src/instructions/index.ts`. Also update the inline instructions block in `docs/MCP.md`.

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

For reference, these are the CLI entry points (all in `src/cli/`):

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
