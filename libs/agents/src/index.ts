import { APP_NAME } from "@openkit/shared/constants";

import workflowMd from "./work-skill/base.md";
import claudeSkillMd from "./work-skill/claude-skill.md";
import cursorRuleMd from "./work-skill/cursor-rule.md";
import vscodePromptMd from "./work-skill/vscode-prompt.md";

// ─── Placeholder resolution ─────────────────────────────────────

function resolve(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

const shared = { APP_NAME };
const withWorkflow = { ...shared, WORKFLOW: workflowMd };

// ─── Work skill (per-IDE variants) ──────────────────────────────

/** Claude Code SKILL.md content (deployed to ~/.claude/skills/work/SKILL.md) */
export const CLAUDE_SKILL = resolve(claudeSkillMd, withWorkflow);

/** Cursor rule content (deployed to .cursor/rules/OpenKit.mdc) */
export const CURSOR_RULE = resolve(cursorRuleMd, withWorkflow);

/** VS Code Copilot prompt content (deployed to .github/prompts/work.prompt.md) */
export const VSCODE_PROMPT = resolve(vscodePromptMd, withWorkflow);
