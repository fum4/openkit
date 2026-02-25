import { existsSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import type { Hono } from "hono";

import { log } from "@openkit/shared/logger";
import { ACTIVITY_TYPES, type ActivityEvent } from "../activity-event";
import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
import type { HookSkillRef, HookStep, HookTrigger, SkillHookResult, StepResult } from "../types";
import type { HooksManager } from "../verification-manager";

// Minimal SKILL.md frontmatter parser (just name + description)
function parseSkillFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return { name: "", description: "" };
  let name = "";
  let description = "";
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key === "name") name = value;
    if (key === "description") description = value;
  }
  return { name, description };
}

function normalizeHookTrigger(value: unknown): HookTrigger {
  if (
    value === "pre-implementation" ||
    value === "post-implementation" ||
    value === "custom" ||
    value === "on-demand" ||
    value === "worktree-created" ||
    value === "worktree-removed"
  ) {
    return value;
  }
  return "post-implementation";
}

function matchesTrigger(step: HookStep, trigger: HookTrigger): boolean {
  if (trigger === "post-implementation") {
    return step.trigger === "post-implementation" || !step.trigger;
  }
  return step.trigger === trigger;
}

function matchesSkillTrigger(trigger: HookTrigger, skillTrigger?: HookTrigger): boolean {
  if (trigger === "post-implementation") {
    return skillTrigger === "post-implementation" || !skillTrigger;
  }
  return skillTrigger === trigger;
}

function isPromptStep(step: HookStep): boolean {
  return step.kind === "prompt" || (!!step.prompt && !step.command?.trim());
}

function isRunnableCommandStep(step: HookStep): boolean {
  return !isPromptStep(step) && !!step.command?.trim();
}

function formatHookTriggerLabel(trigger: HookTrigger): string {
  switch (trigger) {
    case "pre-implementation":
      return "Pre-Implementation";
    case "post-implementation":
      return "Post-Implementation";
    case "custom":
      return "Custom";
    case "on-demand":
      return "On-Demand";
    case "worktree-created":
      return "Worktree Created";
    case "worktree-removed":
      return "Worktree Removed";
  }
}

const WORKFLOW_PHASES = [
  "task-started",
  "pre-hooks-started",
  "pre-hooks-completed",
  "implementation-started",
  "implementation-completed",
  "post-hooks-started",
  "post-hooks-completed",
] as const;

type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

const WORKFLOW_PHASE_SET = new Set<WorkflowPhase>(WORKFLOW_PHASES);

function skillResultKey(skillName: string, trigger?: HookTrigger): string {
  return `${trigger ?? "post-implementation"}::${skillName}`;
}

function inferWorkflowPhase(event: ActivityEvent): WorkflowPhase | null {
  const phase =
    typeof event.metadata?.phase === "string" ? (event.metadata.phase as WorkflowPhase) : undefined;
  if (event.type === ACTIVITY_TYPES.WORKFLOW_PHASE && phase && WORKFLOW_PHASE_SET.has(phase)) {
    return phase;
  }

  const trigger = event.metadata?.trigger;
  if (typeof trigger !== "string") return null;
  if (event.type === ACTIVITY_TYPES.HOOKS_STARTED) {
    if (trigger === "pre-implementation") return "pre-hooks-started";
    if (trigger === "post-implementation") return "post-hooks-started";
  }
  if (event.type === ACTIVITY_TYPES.HOOKS_RAN) {
    if (trigger === "pre-implementation") return "pre-hooks-completed";
    if (trigger === "post-implementation") return "post-hooks-completed";
  }
  return null;
}

interface TriggerCompliance {
  trigger: HookTrigger;
  required: boolean;
  compliant: boolean;
  commandSteps: {
    total: number;
    passed: string[];
    failed: string[];
    missing: string[];
    running: string[];
  };
  skills: {
    total: number;
    passed: string[];
    failed: string[];
    missing: string[];
    running: string[];
  };
  promptHooks: {
    total: number;
    names: string[];
  };
}

function evaluateTriggerCompliance(
  trigger: HookTrigger,
  steps: HookStep[],
  skills: HookSkillRef[],
  stepResultById: Map<string, StepResult>,
  skillResultByKey: Map<string, SkillHookResult>,
): TriggerCompliance {
  const triggerSteps = steps.filter(
    (step) => step.enabled !== false && matchesTrigger(step, trigger),
  );
  const triggerCommandSteps = triggerSteps.filter((step) => isRunnableCommandStep(step));
  const triggerPromptSteps = triggerSteps.filter((step) => isPromptStep(step));
  const triggerSkills = skills.filter(
    (skill) => skill.enabled && matchesSkillTrigger(trigger, skill.trigger),
  );

  const commandPassed: string[] = [];
  const commandFailed: string[] = [];
  const commandMissing: string[] = [];
  const commandRunning: string[] = [];
  for (const step of triggerCommandSteps) {
    const result = stepResultById.get(step.id);
    if (!result) {
      commandMissing.push(step.name);
      continue;
    }
    if (result.status === "passed") {
      commandPassed.push(step.name);
      continue;
    }
    if (result.status === "failed") {
      commandFailed.push(step.name);
      continue;
    }
    commandRunning.push(step.name);
  }

  const skillsPassed: string[] = [];
  const skillsFailed: string[] = [];
  const skillsMissing: string[] = [];
  const skillsRunning: string[] = [];
  for (const skill of triggerSkills) {
    const key = skillResultKey(skill.skillName, skill.trigger);
    const result = skillResultByKey.get(key);
    const label = skill.skillName;
    if (!result) {
      skillsMissing.push(label);
      continue;
    }
    if (result.status === "passed") {
      skillsPassed.push(label);
      continue;
    }
    if (result.status === "failed") {
      skillsFailed.push(label);
      continue;
    }
    skillsRunning.push(label);
  }

  const required =
    triggerCommandSteps.length > 0 || triggerPromptSteps.length > 0 || triggerSkills.length > 0;

  return {
    trigger,
    required,
    compliant:
      !required ||
      (commandFailed.length === 0 &&
        commandMissing.length === 0 &&
        commandRunning.length === 0 &&
        skillsFailed.length === 0 &&
        skillsMissing.length === 0 &&
        skillsRunning.length === 0),
    commandSteps: {
      total: triggerCommandSteps.length,
      passed: commandPassed,
      failed: commandFailed,
      missing: commandMissing,
      running: commandRunning,
    },
    skills: {
      total: triggerSkills.length,
      passed: skillsPassed,
      failed: skillsFailed,
      missing: skillsMissing,
      running: skillsRunning,
    },
    promptHooks: {
      total: triggerPromptSteps.length,
      names: triggerPromptSteps.map((step) => step.name),
    },
  };
}

export function registerHooksRoutes(
  app: Hono,
  manager: WorktreeManager,
  hooksManager: HooksManager,
  notesManager: NotesManager,
) {
  // Get hooks config
  app.get("/api/hooks/config", (c) => {
    return c.json(hooksManager.getConfig());
  });

  // Get effective hooks config for a worktree (with issue overrides applied)
  app.get("/api/worktrees/:id/hooks/effective-config", (c) => {
    const worktreeId = c.req.param("id");
    const config = hooksManager.getConfig();
    const effectiveSkills = hooksManager.getEffectiveSkills(worktreeId, notesManager);
    return c.json({ ...config, skills: effectiveSkills });
  });

  // Save full config
  app.put("/api/hooks/config", async (c) => {
    try {
      const body = await c.req.json();
      const config = hooksManager.saveConfig(body);
      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  // Add a step
  app.post("/api/hooks/steps", async (c) => {
    try {
      const { name, command, kind, prompt, trigger, condition, conditionTitle } =
        await c.req.json();
      const isPrompt = kind === "prompt";
      if (!name || (!isPrompt && !command) || (isPrompt && !prompt)) {
        return c.json(
          {
            success: false,
            error: isPrompt ? "name and prompt are required" : "name and command are required",
          },
          400,
        );
      }
      const config = hooksManager.addStep(name, isPrompt ? "" : command, {
        kind,
        prompt,
        trigger,
        condition,
        conditionTitle,
      });
      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  // Update a step
  app.patch("/api/hooks/steps/:stepId", async (c) => {
    const stepId = c.req.param("stepId");
    try {
      const updates = await c.req.json();
      const config = hooksManager.updateStep(stepId, updates);
      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  // Remove a step
  app.delete("/api/hooks/steps/:stepId", (c) => {
    const stepId = c.req.param("stepId");
    const config = hooksManager.removeStep(stepId);
    return c.json({ success: true, config });
  });

  // ─── Hook Skills ─────────────────────────────────────────────

  // Import a skill into a hook
  app.post("/api/hooks/skills/import", async (c) => {
    try {
      const { skillName, trigger, condition, conditionTitle } = await c.req.json();
      if (!skillName) {
        return c.json({ success: false, error: "skillName is required" }, 400);
      }
      if (trigger === "worktree-created" || trigger === "worktree-removed") {
        return c.json(
          {
            success: false,
            error: "worktree-created/worktree-removed hooks support command steps only.",
          },
          400,
        );
      }
      const config = hooksManager.importSkill(skillName, trigger, condition, conditionTitle);
      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to import skill",
        },
        400,
      );
    }
  });

  // List registry skills (same skill can be used in multiple trigger types)
  app.get("/api/hooks/skills/available", (c) => {
    const registryDir = path.join(os.homedir(), ".openkit", "skills");
    const available: Array<{ name: string; displayName: string; description: string }> = [];

    if (existsSync(registryDir)) {
      try {
        for (const entry of readdirSync(registryDir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;

          const skillMdPath = path.join(registryDir, entry.name, "SKILL.md");
          if (!existsSync(skillMdPath)) continue;

          try {
            const content = readFileSync(skillMdPath, "utf-8");
            const { name, description } = parseSkillFrontmatter(content);
            available.push({
              name: entry.name,
              displayName: name || entry.name,
              description: description || "",
            });
          } catch {
            // Skip unreadable
          }
        }
      } catch {
        // Dir not readable
      }
    }

    return c.json({ available });
  });

  // Remove a skill from hooks (trigger query param identifies which instance)
  app.delete("/api/hooks/skills/:name", (c) => {
    const name = c.req.param("name");
    const trigger = c.req.query("trigger");
    const config = hooksManager.removeSkill(name, trigger);
    return c.json({ success: true, config });
  });

  // Toggle a skill's global enable/disable
  app.patch("/api/hooks/skills/:name", async (c) => {
    const name = c.req.param("name");
    try {
      const { enabled, trigger } = await c.req.json();
      if (typeof enabled !== "boolean") {
        return c.json({ success: false, error: "enabled (boolean) is required" }, 400);
      }
      const config = hooksManager.toggleSkill(name, enabled, trigger);
      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to toggle skill",
        },
        400,
      );
    }
  });

  // ─── Worktree hook runs ────────────────────────────────────────

  // Run all steps for a worktree
  app.post("/api/worktrees/:id/hooks/run", async (c) => {
    const worktreeId = c.req.param("id");
    try {
      const body = await c.req.json().catch(() => ({}));
      const trigger = normalizeHookTrigger(body?.trigger);
      const hooksConfig = hooksManager.getConfig();
      const hasAnyEnabledHookEntries =
        hooksConfig.steps.some((step) => step.enabled !== false && matchesTrigger(step, trigger)) ||
        hooksConfig.skills.some(
          (skill) => skill.enabled && matchesSkillTrigger(trigger, skill.trigger),
        );
      if (!hasAnyEnabledHookEntries) {
        const now = new Date().toISOString();
        return c.json({
          id: `run-${Date.now()}`,
          worktreeId,
          status: "completed",
          startedAt: now,
          completedAt: now,
          steps: [],
        });
      }

      log.info(`[hooks] API run requested (worktree=${worktreeId}, trigger=${trigger})`);
      const projectName = manager.getProjectName() ?? undefined;
      const groupKey = `hooks:${worktreeId}:${trigger}`;
      const runnableSteps = hooksConfig.steps
        .filter(
          (step) =>
            step.enabled !== false && matchesTrigger(step, trigger) && isRunnableCommandStep(step),
        )
        .map((step) => ({ stepId: step.id, stepName: step.name, command: step.command }));

      manager.getActivityLog().addEvent({
        category: "agent",
        type: "hooks_started",
        severity: "info",
        title: `${formatHookTriggerLabel(trigger)} hooks started`,
        worktreeId,
        projectName,
        groupKey,
        metadata: {
          trigger,
          commandResults: runnableSteps.map((step) => ({ ...step, status: "running" })),
        },
      });

      const run = await hooksManager.runAll(worktreeId, trigger);
      const runnableStepIds = new Set(runnableSteps.map((step) => step.stepId));
      const triggerSteps = run.steps.filter((step) => runnableStepIds.has(step.stepId));
      const failedCount = triggerSteps.filter((step) => step.status === "failed").length;
      const severity = failedCount > 0 || run.status === "failed" ? "error" : "success";
      const detail =
        triggerSteps.length === 0
          ? "No runnable command hooks configured for this trigger."
          : failedCount > 0
            ? `${failedCount} of ${triggerSteps.length} command hooks failed.`
            : `${triggerSteps.length} command hooks passed.`;

      manager.getActivityLog().addEvent({
        category: "agent",
        type: "hooks_ran",
        severity,
        title: `${formatHookTriggerLabel(trigger)} hooks completed`,
        detail,
        worktreeId,
        projectName,
        groupKey,
        metadata: { trigger, commandResults: triggerSteps },
      });
      log.info(
        `[hooks] API run completed (worktree=${worktreeId}, trigger=${trigger}, status=${run.status}, steps=${triggerSteps.length}, failed=${failedCount})`,
      );

      return c.json(run);
    } catch (error) {
      log.warn(
        `[hooks] API run failed (worktree=${worktreeId}): ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to run hooks" },
        500,
      );
    }
  });

  // Run a single step for a worktree
  app.post("/api/worktrees/:id/hooks/run/:stepId", async (c) => {
    const worktreeId = c.req.param("id");
    const stepId = c.req.param("stepId");
    try {
      const step = hooksManager.getConfig().steps.find((s) => s.id === stepId);
      const trigger = normalizeHookTrigger(step?.trigger);
      const projectName = manager.getProjectName() ?? undefined;
      const groupKey = `hooks:${worktreeId}:${trigger}`;

      if (step && step.enabled !== false && isRunnableCommandStep(step)) {
        manager.getActivityLog().addEvent({
          category: "agent",
          type: "hooks_started",
          severity: "info",
          title: `${formatHookTriggerLabel(trigger)} hooks started`,
          worktreeId,
          projectName,
          groupKey,
          metadata: {
            trigger,
            commandResults: [
              {
                stepId: step.id,
                stepName: step.name,
                command: step.command,
                status: "running",
              },
            ],
          },
        });
      }

      const result = await hooksManager.runSingle(worktreeId, stepId);

      const severity = result.status === "failed" ? "error" : "success";
      const detail =
        result.status === "failed" ? "1 of 1 command hooks failed." : "1 command hooks passed.";

      manager.getActivityLog().addEvent({
        category: "agent",
        type: "hooks_ran",
        severity,
        title: `${formatHookTriggerLabel(trigger)} hooks completed`,
        detail,
        worktreeId,
        projectName,
        groupKey,
        metadata: {
          trigger,
          commandResults: [
            {
              stepId: result.stepId,
              stepName: result.stepName,
              command: result.command,
              status: result.status,
              output: result.output,
              startedAt: result.startedAt,
              completedAt: result.completedAt,
              durationMs: result.durationMs,
            },
          ],
        },
      });

      return c.json(result);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to run step" },
        500,
      );
    }
  });

  // Get current run status
  app.get("/api/worktrees/:id/hooks/status", (c) => {
    const worktreeId = c.req.param("id");
    const status = hooksManager.getStatus(worktreeId);
    return c.json({ status });
  });

  app.get("/api/worktrees/:id/flow-compliance", (c) => {
    const worktreeId = c.req.param("id");
    const config = hooksManager.getConfig();
    const effectiveSkills = hooksManager.getEffectiveSkills(worktreeId, notesManager);
    const runStatus = hooksManager.getStatus(worktreeId);
    const stepResultById = new Map<string, StepResult>();
    for (const result of runStatus?.steps ?? []) {
      stepResultById.set(result.stepId, result);
    }
    const skillResultByKey = new Map<string, SkillHookResult>();
    for (const result of hooksManager.getSkillResults(worktreeId)) {
      skillResultByKey.set(skillResultKey(result.skillName, result.trigger), result);
    }

    const activityEvents = manager
      .getActivityLog()
      .getEvents({ limit: 1000 })
      .filter((event) => event.worktreeId === worktreeId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

    const phaseSeen: Partial<Record<WorkflowPhase, string>> = {};
    for (const event of activityEvents) {
      const phase = inferWorkflowPhase(event);
      if (phase && !phaseSeen[phase]) {
        phaseSeen[phase] = event.timestamp;
      }
    }

    const missingPhases = WORKFLOW_PHASES.filter((phase) => !phaseSeen[phase]);
    const outOfOrder: Array<{ previous: WorkflowPhase; current: WorkflowPhase }> = [];
    for (let idx = 1; idx < WORKFLOW_PHASES.length; idx++) {
      const previous = WORKFLOW_PHASES[idx - 1];
      const current = WORKFLOW_PHASES[idx];
      const previousTs = phaseSeen[previous];
      const currentTs = phaseSeen[current];
      if (!previousTs || !currentTs) continue;
      if (new Date(previousTs).getTime() > new Date(currentTs).getTime()) {
        outOfOrder.push({ previous, current });
      }
    }

    const worktreeCreated = evaluateTriggerCompliance(
      "worktree-created",
      config.steps,
      effectiveSkills,
      stepResultById,
      skillResultByKey,
    );
    const preImplementation = evaluateTriggerCompliance(
      "pre-implementation",
      config.steps,
      effectiveSkills,
      stepResultById,
      skillResultByKey,
    );
    const postImplementation = evaluateTriggerCompliance(
      "post-implementation",
      config.steps,
      effectiveSkills,
      stepResultById,
      skillResultByKey,
    );

    const missingActions = new Set<string>();
    for (const phase of missingPhases) {
      missingActions.add(
        `Emit workflow phase "${phase}" (openkit activity phase --phase ${phase} --worktree ${worktreeId}).`,
      );
    }
    for (const { previous, current } of outOfOrder) {
      missingActions.add(
        `Workflow phases are out of order (${previous} after ${current}); rerun and emit phases in canonical order.`,
      );
    }

    const addTriggerActions = (check: TriggerCompliance) => {
      if (!check.required) return;
      const label = formatHookTriggerLabel(check.trigger);
      for (const stepName of check.commandSteps.missing) {
        missingActions.add(`Run ${label} command hook "${stepName}".`);
      }
      for (const stepName of check.commandSteps.running) {
        missingActions.add(`Wait for ${label} command hook "${stepName}" to finish.`);
      }
      for (const stepName of check.commandSteps.failed) {
        missingActions.add(`Fix and rerun failed ${label} command hook "${stepName}".`);
      }
      for (const skillName of check.skills.missing) {
        missingActions.add(`Run and report ${label} skill "${skillName}".`);
      }
      for (const skillName of check.skills.running) {
        missingActions.add(`Wait for ${label} skill "${skillName}" to finish reporting.`);
      }
      for (const skillName of check.skills.failed) {
        missingActions.add(`Fix and rerun failed ${label} skill "${skillName}".`);
      }
    };

    addTriggerActions(worktreeCreated);
    addTriggerActions(preImplementation);
    addTriggerActions(postImplementation);

    const warnings: string[] = [];
    if (preImplementation.promptHooks.total > 0) {
      warnings.push(
        "Pre-implementation prompt hooks require agent execution; validate via phase events and final summary evidence.",
      );
    }
    if (postImplementation.promptHooks.total > 0) {
      warnings.push(
        "Post-implementation prompt hooks require agent execution; validate via phase events and final summary evidence.",
      );
    }

    const compliant =
      missingActions.size === 0 &&
      worktreeCreated.compliant &&
      preImplementation.compliant &&
      postImplementation.compliant;

    return c.json({
      success: true,
      report: {
        worktreeId,
        evaluatedAt: new Date().toISOString(),
        compliant,
        phases: {
          required: WORKFLOW_PHASES,
          seen: phaseSeen,
          missing: missingPhases,
          outOfOrder,
        },
        hooks: {
          worktreeCreated,
          preImplementation,
          postImplementation,
        },
        warnings,
        missingActions: Array.from(missingActions),
      },
    });
  });

  // Agent reports a skill hook result (or start notification)
  app.post("/api/worktrees/:id/hooks/report", async (c) => {
    const worktreeId = c.req.param("id");
    try {
      const body = await c.req.json();
      const { skillName, trigger, success, summary, content, filePath } = body;
      if (!skillName) {
        return c.json({ success: false, error: "skillName is required" }, 400);
      }
      if (trigger === "worktree-created" || trigger === "worktree-removed") {
        return c.json(
          {
            success: false,
            error: "Lifecycle hooks are command-only; skill status reporting is not supported.",
          },
          400,
        );
      }

      if (success === undefined || success === null) {
        // Starting notification — mark as running
        hooksManager.reportSkillResult(worktreeId, {
          skillName,
          trigger,
          status: "running",
          reportedAt: new Date().toISOString(),
        });
      } else {
        if (typeof success !== "boolean") {
          return c.json({ success: false, error: "success must be a boolean" }, 400);
        }
        hooksManager.reportSkillResult(worktreeId, {
          skillName,
          trigger,
          status: success ? "passed" : "failed",
          success,
          summary: summary || undefined,
          content: content || undefined,
          filePath: filePath || undefined,
          reportedAt: new Date().toISOString(),
        });
      }
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to report result",
        },
        400,
      );
    }
  });

  // Get skill hook results for a worktree
  app.get("/api/worktrees/:id/hooks/skill-results", (c) => {
    const worktreeId = c.req.param("id");
    const results = hooksManager.getSkillResults(worktreeId);
    return c.json({ results });
  });

  // Read a file by absolute path (used by the frontend to preview MD skill reports)
  app.get("/api/files/read", (c) => {
    const filePath = c.req.query("path");
    if (!filePath) {
      return c.json({ error: "path query parameter is required" }, 400);
    }
    if (!existsSync(filePath)) {
      return c.json({ error: "File not found" }, 404);
    }
    try {
      const content = readFileSync(filePath, "utf-8");
      return c.json({ content });
    } catch {
      return c.json({ error: "Failed to read file" }, 500);
    }
  });
}
