---
name: work-on-task
description: Use OpenKit CLI to fetch task details, create a worktree, run checks, and implement.
user-invocable: true
argument-hint: <source> <id> (or just <issue-id> when source is obvious)
---

You are a task-execution skill for OpenKit. Use the OpenKit CLI as the default control plane.

## Goal

Given an issue identifier, fetch task context, create/link the worktree, run pre-work checks, implement, then run post-work checks.

## Source Mapping

- Preferred resolver: `openkit task resolve <ID> --json`
- Auto-init: `openkit task <ID> --init`
- Explicit source fallback:
  - Jira: `openkit task jira <ID> --init`
  - Linear: `openkit task linear <ID> --init`
  - Local: `openkit task local <ID> --init`

If the source is ambiguous, ask before running commands.

## Workflow

1. Run `openkit task resolve <ID> --json` first when source is not explicit.
2. If resolver is ambiguous, ask user which integration to use.
3. Run `openkit task <ID> --init` (or explicit-source `openkit task <source> <ID> --init`).
   - When a Jira/Linear prefixed key is validated, OpenKit auto-updates integration defaults in `.openkit/integrations.json`.
4. Confirm the issue summary from output.
5. Enter worktree directory under `.openkit/worktrees/`.
6. Emit workflow checkpoint: `openkit activity phase --phase task-started`.
7. Read task context from:
   - `.openkit/issues/<source>/<issue-id>/task.json` (local) or `issue.json` (jira/linear)
   - `.openkit/issues/<source>/<issue-id>/notes.json`
   - `TASK.md` when present
8. Inspect `.openkit/hooks.json`.
9. Emit workflow checkpoint: `openkit activity phase --phase pre-hooks-started`.
10. Run pre-implementation checks before changing code.
11. Emit workflow checkpoint: `openkit activity phase --phase pre-hooks-completed`.
12. Emit workflow checkpoint: `openkit activity phase --phase implementation-started`.
13. Implement the task.
14. Emit workflow checkpoint: `openkit activity phase --phase implementation-completed`.
15. Emit workflow checkpoint: `openkit activity phase --phase post-hooks-started`.
16. Run post-implementation checks.
17. Emit workflow checkpoint: `openkit activity phase --phase post-hooks-completed`.
18. Before finalizing, run `openkit activity check-flow --json`.
19. If `compliant` is `false`, do not finalize. Execute all listed `missingActions`, rerun `openkit activity check-flow --json`, and only proceed when `compliant` is `true`.
20. If you need user approval/instructions at any point, notify OpenKit before asking:

- MCP flow: call `notify` with `requiresUserAction: true`.
- Terminal flow: run `openkit activity await-input --message "<what you need>"`.

21. Summarize changes, risks, verification results, and include the final `openkit activity check-flow --json` result.

## Guardrails

- Announce major commands before running them.
- Prefer non-interactive commands and flags (`--init`) to avoid blocked prompts.
- Never skip or reorder workflow phases. Always emit checkpoints in canonical order.
- Never claim completion when `openkit activity check-flow` is failing.
- Keep MCP tooling as fallback; do not remove MCP configuration.
