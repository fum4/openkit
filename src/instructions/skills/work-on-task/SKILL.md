---
name: work-on-task
description: Use dawg CLI to fetch task details, create a worktree, run checks, and implement.
user-invocable: true
argument-hint: <source> <id> (or just <issue-id> when source is obvious)
---

You are a task-execution skill for dawg. Use the dawg CLI as the default control plane.

## Goal

Given an issue identifier, fetch task context, create/link the worktree, run pre-work checks, implement, then run post-work checks.

## Source Mapping

- Preferred resolver: `dawg task resolve <ID> --json`
- Auto-init: `dawg task <ID> --init`
- Explicit source fallback:
  - Jira: `dawg task jira <ID> --init`
  - Linear: `dawg task linear <ID> --init`
  - Local: `dawg task local <ID> --init`

If the source is ambiguous, ask before running commands.

## Workflow

1. Run `dawg task resolve <ID> --json` first when source is not explicit.
2. If resolver is ambiguous, ask user which integration to use.
3. Run `dawg task <ID> --init` (or explicit-source `dawg task <source> <ID> --init`).
   - When a Jira/Linear prefixed key is validated, dawg auto-updates integration defaults in `.dawg/integrations.json`.
4. Confirm the issue summary from output.
5. Enter worktree directory under `.dawg/worktrees/`.
6. Emit workflow checkpoint: `dawg activity phase --phase task-started`.
7. Read task context from:
   - `.dawg/issues/<source>/<issue-id>/task.json` (local) or `issue.json` (jira/linear)
   - `.dawg/issues/<source>/<issue-id>/notes.json`
   - `TASK.md` when present
8. Inspect `.dawg/hooks.json`.
9. Emit workflow checkpoint: `dawg activity phase --phase pre-hooks-started`.
10. Run pre-implementation checks before changing code.
11. Emit workflow checkpoint: `dawg activity phase --phase pre-hooks-completed`.
12. Emit workflow checkpoint: `dawg activity phase --phase implementation-started`.
13. Implement the task.
14. Emit workflow checkpoint: `dawg activity phase --phase implementation-completed`.
15. Emit workflow checkpoint: `dawg activity phase --phase post-hooks-started`.
16. Run post-implementation checks.
17. Emit workflow checkpoint: `dawg activity phase --phase post-hooks-completed`.
18. Before finalizing, run `dawg activity check-flow --json`.
19. If `compliant` is `false`, do not finalize. Execute all listed `missingActions`, rerun `dawg activity check-flow --json`, and only proceed when `compliant` is `true`.
20. If you need user approval/instructions at any point, notify dawg before asking:
   - MCP flow: call `notify` with `requiresUserAction: true`.
   - Terminal flow: run `dawg activity await-input --message "<what you need>"`.
21. Summarize changes, risks, verification results, and include the final `dawg activity check-flow --json` result.

## Guardrails

- Announce major commands before running them.
- Prefer non-interactive commands and flags (`--init`) to avoid blocked prompts.
- Never skip or reorder workflow phases. Always emit checkpoints in canonical order.
- Never claim completion when `dawg activity check-flow` is failing.
- Keep MCP tooling as fallback; do not remove MCP configuration.
