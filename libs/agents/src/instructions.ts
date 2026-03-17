import { APP_NAME } from "@openkit/shared/constants";

import workflowInstructionsMd from "./mcp/instructions.md";
import claudeSkillMd from "./mcp/claude-skill.md";
import cursorRuleMd from "./mcp/cursor-rule.md";
import vscodePromptMd from "./mcp/vscode-prompt.md";
import summarizeChangesMd from "./skills/summarize-changes/SKILL.md";
import reviewChangesMd from "./skills/review-changes/SKILL.md";
import howToTestMd from "./skills/how-to-test/SKILL.md";
import writeTestsMd from "./skills/write-tests/SKILL.md";
import writeUnitTestsMd from "./skills/write-unit-tests/SKILL.md";
import writeIntegrationTestsMd from "./skills/write-integration-tests/SKILL.md";
import writeE2eTestsMd from "./skills/write-e2e-tests/SKILL.md";
import explainLikeIm5Md from "./skills/explain-like-im-5/SKILL.md";
import addressReviewFindingsMd from "./skills/address-review-findings/SKILL.md";
import workOnTaskMd from "./skills/work-on-task/SKILL.md";

// ─── Placeholder resolution ─────────────────────────────────────

function resolve(template: string, vars: Record<string, string>): string {
  return Object.entries(vars).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

const shared = { APP_NAME };
const withWorkflow = { ...shared, WORKFLOW: workflowInstructionsMd };

// ─── Exports ─────────────────────────────────────────────────────

/** Claude Code SKILL.md content (deployed to ~/.claude/skills/work/SKILL.md) */
export const CLAUDE_SKILL = resolve(claudeSkillMd, withWorkflow);

/** Cursor rule content (deployed to .cursor/rules/OpenKit.mdc) */
export const CURSOR_RULE = resolve(cursorRuleMd, withWorkflow);

/** VS Code Copilot prompt content (deployed to .github/prompts/work.prompt.md) */
export const VSCODE_PROMPT = resolve(vscodePromptMd, withWorkflow);

// ─── Bundled skills ─────────────────────────────────────────────

export interface BundledSkill {
  dirName: string;
  content: string;
}

export const BUNDLED_SKILLS: BundledSkill[] = [
  { dirName: "summarize-changes", content: summarizeChangesMd },
  { dirName: "review-changes", content: reviewChangesMd },
  { dirName: "how-to-test", content: howToTestMd },
  { dirName: "write-tests", content: writeTestsMd },
  { dirName: "write-unit-tests", content: writeUnitTestsMd },
  { dirName: "write-integration-tests", content: writeIntegrationTestsMd },
  { dirName: "write-e2e-tests", content: writeE2eTestsMd },
  { dirName: "explain-like-im-5", content: explainLikeIm5Md },
  { dirName: "address-review-findings", content: addressReviewFindingsMd },
  { dirName: "work-on-task", content: workOnTaskMd },
];
