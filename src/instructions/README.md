# Instructions Directory

Agent instruction text extracted from TypeScript source into standalone markdown files. These are inlined as strings at build time via tsup's esbuild text loader (`{ '.md': 'text' }`).

## How It Works

1. **Build**: tsup loads `.md` files as text strings via the esbuild loader configured in `tsup.config.ts`
2. **Barrel**: `index.ts` imports all `.md` files, resolves placeholders (`{{APP_NAME}}`, `{{WORKFLOW}}`), and exports typed constants
3. **Consumers**: Source files import from this barrel — no raw `.md` imports scattered across the codebase
4. **TypeScript**: `src/md.d.ts` declares `*.md` modules so TS accepts the imports

## File Map

### Root (`src/instructions/`)

| File                  | Export                    | Used By                 | Purpose                                                                 |
| --------------------- | ------------------------- | ----------------------- | ----------------------------------------------------------------------- |
| `mcp-server.md`       | `MCP_INSTRUCTIONS`        | `mcp-server-factory.ts` | Server-level MCP instructions                                           |
| `mcp-work-on-task.md` | `MCP_WORK_ON_TASK_PROMPT` | `mcp-server-factory.ts` | "work-on-task" MCP prompt template (`{{ISSUE_ID}}` resolved at runtime) |

### MCP (`src/instructions/mcp/`)

| File                 | Export          | Deployed To                      | Purpose                                                                   |
| -------------------- | --------------- | -------------------------------- | ------------------------------------------------------------------------- |
| `instructions.md`    | _(internal)_    | —                                | CLI-first workflow steps, interpolated into claude/cursor/vscode via `{{WORKFLOW}}` |
| `claude-skill.md`    | `CLAUDE_SKILL`  | `~/.claude/skills/work/SKILL.md` | Claude Code work skill (CLI-first, MCP fallback, injected `{{WORKFLOW}}`) |
| `cursor-rule.md`     | `CURSOR_RULE`   | `.cursor/rules/OpenKit.mdc`         | Cursor rule                                                               |
| `vscode-prompt.md`   | `VSCODE_PROMPT` | `.github/prompts/work.prompt.md` | VS Code Copilot prompt                                                    |

### Skills (`src/instructions/skills/`)

| File Path                                 | Deployed To                                 | Purpose                    |
| ----------------------------------------- | ------------------------------------------- | -------------------------- |
| `summarize-changes/SKILL.md`              | `~/.openkit/skills/summarize-changes/SKILL.md` | Diff-based changes summary |
| `review-changes/SKILL.md`                 | `~/.openkit/skills/review-changes/SKILL.md`    | Self code review           |
| `how-to-test/SKILL.md`                    | `~/.openkit/skills/how-to-test/SKILL.md`       | Manual testing walkthrough |
| `write-tests/SKILL.md`                    | `~/.openkit/skills/write-tests/SKILL.md`       | Test strategy orchestrator |
| `write-unit-tests/SKILL.md`               | `~/.openkit/skills/write-unit-tests/SKILL.md`  | Unit test writing          |
| `write-integration-tests/SKILL.md`        | `~/.openkit/skills/write-integration-tests/SKILL.md` | Integration test writing |
| `write-e2e-tests/SKILL.md`                | `~/.openkit/skills/write-e2e-tests/SKILL.md`   | End-to-end test writing    |
| `explain-like-im-5/SKILL.md`              | `~/.openkit/skills/explain-like-im-5/SKILL.md` | Domain onboarding explainer |
| `address-review-findings/SKILL.md`        | `~/.openkit/skills/address-review-findings/SKILL.md` | Remediate review output |
| `work-on-task/SKILL.md`                   | `~/.openkit/skills/work-on-task/SKILL.md`      | Generic CLI task workflow  |

## Placeholder Conventions

| Placeholder    | Resolved                     | Value                               |
| -------------- | ---------------------------- | ----------------------------------- |
| `{{APP_NAME}}` | At import time in `index.ts` | `APP_NAME` constant ("OpenKit")        |
| `{{WORKFLOW}}` | At import time in `index.ts` | Content of `instructions.md`        |
| `{{ISSUE_ID}}` | At runtime by caller         | Function argument (e.g. "PROJ-123") |
