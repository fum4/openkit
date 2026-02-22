# Hooks

## Overview

Hooks are automated checks, prompt instructions, and agent skills that run at defined points in a worktree's lifecycle. They provide a structured way to validate work and extend agent behavior.

Hooks are organized by **trigger type** -- when they fire relative to agent work. Agent workflow triggers support command steps, prompt steps, and skill references. Worktree lifecycle triggers support command steps only.

The hooks system is configured through the web UI's Hooks view and stored in `.dawg/.dawg/hooks.json`.

## Trigger Types

Every hook belongs to one of six trigger types:

| Trigger               | Description                                                      | Icon              | Color       |
| --------------------- | ---------------------------------------------------------------- | ----------------- | ----------- |
| `pre-implementation`  | Runs before agents start working on a task                       | ListChecks        | sky-400     |
| `post-implementation` | Runs after agents finish implementing a task                     | CircleCheck       | emerald-400 |
| `custom`              | Agent decides when to run, based on a natural-language condition | MessageSquareText | violet-400  |
| `on-demand`           | Manually triggered from the worktree detail panel                | Hand              | amber-400   |
| `worktree-created`    | Runs automatically after a worktree is created                   | FolderPlus        | cyan-400    |
| `worktree-removed`    | Runs automatically after a worktree is removed                   | FolderMinus       | rose-400    |

Steps and skills default to `post-implementation` if no trigger is specified.

## Item Types

### Command Steps

Shell commands that run in the worktree directory and return pass/fail results.

- Executed via `execFile` with a 2-minute timeout.
- Pass/fail determined by exit code (zero = pass, non-zero = fail).
- stdout and stderr are captured and returned as step output.
- `FORCE_COLOR=0` is set to suppress ANSI codes in output.
- When running all hooks for a worktree, enabled steps matching the trigger run in parallel.

### Skill References

References to skills from the `~/.dawg/skills/` registry. When hooks run, skill references tell the agent which skills to invoke.

- Skills are imported by name from the registry.
- Each skill reference can be individually enabled/disabled.
- The same skill can be used in multiple trigger types (e.g., a code-review skill in both `post-implementation` and `on-demand`).
- Skills are identified by the composite key `skillName + trigger`.
- Custom-trigger skills include a `condition` field -- a natural-language description of when the agent should invoke them.
- Lifecycle triggers (`worktree-created`, `worktree-removed`) are command-only and do not accept skills.

### Prompt Steps

Prompt steps are plain-language instructions sent to the agent (not shell commands). They are configured in hooks and rendered into `TASK.md` so agents execute them at the appropriate hook phase.

- Stored as hook steps with `kind: "prompt"` and `prompt` text.
- Prompt steps are never executed via `run_hooks`.
- Prompt steps are available for pre/post/custom triggers only.

### Per-Issue Skill Overrides

Individual issues can override the global enable/disable state of skills. Overrides are stored in the issue's notes (`hookSkills` field) and can be:

| Override  | Behavior                                        |
| --------- | ----------------------------------------------- |
| `inherit` | Use the global enabled/disabled state (default) |
| `enable`  | Force-enable for this issue's worktree          |
| `disable` | Force-disable for this issue's worktree         |

The `getEffectiveSkills()` method resolves overrides by looking up the worktree's linked issue.

## Configuration

Hooks configuration is stored in `.dawg/.dawg/hooks.json`:

```json
{
  "steps": [
    {
      "id": "step-1234567890-1",
      "name": "Type check",
      "command": "pnpm check-types",
      "enabled": true,
      "trigger": "post-implementation"
    },
    {
      "id": "step-1234567890-2",
      "name": "Lint on DB changes",
      "command": "pnpm check-lint",
      "enabled": true,
      "trigger": "custom",
      "condition": "When changes touch database models or migrations"
    }
  ],
  "skills": [
    {
      "skillName": "review-changes",
      "enabled": true,
      "trigger": "post-implementation"
    },
    {
      "skillName": "review-changes",
      "enabled": true,
      "trigger": "on-demand"
    },
    {
      "skillName": "verify-tests",
      "enabled": true,
      "trigger": "custom",
      "condition": "When changes add new API endpoints"
    }
  ]
}
```

### HookStep Fields

| Field       | Type        | Description                                                      |
| ----------- | ----------- | ---------------------------------------------------------------- |
| `id`        | string      | Unique identifier (auto-generated: `step-{timestamp}-{counter}`) |
| `name`      | string      | Human-readable name shown in the UI                              |
| `command`   | string      | Shell command to execute in the worktree directory               |
| `kind`      | string      | `"command"` (default) or `"prompt"`                              |
| `prompt`    | string      | Prompt text for `kind: "prompt"`                                 |
| `enabled`   | boolean     | Whether this step is active (default: `true`)                    |
| `trigger`   | HookTrigger | When this step runs (default: `post-implementation`)             |
| `condition` | string      | Natural-language condition for `custom` trigger type             |

### HookSkillRef Fields

| Field       | Type        | Description                                           |
| ----------- | ----------- | ----------------------------------------------------- |
| `skillName` | string      | Name of the skill in `~/.dawg/skills/`                |
| `enabled`   | boolean     | Whether this skill is active                          |
| `trigger`   | HookTrigger | When this skill runs (default: `post-implementation`) |
| `condition` | string      | Natural-language condition for `custom` trigger type  |

## Running Hooks

### From the UI

The Hooks view (top navigation) is the configuration interface. Users can:

1. Add command steps, prompt steps (pre/post/custom), or import skills into trigger sections.
2. Toggle individual items on/off.
3. Edit command step names, commands, and conditions.
4. Remove items.

The worktree detail panel's **Hooks** tab triggers hook runs for a specific worktree. Multiple items can be expanded simultaneously to view their output. When the entire pipeline completes (all enabled steps and skills have results), all items with content are auto-expanded.

When Claude is launched from issue flows (`Code with Claude` or integration auto-start), dawg also triggers command hooks automatically:

- `pre-implementation` runs before Claude launch starts.
- `post-implementation` runs after Claude exits with code `0`.

Each hook item shows its state visually:

- **Not yet run** -- dashed border, no background.
- **Running** -- dashed border, no card background, with a circular spinner (Loader2).
- **Completed** -- solid border with card background, showing pass/fail status icon (CheckCircle/XCircle).
- **Disabled** -- solid border with card background, reduced opacity.

Real-time updates: When agents report hook results via `report_hook_status`, the backend emits a `hook-update` SSE event. The frontend auto-refetches results and auto-expands skills that just received new content.

### From MCP Tools

Agents interact with hooks through the following workflow:

1. Call `get_hooks_config` immediately after entering a worktree to discover all trigger types.
2. Run `pre-implementation` hooks before starting work (`run_hooks` with `trigger: "pre-implementation"` for commands; prompt steps and skills invoked directly).
3. While working, check `custom` hook conditions — if changes match a condition, run those hooks.
4. Run `post-implementation` hooks after completing work (`run_hooks` with `trigger: "post-implementation"` for commands).
5. Report skill results back via `report_hook_status` (call twice: once before invoking without `success`/`summary` to show loading, once after with the result). Include `trigger` when reporting. For skills with detailed output, write an MD file to `{worktreePath}/.dawg-{skillName}.md` and pass the path via `filePath`.
6. Call `get_hooks_status` to verify all steps passed.
7. After all work and hooks are done, ask the user if they'd like to start the worktree dev server automatically (via `start_worktree`).

### Execution

When hooks are triggered for a worktree:

1. The `HooksManager` filters steps by the target trigger type and enabled state.
2. All matching enabled command steps run in parallel via `execFile` in the worktree directory.
3. Prompt steps are skipped by runtime execution and interpreted by the agent from `TASK.md`.
4. Results are collected and persisted to `.dawg/.dawg/worktrees/{worktreeId}/hooks/latest-run.json`.
5. Skill results are reported separately by agents and stored at `.dawg/.dawg/worktrees/{worktreeId}/hooks/skill-results.json` using key `skillName + trigger`.
6. `worktree-created` and `worktree-removed` command hooks are triggered automatically by CLI-backed create/remove flows (server mode, MCP standalone mode, and `dawg task --init` worktree creation).

## Data Storage

```
.dawg/
  .dawg/
    hooks.json                              # Global hooks configuration
    worktrees/
      <worktreeId>/
        hooks/
          latest-run.json                   # Most recent command step run
          skill-results.json                # Agent-reported skill results
```

## REST API

| Method   | Path                                     | Description                                                                   |
| -------- | ---------------------------------------- | ----------------------------------------------------------------------------- |
| `GET`    | `/api/hooks/config`                      | Get hooks configuration                                                       |
| `PUT`    | `/api/hooks/config`                      | Save full hooks configuration                                                 |
| `POST`   | `/api/hooks/steps`                       | Add a step (`{ name, command, kind? }` or `{ name, kind: "prompt", prompt }`) |
| `PATCH`  | `/api/hooks/steps/:stepId`               | Update a step (`{ name?, command?, prompt?, kind?, enabled?, trigger? }`)     |
| `DELETE` | `/api/hooks/steps/:stepId`               | Remove a step                                                                 |
| `POST`   | `/api/hooks/skills/import`               | Import a skill (`{ skillName, trigger?, condition? }`)                        |
| `GET`    | `/api/hooks/skills/available`            | List available skills from registry                                           |
| `PATCH`  | `/api/hooks/skills/:name`                | Toggle a skill (`{ enabled, trigger? }`)                                      |
| `DELETE` | `/api/hooks/skills/:name`                | Remove a skill (`?trigger=` query param)                                      |
| `POST`   | `/api/worktrees/:id/hooks/run`           | Run enabled command steps for a worktree (`{ trigger? }`)                     |
| `POST`   | `/api/worktrees/:id/hooks/run/:stepId`   | Run a single step                                                             |
| `GET`    | `/api/worktrees/:id/hooks/status`        | Get latest run status                                                         |
| `POST`   | `/api/worktrees/:id/hooks/report`        | Report a skill result (`{ skillName, trigger?, success, summary, ... }`)      |
| `GET`    | `/api/worktrees/:id/hooks/skill-results` | Get skill results for a worktree                                              |
| `GET`    | `/api/files/read?path=...`               | Read a file by absolute path (used for MD report preview)                     |

## Backend

### HooksManager (`src/server/verification-manager.ts`)

The `HooksManager` class manages all hooks state and execution:

- **Config**: `getConfig()`, `saveConfig()`, `addStep()`, `removeStep()`, `updateStep()`
- **Skills**: `importSkill()`, `removeSkill()`, `toggleSkill()`, `getEffectiveSkills()`
- **Execution**: `runAll()`, `runSingle()` -- command step execution with timeout
- **Skill results**: `reportSkillResult()`, `getSkillResults()` -- agent-reported results
- **Status**: `getStatus()` -- latest pipeline run for a worktree

### Routes (`src/server/routes/verification.ts`)

Registered via `registerHooksRoutes(app, manager, hooksManager)` in the server setup.

## Frontend

### HooksPanel (`src/ui/components/VerificationPanel.tsx`)

The top-level Hooks view. Displays six sections (one per trigger type). Pre/post/custom/on-demand sections support command/prompt/skill composition; worktree lifecycle sections are command-only.

- A header with icon, title, and description.
- Command/prompt step cards (editable, toggleable, removable).
- Skill cards (toggleable, removable).
- "Add command", "Add skill", and (pre/post) "Add prompt" action buttons (mutually exclusive forms).
- Worktree lifecycle sections expose only "Add command".

Custom-trigger sections support grouped condition-based commands, prompts, and skills in a single editor.

### useHooksConfig (`src/ui/hooks/useHooks.ts`)

Hook for fetching and saving hooks configuration. Returns `{ config, isLoading, refetch, saveConfig }`.

### useHookSkillResults (`src/ui/hooks/useHooks.ts`)

Hook for fetching agent-reported skill results for a worktree.

### Report Preview Modal

When a skill result includes a `filePath`, the HooksTab shows a "View report" link next to the skill name. Clicking it fetches the file content via `GET /api/files/read` and opens a modal with `MarkdownContent` rendering. This allows agents to produce detailed MD reports that users can read in a formatted preview.

### Issue Detail Panel: Hooks Tab

The Agents section in issue detail panels (Linear, Jira, Local) includes a Hooks tab that shows:

- Steps and skills grouped by trigger type (including lifecycle triggers when configured).
- Command and prompt steps displayed read-only.
- Skills with per-issue override toggles (Inherit / Enable / Disable).
