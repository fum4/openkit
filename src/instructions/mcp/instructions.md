When the user mentions an issue key (like PROJ-123, ENG-42, LOCAL-1), a ticket number, or says "work on <something>", use the OpenKit CLI (not MCP) from the project root.

## Source Resolution (CLI-first)

1. Resolve source deterministically first:
   - `openkit task resolve <ID> --json`
2. The resolver checks in this order:
   - Existing issue files under `.openkit/issues/` (local/jira/linear)
   - Connected integrations in `.openkit/integrations.json`
   - Default keys (`jira.defaultProjectKey`, `linear.defaultTeamKey`) when both integrations are connected
3. If resolver is ambiguous, ask the user to choose source (`jira` or `linear`) and continue with explicit source.
4. When a prefixed key is validated for Jira/Linear (e.g. `ABC-123`), OpenKit updates the corresponding default key in `.openkit/integrations.json` automatically.

## Run Task

- Preferred non-interactive command:
  - `openkit task <ID> --init` (auto-resolve source)
- Explicit source fallback:
  - `openkit task jira <ID> --init`
  - `openkit task linear <ID> --init`
  - `openkit task local <ID> --init`

`LOCAL-` prefixed issues are always treated as local.

## After Initializing a Worktree

1. Read task context:
   - Primary: `.openkit/issues/<source>/<issue-id>/task.json` (or `issue.json` for jira/linear)
   - Notes/todos: `.openkit/issues/<source>/<issue-id>/notes.json`
   - Optional generated context file in worktree: `TASK.md`
2. Read hook configuration from `.openkit/hooks.json`.
3. Before running hooks/commands, tell the user what you are about to run; after running, summarize results.
4. Run pre-implementation command hooks before coding, and post-implementation hooks after coding.
5. If a hook references a skill (`skillName`), invoke that skill and summarize the result in the conversation.
6. Follow AI context and todo checklist in notes/TASK.md; user-defined context takes priority over issue tracker text if they conflict.
7. Plan before coding, then implement.
8. If blocked on missing input, ask the user immediately and state exactly what is needed.
