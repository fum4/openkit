# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

OpenKit is a CLI tool + web UI (with optional Electron app) for managing multiple git worktrees with automatic port offsetting and Jira/Linear/GitHub integrations.

## MCP Status (Legacy)

MCP is legacy in this repository.

- Do not use MCP for new work.
- Do not develop new MCP features.
- Do not refactor MCP code unless explicitly requested for a targeted legacy fix.
- Prefer CLI and core app flows for all new capabilities.

## Naming and File Hygiene

- Choose clear, specific names for files and folders.
- When changing behavior or purpose, evaluate whether the file/folder name is still accurate.
- If the current name no longer fits, rename it as part of the change.
- Be careful when editing file/folder content to keep structure and naming aligned.

## Mirror File Requirement

- `CLAUDE.md` and `AGENTS.md` must stay in sync.
- Any change made to one must be applied to the other in the same update.

## CLI-First Agent Design

**Design new deterministic capabilities in the CLI first, so agents can automate workflows without UI coupling.**

- Prefer adding explicit CLI commands/flags over hidden behavior in prompts or UI-only flows.
- If a workflow has deterministic decisions (resolution, validation, initialization), expose them as CLI commands.
- Keep command output machine-readable where useful (for example JSON modes).
- Agent instructions should primarily orchestrate the CLI, not duplicate business logic.

## Quick Reference

**Package manager**: pnpm

```bash
pnpm build         # Full build (tsup backend + vite frontend)
pnpm dev           # Dev mode (concurrent watchers)
pnpm check:types   # TypeScript type check
pnpm check:lint    # Lint
```

There is no test runner configured.

## Code Quality

**Fix any lint or format errors you encounter — whether introduced by current changes or pre-existing in the codebase.** Don't leave broken windows.

## UI Theme Consistency

- Always use the standard shared color palette and tokens from `src/ui/theme.ts`.
- Do not introduce ad-hoc lighter/darker color variants for existing control patterns.
- For switches/toggles, reuse the app-standard treatment (`bg-accent` when enabled, neutral off-state styling when disabled).

## Icon Handling

- Store frontend icon assets in `src/ui/icons/` as `.svg`/`.png`.
- Define and export one icon component per asset from `src/ui/icons/index.tsx` (for example `GitHubIcon`, `JiraIcon`).
- For SVG assets, import with `*.svg?raw` and render through the shared SVG wrapper in `src/ui/icons/index.tsx` to keep sizing/bounds consistent.
- PNG assets are allowed when needed (for example `finder.png`), but still must be wrapped by an exported icon component in `src/ui/icons/index.tsx`.
- In UI code, import icon components from `src/ui/icons/index.tsx` (for example `import { GitHubIcon } from "../icons"`), not raw asset files.
- Do not import `.svg`/`.png` directly from feature components; only `src/ui/icons/index.tsx` should import raw icon assets.

## Dependencies

**Always use `pnpm add` (or `pnpm add -D`) to install packages — never edit `package.json` dependencies manually.** Use the latest version unless a specific version is required.

## Documentation

Comprehensive documentation lives in `/docs/`. **Always check the relevant docs before working on unfamiliar areas** — they contain architectural context, component patterns, and API details that will help you make correct changes.

**CRITICAL: Keep ALL docs in sync at ALL TIMES.** After every change, check if any docs in `/docs/` or `README.md` need updating and update them immediately — this is not optional. Docs that fall out of sync are actively harmful. Specifically:

- When adding/changing API endpoints → update `docs/API.md`
- When adding/changing components, hooks, or theme tokens → update `docs/FRONTEND.md`
- When adding/changing MCP tools or instructions → update `docs/MCP.md`
- When changing architecture, adding new modules/files → update `docs/ARCHITECTURE.md`
- When adding/changing config fields → update `docs/CONFIGURATION.md`
- When changing Electron behavior → update `docs/ELECTRON.md`
- When adding/changing notifications or activity events → update `docs/NOTIFICATIONS.md`
- When adding/changing user-facing features → update `README.md`
- When adding a new system or concept → create a new doc file in `/docs/` and add it to the table below and in `README.md`

| Document                               | Covers                                                     | When to Read                    |
| -------------------------------------- | ---------------------------------------------------------- | ------------------------------- |
| [Architecture](docs/ARCHITECTURE.md)   | System layers, components, data flow, build system         | Understanding project structure |
| [Development](docs/DEVELOPMENT.md)     | Build system, dev workflow, code organization, conventions | Before writing code             |
| [Frontend](docs/FRONTEND.md)           | UI architecture, views, theme, components                  | UI changes                      |
| [API Reference](docs/API.md)           | REST API endpoints                                         | New or modified endpoints       |
| [CLI Reference](docs/CLI.md)           | All CLI commands and options                               | CLI changes                     |
| [Configuration](docs/CONFIGURATION.md) | Config files, settings, data storage                       | Config changes                  |
| [MCP Tools](docs/MCP.md)               | MCP integration and tool reference                         | MCP/agent tool changes          |
| [Agents](docs/AGENTS.md)               | Agent tooling, skills, plugins, git policy                 | Agent system changes            |
| [Integrations](docs/INTEGRATIONS.md)   | Jira, Linear, GitHub setup                                 | Integration changes             |
| [Port Mapping](docs/PORT-MAPPING.md)   | Port discovery, offset algorithm, runtime hook             | Port system changes             |
| [Hooks](docs/HOOKS.md)                 | Hooks system (trigger types, commands, skills)             | Hooks changes                   |
| [Electron](docs/ELECTRON.md)           | Desktop app, deep linking, multi-project                   | Electron changes                |
| [Notifications](docs/NOTIFICATIONS.md) | Activity feed, toasts, OS notifications, event types       | Notification/activity changes   |
| [Setup Flow](docs/SETUP-FLOW.md)       | Project setup wizard, steps, state machine, integrations   | Setup/onboarding changes        |
