import type { WorktreeConfig, WorktreeInfo, HookStep, HookSkillRef, HooksConfig } from "../types";

export function createTestConfig(overrides: Partial<WorktreeConfig> = {}): WorktreeConfig {
  return {
    projectDir: "",
    startCommand: "pnpm dev",
    installCommand: "pnpm install",
    baseBranch: "main",
    ports: { discovered: [3000], offsetStep: 1 },
    ...overrides,
  };
}

export function createTestWorktreeInfo(overrides: Partial<WorktreeInfo> = {}): WorktreeInfo {
  return {
    id: "TEST-1",
    path: "/tmp/worktrees/TEST-1",
    branch: "TEST-1/test-branch",
    status: "stopped",
    ports: [],
    offset: null,
    pid: null,
    ...overrides,
  };
}

export function createTestHookStep(overrides: Partial<HookStep> = {}): HookStep {
  return {
    id: "step-1",
    name: "Test Step",
    command: "echo test",
    enabled: true,
    trigger: "post-implementation",
    ...overrides,
  };
}

export function createTestHookSkillRef(overrides: Partial<HookSkillRef> = {}): HookSkillRef {
  return {
    skillName: "test-skill",
    enabled: true,
    trigger: "post-implementation",
    ...overrides,
  };
}

export function createTestHooksConfig(overrides: Partial<HooksConfig> = {}): HooksConfig {
  return {
    steps: [],
    skills: [],
    ...overrides,
  };
}
