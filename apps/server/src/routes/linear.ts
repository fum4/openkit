import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { Hono } from "hono";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import {
  loadLinearCredentials,
  loadLinearProjectConfig,
  saveLinearCredentials,
  saveLinearProjectConfig,
} from "@openkit/integrations/linear/credentials";
import {
  addIssueComment,
  deleteIssueComment,
  testConnection,
  fetchIssueStatusOptions,
  fetchPriorityOptions,
  fetchStatusOptions,
  fetchIssues,
  fetchIssue,
  saveTaskData,
  updateIssueComment,
  updateIssueDescription,
  updateIssuePriority,
  updateIssueStatus,
  updateIssueTitle,
} from "@openkit/integrations/linear/api";
import type { DataLifecycleConfig } from "@openkit/integrations/linear/types";
import { log } from "@openkit/shared/logger";
import type { WorktreeManager } from "../manager";

function resolveAutoStartAgent(value: unknown): "claude" | "codex" | "gemini" | "opencode" {
  return value === "codex" || value === "gemini" || value === "opencode" ? value : "claude";
}

export function registerLinearRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/linear/status", (c) => {
    const configDir = manager.getConfigDir();
    const creds = loadLinearCredentials(configDir);
    const projectConfig = loadLinearProjectConfig(configDir);

    return c.json({
      configured: creds !== null,
      defaultTeamKey: projectConfig.defaultTeamKey ?? null,
      refreshIntervalMinutes: projectConfig.refreshIntervalMinutes ?? 5,
      displayName: creds?.displayName ?? null,
      dataLifecycle: projectConfig.dataLifecycle ?? null,
      autoStartAgent: resolveAutoStartAgent(projectConfig.autoStartAgent),
      autoStartClaudeOnNewIssue: projectConfig.autoStartClaudeOnNewIssue ?? false,
      autoStartClaudeSkipPermissions: projectConfig.autoStartClaudeSkipPermissions ?? true,
      autoStartClaudeFocusTerminal: projectConfig.autoStartClaudeFocusTerminal ?? true,
      autoUpdateIssueStatusOnAgentStart: projectConfig.autoUpdateIssueStatusOnAgentStart ?? false,
      autoUpdateIssueStatusName: projectConfig.autoUpdateIssueStatusName ?? null,
    });
  });

  app.post("/api/linear/setup", async (c) => {
    try {
      const body = await c.req.json<{ apiKey: string }>();
      if (!body.apiKey) {
        return c.json({ success: false, error: "apiKey is required" }, 400);
      }

      const configDir = manager.getConfigDir();
      const creds: { apiKey: string; displayName?: string } = { apiKey: body.apiKey };

      // Validate by making a test API call
      try {
        const viewer = await testConnection(creds);
        creds.displayName = viewer.name;
      } catch (err) {
        return c.json(
          {
            success: false,
            error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
          400,
        );
      }

      saveLinearCredentials(configDir, creds);

      // Initialize integrations.json with defaults if no config exists yet
      const existing = loadLinearProjectConfig(configDir);
      if (!existing.refreshIntervalMinutes) {
        saveLinearProjectConfig(configDir, { ...existing, refreshIntervalMinutes: 5 });
      }

      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  app.patch("/api/linear/config", async (c) => {
    try {
      const body = await c.req.json<{
        defaultTeamKey?: string;
        refreshIntervalMinutes?: number;
        dataLifecycle?: DataLifecycleConfig;
        autoStartAgent?: "claude" | "codex" | "gemini" | "opencode";
        autoStartClaudeOnNewIssue?: boolean;
        autoStartClaudeSkipPermissions?: boolean;
        autoStartClaudeFocusTerminal?: boolean;
        autoUpdateIssueStatusOnAgentStart?: boolean;
        autoUpdateIssueStatusName?: string;
      }>();
      const configDir = manager.getConfigDir();
      const current = loadLinearProjectConfig(configDir);
      if (body.defaultTeamKey !== undefined) {
        current.defaultTeamKey = body.defaultTeamKey || undefined;
      }
      if (body.refreshIntervalMinutes !== undefined) {
        current.refreshIntervalMinutes = Math.max(1, Math.min(60, body.refreshIntervalMinutes));
      }
      if (body.dataLifecycle !== undefined) {
        current.dataLifecycle = body.dataLifecycle;
      }
      if (body.autoStartAgent !== undefined) {
        current.autoStartAgent = resolveAutoStartAgent(body.autoStartAgent);
      }
      if (body.autoStartClaudeOnNewIssue !== undefined) {
        current.autoStartClaudeOnNewIssue = body.autoStartClaudeOnNewIssue;
      }
      if (body.autoStartClaudeSkipPermissions !== undefined) {
        current.autoStartClaudeSkipPermissions = body.autoStartClaudeSkipPermissions;
      }
      if (body.autoStartClaudeFocusTerminal !== undefined) {
        current.autoStartClaudeFocusTerminal = body.autoStartClaudeFocusTerminal;
      }
      if (body.autoUpdateIssueStatusOnAgentStart !== undefined) {
        current.autoUpdateIssueStatusOnAgentStart = body.autoUpdateIssueStatusOnAgentStart;
      }
      if (body.autoUpdateIssueStatusName !== undefined) {
        current.autoUpdateIssueStatusName = body.autoUpdateIssueStatusName || undefined;
      }
      saveLinearProjectConfig(configDir, current);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  app.delete("/api/linear/credentials", (c) => {
    try {
      const configDir = manager.getConfigDir();
      const intPath = path.join(configDir, CONFIG_DIR_NAME, "integrations.json");
      if (existsSync(intPath)) {
        const data = JSON.parse(readFileSync(intPath, "utf-8"));
        delete data.linear;
        writeFileSync(intPath, JSON.stringify(data, null, 2) + "\n");
      }
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to disconnect" },
        400,
      );
    }
  });

  app.get("/api/linear/issues", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) {
        return c.json({ issues: [], error: "Linear not configured" }, 400);
      }

      const projectConfig = loadLinearProjectConfig(configDir);
      const query = c.req.query("query");
      const issues = await fetchIssues(creds, projectConfig.defaultTeamKey, query || undefined);

      // Fire-and-forget: auto-cleanup cached issues whose status matches triggers
      const lifecycle = projectConfig.dataLifecycle;
      if (lifecycle?.autoCleanup?.enabled && lifecycle.autoCleanup.statusTriggers.length > 0) {
        const triggers = lifecycle.autoCleanup.statusTriggers.map((t) => t.toLowerCase());
        const liveStatusMap = new Map(issues.map((i) => [i.identifier, i.state.name]));

        const linearIssuesDir = path.join(configDir, CONFIG_DIR_NAME, "issues", "linear");
        if (existsSync(linearIssuesDir)) {
          try {
            const cachedDirs = readdirSync(linearIssuesDir, { withFileTypes: true });
            for (const dir of cachedDirs) {
              if (!dir.isDirectory()) continue;
              const issueId = dir.name;
              let status = liveStatusMap.get(issueId);
              if (!status) {
                const issueFile = path.join(linearIssuesDir, issueId, "issue.json");
                if (existsSync(issueFile)) {
                  try {
                    const cached = JSON.parse(readFileSync(issueFile, "utf-8"));
                    status = cached.status;
                  } catch {
                    /* ignore */
                  }
                }
              }
              if (status && triggers.includes(status.toLowerCase())) {
                manager
                  .cleanupIssueData("linear", issueId, lifecycle.autoCleanup.actions)
                  .catch((err) => log.warn(`Auto-cleanup failed for ${issueId}: ${err}`));
              }
            }
          } catch {
            /* ignore scan errors */
          }
        }
      }

      return c.json({ issues });
    } catch (error) {
      return c.json(
        { issues: [], error: error instanceof Error ? error.message : "Failed to fetch issues" },
        500,
      );
    }
  });

  app.get("/api/linear/issues/:identifier", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) {
        return c.json({ error: "Linear not configured" }, 400);
      }

      const identifier = c.req.param("identifier");
      const issue = await fetchIssue(identifier, creds);

      // Check saveOn preference — skip persisting when set to 'worktree-creation'
      const projectConfig = loadLinearProjectConfig(configDir);
      const saveOn = projectConfig.dataLifecycle?.saveOn ?? "view";

      if (saveOn === "view") {
        // Persist issue data to disk for TASK.md generation and MCP tools
        const tasksDir = path.join(configDir, CONFIG_DIR_NAME, "tasks");
        saveTaskData(
          {
            source: "linear",
            identifier: issue.identifier,
            title: issue.title,
            description: issue.description,
            status: issue.state.name,
            priority: issue.priority,
            priorityLabel: issue.priorityLabel,
            assignee: issue.assignee,
            labels: issue.labels,
            createdAt: issue.createdAt,
            updatedAt: issue.updatedAt,
            comments: issue.comments,
            attachments: issue.attachments,
            linkedWorktree: null,
            fetchedAt: new Date().toISOString(),
            url: issue.url,
          },
          tasksDir,
        );
      }

      return c.json({ issue });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to fetch issue" },
        error instanceof Error && error.message.includes("not found") ? 404 : 500,
      );
    }
  });

  app.get("/api/linear/status-options", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ options: [], error: "Linear not configured" }, 400);
      const config = loadLinearProjectConfig(configDir);
      const options = await fetchStatusOptions(creds, config.defaultTeamKey);
      return c.json({
        options: options.map((option) => ({
          name: option.name,
          type: option.type,
          color: option.color,
        })),
      });
    } catch (error) {
      return c.json(
        { options: [], error: error instanceof Error ? error.message : "Failed to fetch statuses" },
        500,
      );
    }
  });

  app.get("/api/linear/issues/:identifier/status-options", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ options: [], error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const options = await fetchIssueStatusOptions(creds, identifier);
      return c.json({
        options: options.map((option) => ({
          name: option.name,
          type: option.type,
          color: option.color,
        })),
      });
    } catch (error) {
      return c.json(
        { options: [], error: error instanceof Error ? error.message : "Failed to fetch statuses" },
        500,
      );
    }
  });

  app.get("/api/linear/priority-options", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ options: [], error: "Linear not configured" }, 400);
      const options = await fetchPriorityOptions(creds);
      return c.json({ options });
    } catch (error) {
      return c.json(
        {
          options: [],
          error: error instanceof Error ? error.message : "Failed to fetch Linear priority options",
        },
        500,
      );
    }
  });

  app.patch("/api/linear/issues/:identifier/status", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const body = await c.req.json<{ statusName?: string }>();
      const statusName = body.statusName?.trim();
      if (!statusName) {
        return c.json({ success: false, error: "statusName is required" }, 400);
      }
      await updateIssueStatus(creds, identifier, statusName);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update status",
        },
        500,
      );
    }
  });

  app.patch("/api/linear/issues/:identifier/priority", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const body = await c.req.json<{ priority?: number }>();
      if (typeof body.priority !== "number") {
        return c.json({ success: false, error: "priority is required" }, 400);
      }
      await updateIssuePriority(creds, identifier, body.priority);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update priority",
        },
        500,
      );
    }
  });

  app.patch("/api/linear/issues/:identifier/description", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const body = await c.req.json<{ description?: string }>();
      if (typeof body.description !== "string") {
        return c.json({ success: false, error: "description is required" }, 400);
      }
      await updateIssueDescription(creds, identifier, body.description);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update description",
        },
        500,
      );
    }
  });

  app.patch("/api/linear/issues/:identifier/title", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const body = await c.req.json<{ title?: string }>();
      const title = body.title?.trim();
      if (!title) {
        return c.json({ success: false, error: "title is required" }, 400);
      }
      await updateIssueTitle(creds, identifier, title);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update title",
        },
        500,
      );
    }
  });

  app.post("/api/linear/issues/:identifier/comments", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const identifier = c.req.param("identifier");
      const body = await c.req.json<{ comment?: string }>();
      const comment = body.comment?.trim();
      if (!comment) {
        return c.json({ success: false, error: "comment is required" }, 400);
      }
      await addIssueComment(creds, identifier, comment);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to add comment" },
        500,
      );
    }
  });

  app.patch("/api/linear/issues/:identifier/comments/:commentId", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const commentId = c.req.param("commentId");
      const body = await c.req.json<{ comment?: string }>();
      const comment = body.comment?.trim();
      if (!comment) {
        return c.json({ success: false, error: "comment is required" }, 400);
      }
      await updateIssueComment(creds, commentId, comment);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to update comment",
        },
        500,
      );
    }
  });

  app.delete("/api/linear/issues/:identifier/comments/:commentId", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadLinearCredentials(configDir);
      if (!creds) return c.json({ success: false, error: "Linear not configured" }, 400);
      const commentId = c.req.param("commentId");
      await deleteIssueComment(creds, commentId);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to delete comment",
        },
        500,
      );
    }
  });

  app.get("/api/linear/attachment", async (c) => {
    try {
      const rawUrl = c.req.query("url");
      if (!rawUrl) return c.json({ error: "url is required" }, 400);

      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        return c.json({ error: "Invalid URL" }, 400);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) {
        return c.json({ error: "Unsupported URL protocol" }, 400);
      }

      const creds = loadLinearCredentials(manager.getConfigDir());
      if (!creds) return c.json({ error: "Linear not configured" }, 400);

      const resp = await fetch(parsed.toString(), {
        headers: { Authorization: creds.apiKey },
      });
      if (!resp.ok) {
        return c.json({ error: `Failed to fetch attachment: ${resp.status}` }, resp.status as 400);
      }

      const arrayBuffer = await resp.arrayBuffer();
      const contentType = resp.headers.get("content-type") || "application/octet-stream";
      const disposition =
        resp.headers.get("content-disposition") ||
        `inline; filename="${decodeURIComponent(parsed.pathname.split("/").pop() || "attachment")}"`;

      return new Response(arrayBuffer, {
        headers: {
          "Content-Type": contentType,
          "Content-Disposition": disposition,
          "Cache-Control": "private, max-age=300",
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to fetch attachment" },
        500,
      );
    }
  });

  app.post("/api/linear/task", async (c) => {
    try {
      const body = await c.req.json<{ identifier: string; branch?: string }>();
      if (!body.identifier) {
        return c.json({ success: false, error: "Identifier is required" }, 400);
      }
      const result = await manager.createWorktreeFromLinear(body.identifier, body.branch);
      const status = result.success ? (result.reusedExisting ? 200 : 201) : 400;
      return c.json(result, status);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        },
        400,
      );
    }
  });
}
