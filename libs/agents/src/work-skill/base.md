When the user mentions an issue key (like PROJ-123, ENG-42, LOCAL-1), a ticket number, or says "work on <something>", use the OpenKit CLI from the project root.

## Source Resolution

1. Resolve the source deterministically:
   - `openkit task resolve <ID> --json`
2. The resolver checks in order:
   - Existing issue files under `.openkit/issues/` (local/jira/linear)
   - Connected integrations in `.openkit/integrations.json`
   - Default keys (`jira.defaultProjectKey`, `linear.defaultTeamKey`) when both integrations are connected
3. If the resolver is ambiguous, ask the user to choose source (`jira` or `linear`) and continue with the explicit source.
4. When a prefixed key is validated for Jira/Linear (e.g. `ABC-123`), OpenKit updates the corresponding default key in `.openkit/integrations.json` automatically.
5. `LOCAL-` prefixed issues are always treated as local.

## Initialize Worktree

- Preferred non-interactive command:
  - `openkit task <ID> --init` (auto-resolve source)
- Explicit source fallback:
  - `openkit task jira <ID> --init`
  - `openkit task linear <ID> --init`
  - `openkit task local <ID> --init`

## Workflow

1. Run `openkit task resolve <ID> --json` when source is not explicit.
2. If ambiguous, ask the user which integration to use.
3. Run `openkit task <ID> --init` (or `openkit task <source> <ID> --init`).
4. Confirm the issue summary from output.
5. Enter worktree directory under `.openkit/worktrees/`.
6. Emit checkpoint: `openkit activity phase --phase task-started`.
7. Run `openkit task context` to get full task details (issue data, AI context, todos, effective hooks with per-issue overrides applied).
8. Emit checkpoint: `openkit activity phase --phase pre-hooks-started`.
9. Run pre-implementation hooks before coding. If a hook references a skill (`skillName`), invoke that skill and summarize the result.
10. Emit checkpoint: `openkit activity phase --phase pre-hooks-completed`.
11. Emit checkpoint: `openkit activity phase --phase implementation-started`.
12. Plan before coding, then implement. Follow AI context and todo checklist. User-defined context takes priority over issue tracker text.
13. Emit checkpoint: `openkit activity phase --phase implementation-completed`.
14. Emit checkpoint: `openkit activity phase --phase post-hooks-started`.
15. Run post-implementation hooks.
16. Emit checkpoint: `openkit activity phase --phase post-hooks-completed`.
17. Run `openkit activity check-flow --json`. If `compliant` is `false`, execute all listed `missingActions`, rerun the check, and only proceed when `compliant` is `true`.
18. If you need user input at any point: `openkit activity await-input --message "<what you need>"`.
19. Summarize changes, risks, verification results, and include the final check-flow result.

## Guardrails

- Announce major commands before running them; after running, summarize results.
- Prefer non-interactive commands and flags (`--init`) to avoid blocked prompts.
- Never skip or reorder workflow phases. Always emit checkpoints in canonical order.
- Never claim completion when `openkit activity check-flow` is failing.
- If blocked on missing input, ask the user immediately and state exactly what is needed.
- If `openkit task ... --init` fails due to git/worktree permissions, explain the failure and retry with the required permission level.
- If CLI commands fail, report the failure clearly and ask the user for guidance before proceeding.
