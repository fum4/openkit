import { existsSync, readdirSync, readFileSync } from "fs";
import os from "os";
import path from "path";
import type { Hono } from "hono";

import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
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

export function registerHooksRoutes(
  app: Hono,
  _manager: WorktreeManager,
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
      const { name, command, kind, prompt, trigger, condition, conditionTitle } = await c.req.json();
      const isPrompt = kind === "prompt";
      if (!name || (!isPrompt && !command) || (isPrompt && !prompt)) {
        return c.json(
          { success: false, error: isPrompt ? "name and prompt are required" : "name and command are required" },
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
    const registryDir = path.join(os.homedir(), ".dawg", "skills");
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
      const trigger = body?.trigger as
        | "pre-implementation"
        | "post-implementation"
        | "custom"
        | "on-demand"
        | undefined;
      const run = await hooksManager.runAll(worktreeId, trigger);
      return c.json(run);
    } catch (error) {
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
      const result = await hooksManager.runSingle(worktreeId, stepId);
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

  // Agent reports a skill hook result (or start notification)
  app.post("/api/worktrees/:id/hooks/report", async (c) => {
    const worktreeId = c.req.param("id");
    try {
      const body = await c.req.json();
      const { skillName, trigger, success, summary, content, filePath } = body;
      if (!skillName) {
        return c.json({ success: false, error: "skillName is required" }, 400);
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
