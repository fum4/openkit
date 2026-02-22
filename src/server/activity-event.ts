export type ActivityCategory = "agent" | "worktree" | "system";
export type ActivitySeverity = "info" | "success" | "warning" | "error";

export interface ActivityEvent {
  id: string;
  timestamp: string;
  category: ActivityCategory;
  type: string;
  severity: ActivitySeverity;
  title: string;
  detail?: string;
  worktreeId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
  groupKey?: string;
}

// Event type constants for type safety
export const ACTIVITY_TYPES = {
  // Agent events
  AGENT_CONNECTED: "agent_connected",
  AGENT_DISCONNECTED: "agent_disconnected",
  NOTIFY: "notify",
  COMMIT_COMPLETED: "commit_completed",
  COMMIT_FAILED: "commit_failed",
  PUSH_COMPLETED: "push_completed",
  PUSH_FAILED: "push_failed",
  PR_CREATED: "pr_created",
  SKILL_STARTED: "skill_started",
  SKILL_COMPLETED: "skill_completed",
  SKILL_FAILED: "skill_failed",
  HOOKS_STARTED: "hooks_started",
  HOOKS_RAN: "hooks_ran",
  TASK_DETECTED: "task_detected",
  AUTO_TASK_CLAIMED: "auto_task_claimed",
  AGENT_AWAITING_INPUT: "agent_awaiting_input",
  WORKFLOW_PHASE: "workflow_phase",

  // Worktree events
  CREATION_STARTED: "creation_started",
  CREATION_COMPLETED: "creation_completed",
  CREATION_FAILED: "creation_failed",
  WORKTREE_STARTED: "started",
  WORKTREE_STOPPED: "stopped",
  WORKTREE_CRASHED: "crashed",

  // System events
  CONNECTION_LOST: "connection_lost",
  CONNECTION_RESTORED: "connection_restored",
  CONFIG_NEEDS_PUSH: "config_needs_push",
} as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[keyof typeof ACTIVITY_TYPES];

export interface ActivityConfig {
  retentionDays: number;
  categories: Record<ActivityCategory, boolean>;
  disabledEvents: string[];
  toastEvents: string[];
  osNotificationEvents: string[];
}

export const DEFAULT_ACTIVITY_CONFIG: ActivityConfig = {
  retentionDays: 7,
  categories: {
    agent: true,
    worktree: true,
    system: true,
  },
  disabledEvents: [],
  toastEvents: [
    "creation_started",
    "creation_completed",
    "creation_failed",
    "skill_started",
    "skill_completed",
    "skill_failed",
    "crashed",
    "connection_lost",
  ],
  osNotificationEvents: ["agent_awaiting_input"],
};
