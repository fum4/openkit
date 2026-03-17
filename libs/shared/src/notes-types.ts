export type IssueSource = "jira" | "linear" | "local";

export type GitPolicyOverride = "inherit" | "allow" | "deny";

export interface TodoItem {
  id: string;
  text: string;
  checked: boolean;
  createdAt: string;
}

export type HookSkillOverride = "inherit" | "enable" | "disable";

export interface IssueNotes {
  linkedWorktreeId: string | null;
  personal: { content: string; updatedAt: string } | null;
  aiContext: { content: string; updatedAt: string } | null;
  todos: TodoItem[];
  gitPolicy?: {
    agentCommits?: GitPolicyOverride;
    agentPushes?: GitPolicyOverride;
    agentPRs?: GitPolicyOverride;
  };
  hookSkills?: Record<string, HookSkillOverride>;
}
