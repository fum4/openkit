import type { Hono } from "hono";

import type { OpsLogLevel, OpsLogStatus } from "../ops-log";
import type { WorktreeManager } from "../manager";

const VALID_LEVELS = new Set<OpsLogLevel>(["debug", "info", "warning", "error"]);
const VALID_STATUSES = new Set<OpsLogStatus>(["started", "succeeded", "failed", "info"]);

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
}
