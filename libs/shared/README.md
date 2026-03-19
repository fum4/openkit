# @openkit/shared

Core shared utilities used across all OpenKit apps and libs. Imported as `@openkit/shared/<module>` (e.g. `@openkit/shared/constants`).

## Modules

| Module               | Description                                                                                     |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| `activity-event`     | Activity event types, categories, severity levels, and notification configuration               |
| `command-path`       | PATH resolution for child processes — resolves the user's shell PATH for packaged Electron apps |
| `commit-message`     | Custom commit message formatting from `.mjs` rules or default templates                         |
| `constants`          | App branding constants (`APP_NAME`, `CLI_COMMAND`, `CONFIG_DIR_NAME`, `DEFAULT_PORT`)           |
| `detect-config`      | Auto-detection of project config (base branch, package manager, start/install commands)         |
| `env-files`          | Recursive `.env` file copying between directories                                               |
| `errors`             | Utilities to extract error messages and stack traces from caught values                         |
| `git`                | Git helpers: repo root, worktree branch extraction, branch name validation                      |
| `git-policy`         | Policy resolution for agent git operations (commit/push/PR) per worktree or global config       |
| `global-preferences` | User-level preferences (`~/.openkit/app-preferences.json`) — base port, dev mode, window bounds |
| `logger`             | Project-scoped logger instance for the shared module                                            |
| `notes-types`        | Types for issue notes: linked worktrees, context, todos, git policy overrides                   |
| `perf-types`         | Metrics types for process, agent session, worktree, and system performance snapshots            |
| `task-context`       | TASK.md generation for agent workflows (issue details, hooks, todos, attachments)               |
| `ui-components`      | Path resolution for bundled/downloaded web UI resources and OpenKit state directories           |
| `version`            | Application version resolution from package.json                                                |
| `worktree-types`     | Worktree configuration, info, lifecycle types, and hook pipeline structures                     |
