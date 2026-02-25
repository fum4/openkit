import type { NotesManager } from "./notes-manager";
import type { WorktreeConfig } from "./types";

export type GitOperation = "commit" | "push" | "create_pr";

export interface GitPolicyResult {
  allowed: boolean;
  reason?: string;
}

const OPERATION_MAP = {
  commit: {
    configKey: "allowAgentCommits" as const,
    notesKey: "agentCommits" as const,
    label: "commits",
  },
  push: {
    configKey: "allowAgentPushes" as const,
    notesKey: "agentPushes" as const,
    label: "pushes",
  },
  create_pr: {
    configKey: "allowAgentPRs" as const,
    notesKey: "agentPRs" as const,
    label: "PR creation",
  },
};

export function resolveGitPolicy(
  operation: GitOperation,
  worktreeId: string,
  config: WorktreeConfig,
  notesManager: NotesManager,
): GitPolicyResult {
  const { configKey, notesKey, label } = OPERATION_MAP[operation];

  // Check per-worktree override via linked issue notes
  const linkMap = notesManager.buildWorktreeLinkMap();
  const linked = linkMap.get(worktreeId);

  if (linked) {
    const notes = notesManager.loadNotes(linked.source, linked.issueId);
    const override = notes.gitPolicy?.[notesKey];

    if (override === "allow") {
      return { allowed: true };
    }
    if (override === "deny") {
      return { allowed: false, reason: `Agent ${label} denied by per-worktree policy` };
    }
    // 'inherit' or undefined → fall through to global config
  }

  // Fall back to global config (default: false)
  const globalAllowed = config[configKey] === true;
  if (!globalAllowed) {
    return { allowed: false, reason: `Agent ${label} disabled in project settings` };
  }

  return { allowed: true };
}
