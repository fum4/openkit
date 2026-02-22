import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { Hono } from "hono";
import path from "path";

import { CONFIG_DIR_NAME } from "../../constants";
import {
  loadJiraCredentials,
  loadJiraProjectConfig,
  saveJiraCredentials,
  saveJiraProjectConfig,
} from "../../integrations/jira/credentials";
import { getApiBase, getAuthHeaders, testConnection } from "../../integrations/jira/auth";
import { downloadAttachments, fetchIssue, saveTaskData } from "../../integrations/jira/api";
import type { DataLifecycleConfig, JiraCredentials } from "../../integrations/jira/types";
import { log } from "../../logger";
import type { WorktreeManager } from "../manager";

export function registerJiraRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/jira/status", (c) => {
    const configDir = manager.getConfigDir();
    const creds = loadJiraCredentials(configDir);
    const projectConfig = loadJiraProjectConfig(configDir);

    let email: string | null = null;
    let domain: string | null = null;

    if (creds) {
      if (creds.authMethod === "api-token") {
        email = creds.apiToken.email;
        try {
          domain = new URL(creds.apiToken.baseUrl).hostname;
        } catch {
          domain = creds.apiToken.baseUrl;
        }
      } else if (creds.authMethod === "oauth") {
        try {
          domain = new URL(creds.oauth.siteUrl).hostname;
        } catch {
          domain = creds.oauth.siteUrl;
        }
      }
    }

    return c.json({
      configured: creds !== null,
      defaultProjectKey: projectConfig.defaultProjectKey ?? null,
      refreshIntervalMinutes: projectConfig.refreshIntervalMinutes ?? 5,
      email,
      domain,
      dataLifecycle: projectConfig.dataLifecycle ?? null,
      autoStartClaudeOnNewIssue: projectConfig.autoStartClaudeOnNewIssue ?? false,
      autoStartClaudeSkipPermissions: projectConfig.autoStartClaudeSkipPermissions ?? true,
      autoStartClaudeFocusTerminal: projectConfig.autoStartClaudeFocusTerminal ?? true,
    });
  });

  app.post("/api/jira/setup", async (c) => {
    try {
      const body = await c.req.json<{ baseUrl: string; email: string; token: string }>();
      if (!body.baseUrl || !body.email || !body.token) {
        return c.json({ success: false, error: "baseUrl, email, and token are required" }, 400);
      }

      const configDir = manager.getConfigDir();
      const creds: JiraCredentials = {
        authMethod: "api-token",
        apiToken: {
          baseUrl: body.baseUrl.replace(/\/$/, ""),
          email: body.email,
          token: body.token,
        },
      };

      // Validate by making a test API call
      try {
        await testConnection(creds, configDir);
      } catch (err) {
        return c.json(
          {
            success: false,
            error: `Connection failed: ${err instanceof Error ? err.message : "Unknown error"}`,
          },
          400,
        );
      }

      saveJiraCredentials(configDir, creds);

      // Initialize integrations.json with defaults if no config exists yet
      const existing = loadJiraProjectConfig(configDir);
      if (!existing.refreshIntervalMinutes) {
        saveJiraProjectConfig(configDir, { ...existing, refreshIntervalMinutes: 5 });
      }

      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  app.patch("/api/jira/config", async (c) => {
    try {
      const body = await c.req.json<{
        defaultProjectKey?: string;
        refreshIntervalMinutes?: number;
        dataLifecycle?: DataLifecycleConfig;
        autoStartClaudeOnNewIssue?: boolean;
        autoStartClaudeSkipPermissions?: boolean;
        autoStartClaudeFocusTerminal?: boolean;
      }>();
      const configDir = manager.getConfigDir();
      const current = loadJiraProjectConfig(configDir);
      if (body.defaultProjectKey !== undefined) {
        current.defaultProjectKey = body.defaultProjectKey || undefined;
      }
      if (body.refreshIntervalMinutes !== undefined) {
        current.refreshIntervalMinutes = Math.max(1, Math.min(60, body.refreshIntervalMinutes));
      }
      if (body.dataLifecycle !== undefined) {
        current.dataLifecycle = body.dataLifecycle;
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
      saveJiraProjectConfig(configDir, current);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  app.delete("/api/jira/credentials", (c) => {
    try {
      const configDir = manager.getConfigDir();
      const intPath = path.join(configDir, CONFIG_DIR_NAME, "integrations.json");
      if (existsSync(intPath)) {
        const data = JSON.parse(readFileSync(intPath, "utf-8"));
        delete data.jira;
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

  app.get("/api/jira/issues", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadJiraCredentials(configDir);
      if (!creds) {
        return c.json({ issues: [], error: "Jira not configured" }, 400);
      }

      const apiBase = getApiBase(creds);
      const headers = await getAuthHeaders(creds, configDir);
      const query = c.req.query("query");

      let jql = "assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC";
      if (query) {
        jql = `assignee = currentUser() AND resolution = Unresolved AND text ~ "${query}" ORDER BY updated DESC`;
      }

      const params = new URLSearchParams({
        jql,
        fields: "summary,status,priority,issuetype,assignee,updated,labels",
        maxResults: "50",
      });

      const resp = await fetch(`${apiBase}/search/jql?${params}`, { headers });
      if (!resp.ok) {
        const body = await resp.text();
        return c.json({ issues: [], error: `Jira API error: ${resp.status} ${body}` }, 502);
      }

      const data = (await resp.json()) as {
        issues: Array<{
          key: string;
          fields: {
            summary: string;
            status: { name: string };
            priority: { name: string };
            issuetype: { name: string };
            assignee: { displayName: string } | null;
            updated: string;
            labels: string[];
          };
        }>;
      };

      // Build site URL
      let siteUrl: string;
      if (creds.authMethod === "oauth") {
        siteUrl = creds.oauth.siteUrl;
      } else {
        siteUrl = creds.apiToken.baseUrl;
      }
      const baseUrl = siteUrl.replace(/\/$/, "");

      const issues = data.issues.map((issue) => ({
        key: issue.key,
        summary: issue.fields.summary ?? "",
        status: issue.fields.status?.name ?? "Unknown",
        priority: issue.fields.priority?.name ?? "None",
        type: issue.fields.issuetype?.name ?? "Unknown",
        assignee: issue.fields.assignee?.displayName ?? null,
        updated: issue.fields.updated ?? "",
        labels: issue.fields.labels ?? [],
        url: `${baseUrl}/browse/${issue.key}`,
      }));

      // Fire-and-forget: auto-cleanup cached issues whose status matches triggers
      const projectConfig = loadJiraProjectConfig(configDir);
      const lifecycle = projectConfig.dataLifecycle;
      if (lifecycle?.autoCleanup?.enabled && lifecycle.autoCleanup.statusTriggers.length > 0) {
        const triggers = lifecycle.autoCleanup.statusTriggers.map((t) => t.toLowerCase());
        const liveStatusMap = new Map(issues.map((i) => [i.key, i.status]));

        // Scan cached issue directories
        const jiraIssuesDir = path.join(configDir, CONFIG_DIR_NAME, "issues", "jira");
        if (existsSync(jiraIssuesDir)) {
          try {
            const cachedDirs = readdirSync(jiraIssuesDir, { withFileTypes: true });
            for (const dir of cachedDirs) {
              if (!dir.isDirectory()) continue;
              const issueKey = dir.name;
              // Check live status first, then fall back to cached issue.json
              let status = liveStatusMap.get(issueKey);
              if (!status) {
                const issueFile = path.join(jiraIssuesDir, issueKey, "issue.json");
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
                  .cleanupIssueData("jira", issueKey, lifecycle.autoCleanup.actions)
                  .catch((err) => log.warn(`Auto-cleanup failed for ${issueKey}: ${err}`));
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

  app.get("/api/jira/issues/:key", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadJiraCredentials(configDir);
      if (!creds) {
        return c.json({ error: "Jira not configured" }, 400);
      }

      const key = c.req.param("key");
      const issue = await fetchIssue(key, creds, configDir);

      // Check saveOn preference — skip persisting when set to 'worktree-creation'
      const projectConfig = loadJiraProjectConfig(configDir);
      const saveOn = projectConfig.dataLifecycle?.saveOn ?? "view";

      if (saveOn === "view") {
        // Save issue data to disk
        const tasksDir = path.join(configDir, CONFIG_DIR_NAME, "tasks");
        saveTaskData(issue, tasksDir);

        // Download attachments in background (don't block the response)
        if (issue.attachments.length > 0) {
          const issueDir = path.join(configDir, CONFIG_DIR_NAME, "issues", "jira", issue.key);
          const attachDir = path.join(issueDir, "attachments");
          downloadAttachments(
            issue.attachments
              .filter((a) => a.contentUrl)
              .map((a) => ({
                filename: a.filename,
                content: a.contentUrl!,
                mimeType: a.mimeType,
                size: a.size,
              })),
            attachDir,
            creds,
            configDir,
          )
            .then((downloaded) => {
              // Update issue.json with local paths
              if (downloaded.length > 0) {
                for (const dl of downloaded) {
                  const att = issue.attachments.find((a) => a.filename === dl.filename);
                  if (att) att.localPath = dl.localPath;
                }
                saveTaskData(issue, path.join(configDir, CONFIG_DIR_NAME, "tasks"));
              }
            })
            .catch(() => {
              /* non-critical */
            });
        }
      }

      return c.json({ issue });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to fetch issue" },
        error instanceof Error && error.message.includes("not found") ? 404 : 500,
      );
    }
  });

  app.get("/api/jira/attachment", async (c) => {
    try {
      const configDir = manager.getConfigDir();
      const creds = loadJiraCredentials(configDir);
      if (!creds) {
        return c.json({ error: "Jira not configured" }, 400);
      }

      const url = c.req.query("url");
      if (!url) {
        return c.json({ error: "url parameter is required" }, 400);
      }

      const headers = await getAuthHeaders(creds, configDir);
      const resp = await fetch(url, {
        headers: { Authorization: headers.Authorization },
      });

      if (!resp.ok) {
        return c.json({ error: `Failed to fetch attachment: ${resp.status}` }, resp.status as 400);
      }

      const contentType = resp.headers.get("content-type") || "application/octet-stream";
      const body = await resp.arrayBuffer();

      return new Response(body, {
        headers: {
          "Content-Type": contentType,
          "Cache-Control": "private, max-age=3600",
        },
      });
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : "Failed to fetch attachment" },
        500,
      );
    }
  });

  app.post("/api/jira/task", async (c) => {
    try {
      const body = await c.req.json<{ issueKey: string; branch?: string }>();
      if (!body.issueKey) {
        return c.json({ success: false, error: "Issue key is required" }, 400);
      }
      const result = await manager.createWorktreeFromJira(body.issueKey, body.branch);
      return c.json(result, result.success ? 201 : 400);
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
