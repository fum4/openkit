# Project Structure

This document is the canonical map of the repository layout.

Use this together with:

- `docs/ARCHITECTURE.md` for system design and runtime data flow
- `docs/DEVELOPMENT.md` for build workflow, conventions, and contribution patterns

## Layering Principle

The server app (`apps/server`) is an **orchestration layer only** — it wires together HTTP routes, composes library functions, and manages process lifecycle. It must not contain business logic, git operations, or third-party integration code directly.

- **`libs/shared`** — All business logic, system operations, pure git primitives, types, and helpers. This is the foundation that every other package can depend on.
- **`libs/integrations`** — All third-party provider integrations (GitHub, Jira, Linear). Depends on `libs/shared` for types and utilities, never the other way around.
- **`apps/server`** — Thin HTTP route handlers that import from `libs/shared` and `libs/integrations`, validate inputs, and return responses. No inline `execFile`, no embedded business logic.

## Top-Level

```text
OpenKit/
├── apps/                Deployable applications
├── libs/                Shared libraries
├── packages/            Shared configuration packages
├── docs/                Documentation
│   └── assets/          Shared documentation/readme assets
├── dist/                Core runtime build output (generated)
├── nx.json              Nx workspace/task graph config
├── pnpm-workspace.yaml  pnpm workspace package map
├── vercel.json          Root Vercel build/install/output config
├── package.json
├── tsconfig.workspace.json
└── ...
```

## `apps/`

```text
apps/
├── cli/                 CLI app (`cli`)
│   ├── package.json
│   ├── project.json
│   ├── tsup.config.ts
│   └── src/
│       ├── index.ts     Main CLI router (`openkit`, `init`, `mcp`, `task`, etc.)
│       ├── electron-entry.ts
│       ├── init.ts
│       ├── add.ts
│       └── task.ts
│
├── server/              Hono backend app — orchestration layer only (`server`)
│   ├── package.json
│   ├── project.json
│   └── src/
│       ├── index.ts
│       ├── manager.ts           Worktree lifecycle orchestrator
│       ├── terminal-manager.ts
│       ├── notes-manager.ts
│       ├── verification-manager.ts
│       └── routes/              Thin HTTP handlers (compose libs/shared + libs/integrations)
│
├── web-app/             React SPA (`web-app`)
│   ├── package.json
│   ├── project.json
│   ├── vite.config.ts
│   ├── postcss.config.js
│   └── src/
│       ├── App.tsx
│       ├── theme.ts
│       ├── components/
│       ├── hooks/
│       ├── contexts/
│       └── icons/
│
├── desktop-app/         Electron desktop shell (`desktop-app`)
│   ├── package.json
│   ├── project.json
│   ├── electron-builder.yml
│   ├── electron-builder-notarize.cjs
│   ├── electronmon.config.cjs
│   ├── assets/
│   ├── release/         Packaged desktop artifacts (generated)
│   └── src/
│       ├── main.ts
│       ├── preload.cjs
│       ├── project-manager.ts
│       └── server-spawner.ts
│
├── website/             Astro marketing site (`website`)
│   ├── project.json
│   ├── package.json
│   ├── vercel.json      Website-scoped Vercel build/install/output config
│   ├── dist/            Static website output (generated)
│   └── src/
│
└── mobile-app/          Expo mobile app (`mobile-app`)
    ├── project.json
    ├── package.json
    ├── dist/            Exported platform bundles (generated)
    └── app/
```

## `packages/`

```text
packages/                Reserved for future reusable workspace packages
```

## `libs/`

```text
libs/
├── agents/              MCP action/transport library + bundled instructions
│   ├── project.json
│   └── src/
│
├── integrations/        Third-party provider integrations (GitHub, Jira, Linear)
│   ├── project.json
│   └── src/
│       ├── github/      GitHub CLI operations (auth, PRs, repo), manager (polling/caching), PR diff
│       ├── jira/        Jira API client
│       └── linear/      Linear API client
│
├── logger/              Go-based structured logging (C-shared lib + FFI adapters)
│   ├── project.json
│   ├── go/              Go core — compiles to liblogger.dylib/.so
│   ├── ts/              TypeScript adapter (koffi FFI)
│   ├── py/              Python adapter (ctypes)
│   └── zig/             Zig adapter (dlopen)
│
├── port-offset/            Port offsetting package (`@openkit/port-offset`)
│   ├── package.json
│   ├── project.json
│   ├── src/
│   │   ├── port-manager.ts
│   │   └── adapters/       Framework detection (registry.ts, react-native.ts, expo.ts, generic.ts)
│   └── hooks/
│       ├── node/           Node.js --require hook (port-hook.cjs)
│       └── libc/           Zig native port hook (DYLD_INSERT_LIBRARIES)
│
└── shared/              Core business logic, types, git operations, env/config helpers
    ├── project.json
    └── src/
        ├── git.ts       All pure git operations (stage, unstage, revert, diff, commit, push, status)
        ├── worktree-types.ts  Shared types (WorktreeInfo, DiffFileInfo, GitStatusInfo, etc.)
        └── ...
```

## Package Boundaries

- `package.json` at the repo root is the workspace orchestration package (marked `private` while npm publishing is paused).
- App-level `package.json` files exist for `apps/cli`, `apps/server`, `apps/web-app`, and `apps/desktop-app` so each app is directly runnable from its own directory.
- `libs/shared/package.json` provides direct dependencies for shared runtime helpers.
- `apps/website/package.json` is isolated for Astro website tooling.
- `apps/mobile-app/package.json` is isolated for Expo/React Native tooling.
- Shared runtime code in `libs/*` uses Nx `project.json` and TypeScript path aliases.
- Shared build/typecheck configuration is centralized in root `tsconfig.base.json` + `tsconfig.workspace.json`.
- `pnpm-workspace.yaml` uses broad globs (`apps/*`, `libs/*`, `packages/*`) so future package-based subprojects can be added without changing workspace config.

## Generated Artifacts

- `apps/cli/dist/` is generated by the CLI build
- `apps/desktop-app/dist/` is generated by the desktop app TypeScript build
- `apps/server/dist/runtime/` is generated by the server runtime-hook copy step
- `apps/web-app/dist/` is generated by the web app build
- `apps/website/dist/` is generated by the website build
- `apps/mobile-app/dist/` is generated by mobile export builds
- `apps/desktop-app/release/` is generated by desktop packaging

Do not hand-edit generated files.
