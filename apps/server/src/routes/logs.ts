import type { Hono } from "hono";

import type { OpsLogLevel, OpsLogStatus } from "../ops-log";
import { log } from "../logger";
import type { WorktreeManager } from "../manager";

const VALID_LEVELS = new Set<OpsLogLevel>(["debug", "info", "warning", "error"]);
const VALID_STATUSES = new Set<OpsLogStatus>(["started", "success", "failed", "info"]);

export function registerLogsRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/logs", (c) => {
    const since = c.req.query("since");
    const level = c.req.query("level") as OpsLogLevel | undefined;
    const status = c.req.query("status") as OpsLogStatus | undefined;
    const source = c.req.query("source");
    const search = c.req.query("search");
    const limitRaw = c.req.query("limit");
    const parsedLimit = limitRaw ? Number.parseInt(limitRaw, 10) : 200;
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 200;

    const events = manager.getOpsLog().getEvents({
      since: since || undefined,
      level: level && VALID_LEVELS.has(level) ? level : undefined,
      status: status && VALID_STATUSES.has(status) ? status : undefined,
      source: source || undefined,
      search: search || undefined,
      limit,
    });

    return c.json({ events });
  });

  app.post("/api/logs", async (c) => {
    try {
      const body = await c.req.json<{
        source: string;
        action: string;
        message: string;
        level?: OpsLogLevel;
        status?: OpsLogStatus;
        worktreeId?: string;
        metadata?: Record<string, unknown>;
      }>();

      const source = typeof body.source === "string" ? body.source.trim() : "";
      const action = typeof body.action === "string" ? body.action.trim() : "";
      const message = typeof body.message === "string" ? body.message.trim() : "";
      const level = body.level && VALID_LEVELS.has(body.level) ? body.level : "info";
      const status = body.status && VALID_STATUSES.has(body.status) ? body.status : "info";

      if (!source) return c.json({ success: false, error: "source is required" }, 400);
      if (!action) return c.json({ success: false, error: "action is required" }, 400);
      if (!message) return c.json({ success: false, error: "message is required" }, 400);

      const event = manager.getOpsLog().addEvent({
        source,
        action,
        message,
        level,
        status,
        worktreeId: body.worktreeId,
        projectName: manager.getProjectName() ?? undefined,
        metadata: body.metadata,
      });

      return c.json({ success: true, event });
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

  // Batch endpoint for browser (web-app) log entries.
  // The browser logger buffers entries and flushes them here periodically.
  app.post("/api/client-logs", async (c) => {
    try {
      const body = await c.req.json<{
        entries: Array<{
          timestamp: string;
          system: string;
          subsystem: string;
          level: string;
          message: string;
          domain?: string;
          metadata?: Record<string, unknown>;
        }>;
      }>();

      if (!Array.isArray(body.entries)) {
        return c.json({ success: false, error: "entries must be an array" }, 400);
      }

      const opsLog = manager.getOpsLog();
      const projectName = manager.getProjectName() ?? undefined;

      for (const entry of body.entries) {
        // Extract well-known keys from metadata into top-level ops-log fields.
        // Everything else stays in the metadata bag.
        const {
          action: metaAction,
          status: metaStatus,
          worktreeId: metaWorktreeId,
          projectName: metaProjectName,
          runId: metaRunId,
          ...rest
        } = entry.metadata ?? {};

        const cleanMetadata: Record<string, unknown> = { ...rest };
        if (entry.domain) cleanMetadata.domain = entry.domain;

        const defaultStatus = entry.level === "error" ? "failed" : "info";

        opsLog.addEvent({
          source: entry.subsystem ? `${entry.system}.${entry.subsystem}` : entry.system,
          action: typeof metaAction === "string" ? metaAction : "log",
          message: entry.message,
          level: entry.level === "warn" ? "warning" : (entry.level as OpsLogLevel),
          status: typeof metaStatus === "string" ? (metaStatus as OpsLogStatus) : defaultStatus,
          worktreeId: typeof metaWorktreeId === "string" ? metaWorktreeId : undefined,
          projectName: typeof metaProjectName === "string" ? metaProjectName : projectName,
          runId: typeof metaRunId === "string" ? metaRunId : undefined,
          metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
        });
      }

      return c.json({ success: true, count: body.entries.length });
    } catch (error) {
      log.error("Failed to process client logs", {
        domain: "logs",
        error: error instanceof Error ? error.message : "Invalid request",
      });
      return c.json({ success: false, error: "Invalid request" }, 400);
    }
  });
}
