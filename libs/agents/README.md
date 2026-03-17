# Agents Library

Agent tooling and skill/instruction management for OpenKit.

## What Lives Here

- `src/instructions.ts`: instruction/skill markdown barrel with placeholder resolution.
- `src/builtin-instructions.ts`: deploys skill/rule files to agent directories.
- `src/verification-skills.ts`: seeds bundled skills into the registry.
- `src/mcp/`: instruction markdown sources (skill files, cursor rules, vscode prompts).
- `src/skills/`: bundled skill markdown sources.

## How It Works

1. **Build**: tsup loads `.md` files as text strings via the esbuild loader configured in `apps/cli/tsup.config.ts`.
2. **Barrel**: `src/instructions.ts` imports all `.md` files, resolves placeholders (`{{APP_NAME}}`, `{{WORKFLOW}}`), and exports typed constants.
3. **Consumers**: Source files import from this barrel; no raw `.md` imports are scattered across the codebase.
4. **TypeScript**: `md.d.ts` (repo root) declares `*.md` modules so TypeScript accepts the imports.

## File Map

### Instructions (`libs/agents/src/mcp/`)

| File               | Export          | Deployed To                      | Purpose                                                                             |
| ------------------ | --------------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `instructions.md`  | _(internal)_    | --                               | CLI-first workflow steps, interpolated into claude/cursor/vscode via `{{WORKFLOW}}` |
| `claude-skill.md`  | `CLAUDE_SKILL`  | `~/.claude/skills/work/SKILL.md` | Claude Code work skill (CLI-first, injected `{{WORKFLOW}}`)                         |
| `cursor-rule.md`   | `CURSOR_RULE`   | `.cursor/rules/OpenKit.mdc`      | Cursor rule                                                                         |
| `vscode-prompt.md` | `VSCODE_PROMPT` | `.github/prompts/work.prompt.md` | VS Code Copilot prompt                                                              |

### Skills (`libs/agents/src/skills/`)

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

## Placeholder Conventions

| Placeholder    | Resolved                            | Value                               |
| -------------- | ----------------------------------- | ----------------------------------- |
| `{{APP_NAME}}` | At import time in `instructions.ts` | `APP_NAME` constant ("OpenKit")     |
| `{{WORKFLOW}}` | At import time in `instructions.ts` | Content of `instructions.md`        |
| `{{ISSUE_ID}}` | At runtime by caller                | Function argument (e.g. "PROJ-123") |
