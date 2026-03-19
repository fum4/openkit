# Agents Library

Everything agents need to understand and interact with OpenKit. If it shapes what an agent sees, reads, or is instructed to do, it lives here — not in shared libs or app-specific code.

This includes: skill definitions, instruction templates, task context formatting, and any types that define the contract between OpenKit and agents.

## What Lives Here

- `src/task-context.ts`: types and formatters for agent task context (issue data, notes, hooks → markdown or JSON). Used by the `openkit task context` CLI command.
- `src/instructions.ts`: instruction/skill markdown barrel with placeholder resolution. Exports `CLAUDE_SKILL`, `CURSOR_RULE`, `VSCODE_PROMPT`.
- `src/work-skill/`: per-IDE instruction templates (Claude, Cursor, VS Code) and the shared workflow base.
- `src/sample-skills/`: bundled skill markdown sources deployed to `~/.openkit/skills/`.

## How It Works

1. **Build**: tsup loads `.md` files as text strings via the esbuild loader configured in `apps/cli/tsup.config.ts`.
2. **Barrel**: `src/instructions.ts` imports all `.md` files from `work-skill/`, resolves placeholders (`{{APP_NAME}}`, `{{WORKFLOW}}`), and exports typed constants.
3. **Consumers**: source files import from the barrel (`@openkit/agents`); no raw `.md` imports are scattered across the codebase.
4. **TypeScript**: `md.d.ts` (repo root) declares `*.md` modules so TypeScript accepts the imports.

## File Map

### Work Skill (`src/work-skill/`)

| File               | Export          | Deployed To                      | Purpose                                                                             |
| ------------------ | --------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `base.md`          | _(internal)_    | --                               | CLI-first workflow steps, interpolated into claude/cursor/vscode via `{{WORKFLOW}}` |
| `claude-skill.md`  | `CLAUDE_SKILL`  | `~/.claude/skills/work/SKILL.md` | Claude Code work skill (CLI-first, injected `{{WORKFLOW}}`)                         |
| `cursor-rule.md`   | `CURSOR_RULE`   | `.cursor/rules/OpenKit.mdc`      | Cursor rule                                                                         |
| `vscode-prompt.md` | `VSCODE_PROMPT` | `.github/prompts/work.prompt.md` | VS Code Copilot prompt                                                              |

### Sample Skills (`src/sample-skills/`)

| File Path                          | Deployed To                                          | Purpose                     |
| ---------------------------------- | ---------------------------------------------------- | --------------------------- |
| `summarize-changes/SKILL.md`       | `~/.openkit/skills/summarize-changes/SKILL.md`       | Diff-based changes summary  |
| `review-changes/SKILL.md`          | `~/.openkit/skills/review-changes/SKILL.md`          | Self code review            |
| `how-to-test/SKILL.md`             | `~/.openkit/skills/how-to-test/SKILL.md`             | Manual testing walkthrough  |
| `write-tests/SKILL.md`             | `~/.openkit/skills/write-tests/SKILL.md`             | Test strategy orchestrator  |
| `write-unit-tests/SKILL.md`        | `~/.openkit/skills/write-unit-tests/SKILL.md`        | Unit test writing           |
| `write-integration-tests/SKILL.md` | `~/.openkit/skills/write-integration-tests/SKILL.md` | Integration test writing    |
| `write-e2e-tests/SKILL.md`         | `~/.openkit/skills/write-e2e-tests/SKILL.md`         | End-to-end test writing     |
| `explain-like-im-5/SKILL.md`       | `~/.openkit/skills/explain-like-im-5/SKILL.md`       | Domain onboarding explainer |
| `address-review-findings/SKILL.md` | `~/.openkit/skills/address-review-findings/SKILL.md` | Remediate review output     |
| `work-on-task/SKILL.md`            | `~/.openkit/skills/work-on-task/SKILL.md`            | Generic CLI task workflow   |

### Task Context (`src/task-context.ts`)

Types and formatters for the `openkit task context` CLI command. Reads issue data, notes, and hooks config, then outputs merged context as agent-readable markdown or structured JSON.

## Placeholder Conventions

| Placeholder    | Resolved                            | Value                               |
| -------------- | ----------------------------------- | ----------------------------------- |
| `{{APP_NAME}}` | At import time in `instructions.ts` | `APP_NAME` constant ("OpenKit")     |
| `{{WORKFLOW}}` | At import time in `instructions.ts` | Content of `base.md`                |
| `{{ISSUE_ID}}` | At runtime by caller                | Function argument (e.g. "PROJ-123") |
