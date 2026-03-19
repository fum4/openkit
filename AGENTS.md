# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mirror File Requirement

- `CLAUDE.md` and `AGENTS.md` must stay in sync.
- Any change made to one must be applied to the other in the same update.

## Naming and File Hygiene

- Choose clear, specific names for files and folders.
- When changing behavior or purpose, evaluate whether the file/folder name is still accurate.
- If the current name no longer fits, rename it as part of the change.
- Be careful when editing file/folder content to keep structure and naming aligned.

## README Requirement

Every app (`apps/*`) and library (`libs/*`) must have a `README.md` at its root. The README should briefly describe the package's purpose, key technologies, and basic usage. When creating a new app or library, include a README as part of the initial setup. **Keep READMEs updated** — when adding, removing, or changing modules/exports in a package, update its README to reflect the current state. A stale README is worse than no README.

## CLI-First Agent Design

**Design new deterministic capabilities in the CLI first, so agents can automate workflows without UI coupling.**

- Prefer adding explicit CLI commands/flags over hidden behavior in prompts or UI-only flows.
- If a workflow has deterministic decisions (resolution, validation, initialization), expose them as CLI commands.
- Keep command output machine-readable where useful (for example JSON modes).
- Agent instructions should primarily orchestrate the CLI, not duplicate business logic.

## Quick Reference

**Package manager**: pnpm

**Test runner**: Vitest. Run `pnpm test` for all, `pnpm nx run <project>:test` for one project.

## Testing

**Tests are the most important aspect of this codebase.** They are the safety net for refactoring, bug prevention, and CI/CD readiness. Every code change — feature, bugfix, or refactor — must include corresponding tests. Writing tests is not optional or secondary; it is the primary deliverable alongside working code.

- When writing or modifying tests, **always use the testing skill** (`.claude/skills/testing/`) if available. It contains the canonical patterns, query priorities, and conventions for this project.
- **Do not modify existing tests lightly.** If a test fails, first verify whether the test caught a real bug before changing it. Changing a test to make it pass defeats the purpose — investigate first.
- Put real effort into test quality. Tests should be thorough, covering edge cases, error paths, and boundary conditions — not just the happy path.
- **Place test files in `__test__/` directories**, not co-located with source files. Each directory level that contains testable code should have its own `__test__/` subdirectory (e.g., `src/__test__/`, `src/adapters/__test__/`). Test files keep the `.test.ts`/`.test.tsx` suffix.
- Write tests carefully — one behavior per `it()`, Arrange-Act-Assert structure, behavior-spec naming.
- Mock at the boundary (fs, child_process, HTTP), not internal helpers.
- Component tests use React Testing Library: query by role/label/text, use `userEvent`, never test implementation details.
- **Every codebase change must have test coverage.** When creating or modifying code, always create or update the corresponding unit tests. No exceptions.

## Code Quality

**Fix any lint or format errors you encounter — whether introduced by current changes or pre-existing in the codebase.** Don't leave broken windows.

- Never use Prettier in this repository.
- Use `oxlint` for linting and `oxfmt` for formatting.
- **Always use scripts from `package.json` for checks** (e.g. `pnpm check:*`, `pnpm fix:*`). Do not invoke tools directly via `npx` or bare binary names — use `pnpm <script>` to ensure the correct versions and configuration are used.
- **Every source file must have a JSDoc comment at the top** explaining what the file is for. Keep it to 1-3 sentences — enough for a developer to understand the file's purpose without reading the code. When changing a file's responsibility, update the JSDoc to match.

## Error Handling

**Treat error handling as a first-class concern in every code change.** Every feature, bugfix, or refactor must account for every failure path — no exceptions, no shortcuts.

- Every `catch` block, every fallback branch, every error callback must do something meaningful: log through the appropriate logger (`log.error()` / `log.warn()`), surface to the user via toast, or both. Silent `catch {}` blocks are never acceptable.
- Always surface user-facing errors through toast notifications (`showPersistentErrorToast` / `reportPersistentErrorToast`).
- Do not introduce inline error text for operational failures when a toast can communicate the failure.
- Errors that surface as toasts must **also** be logged through the logger — toasts are for users, logs are for debugging. Both are required.
- When writing `try/catch`, `Promise.catch`, error callbacks, or conditional error branches, always ask: "If this fails in production, will I be able to diagnose it from the logs alone?" If the answer is no, add more context.
- Include actionable metadata in error logs: what operation failed, what inputs caused it, and any IDs or state needed to reproduce (for example worktreeId, projectName, endpoint, status code).
- Never swallow errors silently. If you genuinely cannot handle an error, re-throw it or log it at `warn`/`error` level with context — do not leave an empty catch block.
- **Errors returned to users and logged must always contain the maximum possible diagnostic information.** Generic messages like "process failed" or "exit code 127" are never acceptable on their own. Always include: what command/operation was attempted, what inputs/arguments were used, what environment was in play (for example PATH, working directory), and a human-readable diagnostic hint explaining the likely cause. The goal is that any error — whether in a toast, activity feed event, API response, or log entry — gives enough context to diagnose the problem without needing to reproduce it.

## Operational Logging

- Treat ops logging as mandatory for all operations.
- Always log start and terminal outcome (success/failure) for git operations, CLI commands, HTTP requests, workflow transitions, notifications, and other behind-the-scenes actions.
- Include actionable metadata whenever available (for example command, args, cwd, status code, request/response payload metadata, worktreeId, projectName, and error details).
- Errors that surface as toasts must also be present in ops logs; toasts do not replace logging.

## Child Process PATH Handling

**Always use `withAugmentedPathEnv()` from `@openkit/shared/command-path` when spawning child processes that run user-installed tools** (for example `pnpm`, `npm`, `node`, `adb`, `brew`). Never pass bare `process.env` — in packaged Electron apps, `process.env.PATH` is minimal (`/usr/bin:/bin:/usr/sbin:/sbin`) and does not include Homebrew, nvm, fnm, volta, or `~/.local/bin`.

- `withAugmentedPathEnv()` resolves the user's full shell PATH by spawning their login shell once, then caches it for the lifetime of the process. This captures everything from `.zshrc`/`.bash_profile` including version managers.
- If a spawned process exits with code 127 ("command not found"), call `invalidateShellPath()` to force re-resolution, then retry the spawn once. The user may have installed the missing tool since the last resolution. The worktree manager already implements this retry-on-127 pattern — follow it for any new spawn sites.
- System utilities in `/usr/bin` (for example `git`, `rm`, `pgrep`, `lsof`) work without augmentation but using it is harmless and preferred for consistency.
- `resolveCommandPath(command)` resolves a bare command name to its absolute path using the augmented PATH — use it for `execFile()` calls where you want to fail early with a clear error if the command doesn't exist.

## Debugging

When investigating a bug or unexpected behavior, **always check the ops log file** (`.openkit/ops-log.jsonl`) first. It contains timestamped operational traces for git operations, CLI commands, HTTP requests, workflow transitions, and errors — often revealing the root cause before you need to add any debug logging or reproduce the issue.

When you need to add logging to debug something, **always use the project logger** (`log.debug()`, `log.info()`, etc.) — never `console.log`. Format the log with clear context: what operation is happening, relevant identifiers, and the values being inspected. If the log statement would be useful for future debugging of the same area, keep it in the codebase (at `debug` level) rather than removing it after fixing the issue.

## Dev Mode

OpenKit has a **Dev Mode** (App Settings → Dev Mode toggle) that symlinks each opened project's `.openkit/ops-log.jsonl` into the OpenKit repo at `.openkit/ops-log/<project-name>.jsonl`. This lets developers debugging OpenKit itself reference ops-logs from any project without leaving the repo.

- **When enabled**: every time a project opens, its ops-log is symlinked into `<openkit-repo>/.openkit/ops-log/`.
- **Repo path**: set via a file picker or auto-detected from common dev directories. The path is validated by checking for `package.json` with `name: "openkit"`.
- **Implementation**: `apps/desktop-app/src/dev-mode.ts` (detection + symlinking), preferences stored in `~/.openkit/app-preferences.json` (`devMode`, `devModeRepoPath` fields).
- **Symlink is best-effort**: failures do not block project opening.

## Logging

**All code must use the logger.** Do not use `console.log`, `console.warn`, `console.error`, or `console.debug` directly — the logger handles output formatting, level filtering, and sink dispatch.

- `libs/logger` is a Go-based structured logging library. Go is the single source of truth — all logging features are implemented in Go.
- **Native apps** (server, CLI, desktop-app): Go is compiled as a C-shared library (`liblogger.dylib`/`.so`), loaded via FFI bindings — Node (koffi), Python (ctypes), Zig (dlopen).
- **Browser** (web-app): Go is compiled to WASM via TinyGo. The browser logger (`libs/logger/browser/`) loads the WASM module and provides JS host functions for console output and HTTP transport.
- Each app/lib has a local `logger.ts` that creates a project-scoped instance (for example `new Logger("server")`). Import `{ log }` from that local file, not from `@openkit/logger` directly. Only `logger.ts` files should import from `@openkit/logger`.
- Use `log.info()` for informational output, `log.success()` for completion messages (green ● prefix), `log.warn()` for warnings, `log.error()` for errors, `log.debug()` for debug-only output, and `log.plain()` for unformatted output.
- Always include a `domain` field in the metadata object to namespace logs by feature area (for example `{ domain: "GitHub" }`, `{ domain: "auto-launch" }`, `{ domain: "project-switch" }`). The logger extracts `domain` from metadata into a dedicated field on the `LogEntry`, keeping logs filterable by feature.
- **Sink**: call `Logger.setSink(serverUrl, projectName)` at startup to POST log entries to the server. The server writes them to the ops-log and notifies real-time listeners. All processes (including the server itself) POST to the same endpoint — the server is the single ops-log writer.
- When logging errors, always pass the error object as a whole in the metadata — not just `error.message`. The logger extracts stack traces and structured details that a message string alone loses. For example: `log.error("Operation failed:", { domain: "worktree", error })` — not `log.error(\`Operation failed: ${error.message}\`)`.
- Do not use `process.stderr.write()`, `process.stdout.write()`, or any other raw output for logging. The logger is the only sanctioned output channel.
- There are no exceptions to the logging rule.

## TypeScript Preference

- Always prefer TypeScript (`.ts`/`.tsx`) whenever possible.
- Use `.js`/`.mjs`/`.cjs` only when required by runtime or tool constraints.

## Import Policy

- Do not use parent-relative imports (for example `../` or `../../`) to import from other apps or libs.
- **Use barrel exports for libraries.** Each lib should have an `index.ts` that re-exports its public API. Consumers import from the package root (for example `@openkit/agents`), not internal subpaths. The barrel keeps the public surface explicit and makes it easy to see what a module offers at a glance. When a lib uses non-TS assets (for example `.md` files), ensure vitest configs have the appropriate loader plugin so tests can resolve barrel imports.

## UI Theme Consistency

- Always use the standard shared color palette and tokens from `apps/web-app/src/theme.ts`.
- Do not introduce ad-hoc lighter/darker color variants for existing control patterns.
- For switches/toggles, reuse the app-standard treatment (`bg-accent` when enabled, neutral off-state styling when disabled).
- Use the shared `Modal` component for dialogs; avoid bespoke dialog shells unless there is a documented exception.

## Icon Handling

- Store frontend icon assets in `apps/web-app/src/icons/` as `.svg`/`.png`.
- Define and export one icon component per asset from `apps/web-app/src/icons/index.tsx` (for example `GitHubIcon`, `JiraIcon`).
- For SVG assets, import with `*.svg?raw` and render through the shared SVG wrapper in `apps/web-app/src/icons/index.tsx` to keep sizing/bounds consistent.
- PNG assets are allowed when needed (for example `finder.png`), but still must be wrapped by an exported icon component in `apps/web-app/src/icons/index.tsx`.
- In UI code, import icon components from `apps/web-app/src/icons/index.tsx` (for example `import { GitHubIcon } from "../icons"`), not raw asset files.
- Do not import `.svg`/`.png` directly from feature components; only `apps/web-app/src/icons/index.tsx` should import raw icon assets.

## Dependencies

**Always use `pnpm add` (or `pnpm add -D`) to install packages — never edit `package.json` dependencies manually.** Use the latest version unless a specific version is required.

### Workspace Dependencies

Cross-package imports within the monorepo **must** use pnpm workspace dependencies (`"@openkit/foo": "workspace:*"` in `package.json`), not `tsconfig.json` path aliases. Path aliases are only for self-referential imports within the same package (e.g., `@openkit/server/*` in the server's own tsconfig). Each lib that imports another workspace package must declare it as a dependency via `pnpm add @openkit/foo --workspace`. Package resolution relies on `package.json` `exports` fields (e.g., `"./*": "./src/*.ts"`), not tsconfig paths.

## Configuration Flags

**Initialize all configuration flags in config files at creation time, not on demand.** When adding a new user-facing setting or feature flag, write its default value into `.openkit/config.json` (or the relevant config file) during `init` / `autoInitConfig`. Do not rely on `?? defaultValue` fallbacks scattered across the codebase — that leads to inconsistent defaults, invisible settings, and config files that don't reflect the full set of available options. The config file should be the single source of truth for what's configurable and what the defaults are.

## Design Specs & Plans

For non-trivial features, write a design spec before implementation. Specs live in `docs/superpowers/specs/` with the naming convention `YYYY-MM-DD-<topic>-design.md`. Implementation plans live in `docs/superpowers/plans/` with `YYYY-MM-DD-<topic>.md`. Specs capture the _what/why_; plans capture the _how/order_.

**Always create spec and plan files in the root project directory**, not in a worktree. These are shared artifacts that must be accessible across all branches and worktrees.

**Never use absolute or user-specific paths in specs or plans.** Use repo-relative paths (e.g. `.openkit/worktrees/mcp-fixes/`) and project-relative commands (e.g. `pnpm nx run cli:test`). Docs must be portable across machines and contributors.

## Documentation

Comprehensive documentation lives in `/docs/`. **Always check the relevant docs before working on unfamiliar areas** — they contain architectural context, component patterns, and API details that will help you make correct changes.

**CRITICAL: Keep ALL docs in sync at ALL TIMES.** After every change, check if any docs in `/docs/` or `README.md` need updating and update them immediately — this is not optional. Docs that fall out of sync are actively harmful. Specifically:

- When adding/changing API endpoints → update `docs/API.md`
- When adding/changing components, hooks, or theme tokens → update `docs/FRONTEND.md`
- When adding/changing third-party MCP server management → update `docs/MCP.md`
- When changing architecture, adding new modules/files → update `docs/ARCHITECTURE.md`
- When adding/changing config fields → update `docs/CONFIGURATION.md`
- When changing Electron behavior → update `docs/ELECTRON.md`
- When adding/changing notifications or activity events → update `docs/NOTIFICATIONS.md`
- When adding/changing CLI commands or flags → update `docs/CLI.md` and the website docs page (`apps/website/src/pages/getting-started.astro`)
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
| [MCP Tools](docs/MCP.md)               | MCP status and third-party server management               | MCP/agent tool changes          |
| [Agents](docs/AGENTS.md)               | Agent tooling, skills, plugins, git policy                 | Agent system changes            |
| [Integrations](docs/INTEGRATIONS.md)   | Jira, Linear, GitHub setup                                 | Integration changes             |
| [Port Mapping](docs/PORT-MAPPING.md)   | Port discovery, offset algorithm, runtime hook             | Port system changes             |
| [Hooks](docs/HOOKS.md)                 | Hooks system (trigger types, commands, skills)             | Hooks changes                   |
| [Electron](docs/ELECTRON.md)           | Desktop app, deep linking, multi-project                   | Electron changes                |
| [Notifications](docs/NOTIFICATIONS.md) | Activity feed, toasts, OS notifications, event types       | Notification/activity changes   |
| [Setup Flow](docs/SETUP-FLOW.md)       | Project setup wizard, steps, state machine, integrations   | Setup/onboarding changes        |
