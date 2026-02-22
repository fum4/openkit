import path from "path";
import { Hono } from "hono";

import { CONFIG_DIR_NAME } from "../../constants";
import type { WorktreeManager } from "../manager";
import type { IssueSource, NotesManager } from "../notes-manager";
import { regenerateTaskMd } from "../task-context";
import type { HooksManager } from "../verification-manager";

export function registerNotesRoutes(
  app: Hono,
  manager: WorktreeManager,
  notesManager: NotesManager,
  hooksManager?: HooksManager,
) {
  const configDir = manager.getConfigDir();
  const worktreesPath = path.join(configDir, CONFIG_DIR_NAME, "worktrees");
  const getHooksSnapshot = (worktreeId: string) => {
    if (!hooksManager) return undefined;
    const config = hooksManager.getConfig();
    const effectiveSkills = hooksManager.getEffectiveSkills(worktreeId, notesManager);
    return {
      checks: config.steps,
      skills: effectiveSkills,
    };
  };

  // Get notes for an issue
  app.get("/api/notes/:source/:id", (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const notes = notesManager.loadNotes(source, id);
    return c.json(notes);
  });

  // Update a notes section
  app.put("/api/notes/:source/:id", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const body = await c.req.json<{ section: string; content: string }>();
    if (!body.section || !["personal", "aiContext"].includes(body.section)) {
      return c.json({ error: 'Invalid section (must be "personal" or "aiContext")' }, 400);
    }
    if (typeof body.content !== "string") {
      return c.json({ error: "Content must be a string" }, 400);
    }

    const notes = notesManager.updateSection(
      source,
      id,
      body.section as "personal" | "aiContext",
      body.content,
    );

    // Regenerate TASK.md in linked worktree when aiContext changes
    if (body.section === "aiContext" && notes.linkedWorktreeId) {
      try {
        regenerateTaskMd(
          source,
          id,
          notes.linkedWorktreeId,
          notesManager,
          configDir,
          worktreesPath,
          getHooksSnapshot(notes.linkedWorktreeId),
        );
      } catch {
        // Non-critical — don't fail the notes update
      }
    }

    return c.json(notes);
  });

  // Add a todo
  app.post("/api/notes/:source/:id/todos", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const body = await c.req.json<{ text: string }>();
    if (!body.text || typeof body.text !== "string") {
      return c.json({ error: "Text is required" }, 400);
    }

    const notes = notesManager.addTodo(source, id, body.text);

    if (notes.linkedWorktreeId) {
      try {
        regenerateTaskMd(
          source,
          id,
          notes.linkedWorktreeId,
          notesManager,
          configDir,
          worktreesPath,
          getHooksSnapshot(notes.linkedWorktreeId),
        );
      } catch {
        /* non-critical */
      }
    }

    return c.json(notes);
  });

  // Update a todo
  app.patch("/api/notes/:source/:id/todos/:todoId", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");
    const todoId = c.req.param("todoId");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const body = await c.req.json<{ text?: string; checked?: boolean }>();

    try {
      const notes = notesManager.updateTodo(source, id, todoId, body);

      if (notes.linkedWorktreeId) {
        try {
          regenerateTaskMd(
            source,
            id,
            notes.linkedWorktreeId,
            notesManager,
            configDir,
            worktreesPath,
            getHooksSnapshot(notes.linkedWorktreeId),
          );
        } catch {
          /* non-critical */
        }
      }

      return c.json(notes);
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "Failed to update todo" }, 404);
    }
  });

  // Update git policy for an issue
  app.patch("/api/notes/:source/:id/git-policy", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const body = await c.req.json<{
      agentCommits?: string;
      agentPushes?: string;
      agentPRs?: string;
    }>();
    const validValues = ["inherit", "allow", "deny"];
    for (const key of ["agentCommits", "agentPushes", "agentPRs"] as const) {
      if (body[key] && !validValues.includes(body[key]!)) {
        return c.json({ error: `Invalid ${key} value` }, 400);
      }
    }

    const notes = notesManager.updateGitPolicy(
      source,
      id,
      body as Parameters<typeof notesManager.updateGitPolicy>[2],
    );
    return c.json(notes);
  });

  // Update hook skill overrides for an issue
  app.patch("/api/notes/:source/:id/hook-skills", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const body = await c.req.json<Record<string, string>>();
    const validValues = ["inherit", "enable", "disable"];
    for (const [key, value] of Object.entries(body)) {
      if (!validValues.includes(value)) {
        return c.json({ error: `Invalid value for ${key}: ${value}` }, 400);
      }
    }

    const notes = notesManager.updateHookSkills(
      source,
      id,
      body as Record<string, "inherit" | "enable" | "disable">,
    );

    // Regenerate TASK.md in linked worktree when hook skills change
    if (notes.linkedWorktreeId && hooksManager) {
      try {
        regenerateTaskMd(
          source,
          id,
          notes.linkedWorktreeId,
          notesManager,
          configDir,
          worktreesPath,
          getHooksSnapshot(notes.linkedWorktreeId),
        );
      } catch {
        // Non-critical
      }
    }

    return c.json(notes);
  });

  // Delete a todo
  app.delete("/api/notes/:source/:id/todos/:todoId", async (c) => {
    const source = c.req.param("source") as IssueSource;
    const id = c.req.param("id");
    const todoId = c.req.param("todoId");

    if (!["jira", "linear", "local"].includes(source)) {
      return c.json({ error: "Invalid source" }, 400);
    }

    const notes = notesManager.deleteTodo(source, id, todoId);

    if (notes.linkedWorktreeId) {
      try {
        regenerateTaskMd(
          source,
          id,
          notes.linkedWorktreeId,
          notesManager,
          configDir,
          worktreesPath,
          getHooksSnapshot(notes.linkedWorktreeId),
        );
      } catch {
        /* non-critical */
      }
    }

    return c.json(notes);
  });
}
