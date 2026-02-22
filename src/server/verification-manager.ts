import { execFile as execFileCb } from "child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { promisify } from "util";

import { CONFIG_DIR_NAME } from "../constants";
import { log } from "../logger";
import type { WorktreeManager } from "./manager";
import type { NotesManager } from "./notes-manager";
import type {
  HookTrigger,
  HookStep,
  HookSkillRef,
  HooksConfig,
  PipelineRun,
  SkillHookResult,
  StepResult,
  WorktreeLifecycleHookTrigger,
} from "./types";

const execFile = promisify(execFileCb);

function defaultConfig(): HooksConfig {
  return { steps: [], skills: [] };
}

let stepCounter = 0;

export class HooksManager {
  constructor(private manager: WorktreeManager) {}

  // ─── Config ─────────────────────────────────────────────────────

  private isLifecycleTrigger(trigger: HookTrigger | undefined): boolean {
    return trigger === "worktree-created" || trigger === "worktree-removed";
  }

  private configPath(): string {
    return path.join(this.manager.getConfigDir(), CONFIG_DIR_NAME, "hooks.json");
  }

  getConfig(): HooksConfig {
    const p = this.configPath();
    if (!existsSync(p)) return defaultConfig();
    try {
      const raw = JSON.parse(readFileSync(p, "utf-8"));
      raw.skills = (raw.skills ?? []).filter(
        (skill: HookSkillRef) => !this.isLifecycleTrigger(skill.trigger),
      );
      raw.steps = (raw.steps ?? []).map((step: HookStep) => {
        const isPrompt = step.kind === "prompt" || (!!step.prompt && !step.command);
        if (isPrompt) {
          return {
            ...step,
            kind: "prompt",
            command: step.command ?? "",
          };
        }
        return {
          ...step,
          kind: "command",
          command: step.command ?? "",
        };
      });
      return raw;
    } catch {
      return defaultConfig();
    }
  }

  saveConfig(config: HooksConfig): HooksConfig {
    const sanitized: HooksConfig = {
      ...config,
      skills: (config.skills ?? []).filter((skill) => !this.isLifecycleTrigger(skill.trigger)),
    };
    const dir = path.dirname(this.configPath());
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.configPath(), JSON.stringify(sanitized, null, 2) + "\n");
    return sanitized;
  }

  addStep(
    name: string,
    command: string,
    options?: {
      kind?: HookStep["kind"];
      prompt?: string;
      trigger?: HookStep["trigger"];
      condition?: string;
      conditionTitle?: string;
    },
  ): HooksConfig {
    const config = this.getConfig();
    const id = `step-${Date.now()}-${++stepCounter}`;
    config.steps.push({
      id,
      name,
      command,
      kind: options?.kind,
      prompt: options?.prompt,
      trigger: options?.trigger,
      condition: options?.condition,
      conditionTitle: options?.conditionTitle,
      enabled: true,
    });
    return this.saveConfig(config);
  }

  removeStep(stepId: string): HooksConfig {
    const config = this.getConfig();
    config.steps = config.steps.filter((s) => s.id !== stepId);
    return this.saveConfig(config);
  }

  updateStep(
    stepId: string,
    updates: Partial<
      Pick<HookStep, "name" | "command" | "prompt" | "kind" | "enabled" | "trigger" | "condition">
    >,
  ): HooksConfig {
    const config = this.getConfig();
    const step = config.steps.find((s) => s.id === stepId);
    if (step) {
      if (updates.name !== undefined) step.name = updates.name;
      if (updates.command !== undefined) step.command = updates.command;
      if (updates.prompt !== undefined) step.prompt = updates.prompt;
      if (updates.kind !== undefined) step.kind = updates.kind;
      if (updates.enabled !== undefined) step.enabled = updates.enabled;
      if (updates.trigger !== undefined) step.trigger = updates.trigger;
      if (updates.condition !== undefined) step.condition = updates.condition;
    }
    return this.saveConfig(config);
  }

  // ─── Skill management ───────────────────────────────────────

  importSkill(
    skillName: string,
    trigger?: string,
    condition?: string,
    conditionTitle?: string,
  ): HooksConfig {
    const config = this.getConfig();
    if (this.isLifecycleTrigger(trigger as HookTrigger | undefined)) {
      return config;
    }
    const effectiveTrigger = trigger ?? "post-implementation";
    // Allow same skill in different triggers
    if (
      config.skills.some(
        (s) =>
          s.skillName === skillName && (s.trigger ?? "post-implementation") === effectiveTrigger,
      )
    ) {
      return config;
    }
    const entry: HookSkillRef = { skillName, enabled: true };
    if (trigger) entry.trigger = trigger as HookSkillRef["trigger"];
    if (condition) entry.condition = condition;
    if (conditionTitle) entry.conditionTitle = conditionTitle;
    config.skills.push(entry);
    return this.saveConfig(config);
  }

  removeSkill(skillName: string, trigger?: string): HooksConfig {
    const config = this.getConfig();
    const effectiveTrigger = trigger ?? "post-implementation";
    config.skills = config.skills.filter(
      (s) =>
        !(s.skillName === skillName && (s.trigger ?? "post-implementation") === effectiveTrigger),
    );
    return this.saveConfig(config);
  }

  toggleSkill(skillName: string, enabled: boolean, trigger?: string): HooksConfig {
    const config = this.getConfig();
    const effectiveTrigger = trigger ?? "post-implementation";
    const skill = config.skills.find(
      (s) => s.skillName === skillName && (s.trigger ?? "post-implementation") === effectiveTrigger,
    );
    if (skill) skill.enabled = enabled;
    return this.saveConfig(config);
  }

  getEffectiveSkills(worktreeId: string, notesManager: NotesManager): HookSkillRef[] {
    const config = this.getConfig();

    // Find linked issue for this worktree
    const linkMap = notesManager.buildWorktreeLinkMap();
    const linked = linkMap.get(worktreeId);
    const overrides = linked
      ? (notesManager.loadNotes(linked.source, linked.issueId).hookSkills ?? {})
      : {};

    return config.skills.map((skill) => {
      const trigger = skill.trigger ?? "post-implementation";
      const override = overrides[`${trigger}:${skill.skillName}`];
      if (override === "enable") return { ...skill, enabled: true };
      if (override === "disable") return { ...skill, enabled: false };
      return skill; // 'inherit' or not set
    });
  }

  // ─── Skill results ─────────────────────────────────────────

  private skillResultsPath(worktreeId: string): string {
    return path.join(
      this.manager.getConfigDir(),
      CONFIG_DIR_NAME,
      "worktrees",
      worktreeId,
      "hooks",
      "skill-results.json",
    );
  }

  reportSkillResult(worktreeId: string, result: SkillHookResult): void {
    const resultsPath = this.skillResultsPath(worktreeId);
    this.ensureDir(path.dirname(resultsPath));

    const existing = this.getSkillResults(worktreeId);
    const resultTrigger = result.trigger ?? "post-implementation";
    // Replace existing result for same skill, or append
    const idx = existing.findIndex(
      (r) =>
        r.skillName === result.skillName &&
        (r.trigger ?? "post-implementation") === (resultTrigger ?? "post-implementation"),
    );
    if (idx >= 0) {
      existing[idx] = { ...result, trigger: resultTrigger };
    } else {
      existing.push({ ...result, trigger: resultTrigger });
    }
    writeFileSync(resultsPath, JSON.stringify(existing, null, 2) + "\n");

    // Notify the frontend via SSE
    this.manager.emitHookUpdate(worktreeId);
  }

  getSkillResults(worktreeId: string): SkillHookResult[] {
    const resultsPath = this.skillResultsPath(worktreeId);
    if (!existsSync(resultsPath)) return [];
    try {
      return JSON.parse(readFileSync(resultsPath, "utf-8"));
    } catch {
      return [];
    }
  }

  // ─── Run file ─────────────────────────────────────────────────

  private runFilePath(worktreeId: string): string {
    return path.join(
      this.manager.getConfigDir(),
      CONFIG_DIR_NAME,
      "worktrees",
      worktreeId,
      "hooks",
      "latest-run.json",
    );
  }

  private ensureDir(dirPath: string): void {
    if (!existsSync(dirPath)) mkdirSync(dirPath, { recursive: true });
  }

  // ─── Execution ────────────────────────────────────────────────

  private matchesTrigger(step: HookStep, trigger: HookTrigger): boolean {
    if (trigger === "post-implementation") {
      return step.trigger === "post-implementation" || !step.trigger;
    }
    return step.trigger === trigger;
  }

  private isPromptStep(step: HookStep): boolean {
    return step.kind === "prompt" || (!!step.prompt && !step.command?.trim());
  }

  private isRunnableCommandStep(step: HookStep): boolean {
    return !this.isPromptStep(step) && !!step.command?.trim();
  }

  async runWorktreeLifecycleCommands(
    trigger: WorktreeLifecycleHookTrigger,
    worktreeId: string,
    worktreePath?: string,
  ): Promise<StepResult[]> {
    const config = this.getConfig();
    const enabledSteps = config.steps.filter(
      (step) =>
        step.enabled !== false && this.matchesTrigger(step, trigger) && this.isRunnableCommandStep(step),
    );
    if (enabledSteps.length === 0) return [];

    const executionCwd =
      trigger === "worktree-created" && worktreePath && existsSync(worktreePath)
        ? worktreePath
        : this.manager.getGitRoot();

    const env: NodeJS.ProcessEnv = {
      OPENKIT_HOOK_TRIGGER: trigger,
      OPENKIT_WORKTREE_ID: worktreeId,
      ...(worktreePath ? { OPENKIT_WORKTREE_PATH: worktreePath } : {}),
    };

    const results = await Promise.all(
      enabledSteps.map((step) => this.executeStep(step, executionCwd, env)),
    );
    // Persist lifecycle command results so they appear in the worktree Hooks tab
    // alongside pre/post/custom/on-demand runs.
    this.mergeAndPersistRun(worktreeId, results);

    const failed = results.filter((result) => result.status === "failed");
    if (failed.length > 0) {
      log.warn(
        `Lifecycle hooks (${trigger}) had ${failed.length} failure(s) for worktree "${worktreeId}"`,
      );
    }

    return results;
  }

  async runAll(
    worktreeId: string,
    trigger: HookTrigger = "post-implementation",
  ): Promise<PipelineRun> {
    const config = this.getConfig();
    const enabledSteps = config.steps.filter(
      (s) =>
        s.enabled !== false && this.matchesTrigger(s, trigger) && this.isRunnableCommandStep(s),
    );
    if (enabledSteps.length === 0) {
      const existing = this.getStatus(worktreeId);
      if (existing) return existing;
      const run = this.makeRun(worktreeId, "completed", []);
      this.persistRun(worktreeId, run);
      return run;
    }

    const wt = this.manager.getWorktrees().find((w) => w.id === worktreeId);
    if (!wt) {
      return this.makeRun(worktreeId, "failed", [
        {
          stepId: "_error",
          stepName: "Error",
          command: "",
          status: "failed",
          output: `Worktree "${worktreeId}" not found`,
        },
      ]);
    }

    const runStartedAt = new Date().toISOString();
    const existing = this.getStatus(worktreeId);
    const existingSteps = existing?.steps ?? [];
    const enabledStepIds = new Set(enabledSteps.map((step) => step.id));
    const stepConfigById = new Map(config.steps.map((step) => [step.id, step] as const));
    const preservedLifecycleSteps = existingSteps.filter((step) => {
      if (enabledStepIds.has(step.stepId)) return false;
      const configStep = stepConfigById.get(step.stepId);
      return (
        configStep?.trigger === "worktree-created" || configStep?.trigger === "worktree-removed"
      );
    });
    const runningRun: PipelineRun = {
      id: `run-${Date.now()}`,
      worktreeId,
      status: "running",
      startedAt: runStartedAt,
      steps: [
        ...preservedLifecycleSteps,
        ...enabledSteps.map((step) => ({
          stepId: step.id,
          stepName: step.name,
          command: step.command,
          status: "running" as const,
          startedAt: runStartedAt,
        })),
      ],
    };
    this.persistRun(worktreeId, runningRun);

    // Run all enabled steps in parallel and persist each completion immediately
    await Promise.all(
      enabledSteps.map(async (step) => {
        const result = await this.executeStep(step, wt.path);
        this.mergeAndPersistRun(worktreeId, [result]);
      }),
    );

    return this.getStatus(worktreeId) ?? this.makeRun(worktreeId, "failed", []);
  }

  async runSingle(worktreeId: string, stepId: string): Promise<StepResult> {
    const config = this.getConfig();
    const step = config.steps.find((s) => s.id === stepId);
    if (!step) {
      return {
        stepId,
        stepName: "Unknown",
        command: "",
        status: "failed",
        output: `Step "${stepId}" not found`,
      };
    }

    const wt = this.manager.getWorktrees().find((w) => w.id === worktreeId);
    if (!wt) {
      return {
        stepId,
        stepName: step.name,
        command: step.command,
        status: "failed",
        output: `Worktree "${worktreeId}" not found`,
      };
    }

    if (this.isPromptStep(step)) {
      return {
        stepId,
        stepName: step.name,
        command: step.command,
        status: "failed",
        output: "Prompt hooks are interpreted by agents and cannot be run as shell commands.",
      };
    }

    const result = await this.executeStep(step, wt.path);
    this.mergeAndPersistRun(worktreeId, [result]);
    return result;
  }

  private async executeStep(
    step: HookStep,
    worktreePath: string,
    extraEnv?: NodeJS.ProcessEnv,
  ): Promise<StepResult> {
    const startedAt = new Date().toISOString();
    const start = Date.now();

    const parts = step.command.split(/\s+/);
    const bin = parts[0];
    const args = parts.slice(1);

    try {
      const { stdout, stderr } = await execFile(bin, args, {
        cwd: worktreePath,
        timeout: 120_000,
        env: { ...process.env, ...extraEnv, FORCE_COLOR: "0" },
      });
      const output = [stdout, stderr].filter(Boolean).join("\n").trim();
      return {
        stepId: step.id,
        stepName: step.name,
        command: step.command,
        status: "passed",
        output: output || "(no output)",
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    } catch (err) {
      const execErr = err as { stdout?: string; stderr?: string; message?: string };
      const output =
        [execErr.stdout, execErr.stderr].filter(Boolean).join("\n").trim() ||
        execErr.message ||
        "Unknown error";
      return {
        stepId: step.id,
        stepName: step.name,
        command: step.command,
        status: "failed",
        output,
        startedAt,
        completedAt: new Date().toISOString(),
        durationMs: Date.now() - start,
      };
    }
  }

  // ─── Status ───────────────────────────────────────────────────

  getStatus(worktreeId: string): PipelineRun | null {
    const runPath = this.runFilePath(worktreeId);
    if (!existsSync(runPath)) return null;
    try {
      return JSON.parse(readFileSync(runPath, "utf-8"));
    } catch {
      return null;
    }
  }

  // ─── Helpers ──────────────────────────────────────────────────

  private makeRun(
    worktreeId: string,
    status: PipelineRun["status"],
    steps: StepResult[],
  ): PipelineRun {
    return {
      id: `run-${Date.now()}`,
      worktreeId,
      status,
      startedAt: new Date().toISOString(),
      completedAt: status !== "running" ? new Date().toISOString() : undefined,
      steps,
    };
  }

  private persistRun(worktreeId: string, run: PipelineRun): void {
    const runPath = this.runFilePath(worktreeId);
    this.ensureDir(path.dirname(runPath));
    writeFileSync(runPath, JSON.stringify(run, null, 2) + "\n");
    this.manager.emitHookUpdate(worktreeId);
  }

  private mergeAndPersistRun(worktreeId: string, updates: StepResult[]): PipelineRun {
    const existing = this.getStatus(worktreeId);
    const mergedById = new Map<string, StepResult>();

    for (const step of existing?.steps ?? []) mergedById.set(step.stepId, step);
    for (const step of updates) mergedById.set(step.stepId, step);

    const mergedSteps = Array.from(mergedById.values());
    const hasFailed = mergedSteps.some((step) => step.status === "failed");
    const hasRunning = mergedSteps.some((step) => step.status === "running");
    const status: PipelineRun["status"] = hasRunning
      ? "running"
      : hasFailed
        ? "failed"
        : "completed";

    const run: PipelineRun = {
      id: `run-${Date.now()}`,
      worktreeId,
      status,
      startedAt: existing?.startedAt ?? new Date().toISOString(),
      completedAt: status === "running" ? undefined : new Date().toISOString(),
      steps: mergedSteps,
    };

    this.persistRun(worktreeId, run);
    return run;
  }
}
