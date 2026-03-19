/**
 * Barrel re-exports for the agents library. Import from `@openkit/agents`
 * rather than reaching into internal module paths.
 */

export { CLAUDE_SKILL, CURSOR_RULE, VSCODE_PROMPT } from "./instructions";
export { formatTaskContext, formatTaskContextJson } from "./task-context";
export type { TaskContextData, TaskContextJsonOutput, HooksInfo } from "./task-context";
