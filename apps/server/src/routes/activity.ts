import type { Hono } from "hono";

import type { ActivityLog } from "../activity-log";
import type { ActivityCategory } from "../activity-event";

const VALID_CATEGORIES = new Set<ActivityCategory>(["agent", "worktree", "system"]);
const VALID_SEVERITIES = new Set(["info", "success", "warning", "error"] as const);

export function registerActivityRoutes(
  app: Hono,
  activityLog: ActivityLog,
  getProjectName?: () => string | null,
) {
  app.get("/api/activity", (c) => {
    const since = c.req.query("since");
    const category = c.req.query("category") as ActivityCategory | undefined;
    const limitStr = c.req.query("limit");
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    const events = activityLog.getEvents({
      since: since || undefined,
      category: category || undefined,
      limit: isNaN(limit) ? 100 : limit,
    });

    return c.json({ events });
  });

  app.post("/api/activity", async (c) => {
    try {
      const body = await c.req.json<{
        category: ActivityCategory;
        type: string;
        severity?: "info" | "success" | "warning" | "error";
        title: string;
        detail?: string;
        worktreeId?: string;
        metadata?: Record<string, unknown>;
        groupKey?: string;
      }>();

      if (!VALID_CATEGORIES.has(body.category)) {
        return c.json({ success: false, error: "Invalid category" }, 400);
      }
      if (!body.type?.trim()) {
        return c.json({ success: false, error: "type is required" }, 400);
      }
      if (!body.title?.trim()) {
        return c.json({ success: false, error: "title is required" }, 400);
      }
      if (body.severity && !VALID_SEVERITIES.has(body.severity)) {
        return c.json({ success: false, error: "Invalid severity" }, 400);
      }

      const event = activityLog.addEvent({
        category: body.category,
        type: body.type.trim(),
        severity: body.severity ?? "info",
        title: body.title.trim(),
        detail: body.detail,
        worktreeId: body.worktreeId,
        metadata: body.metadata,
        groupKey: body.groupKey,
        projectName: getProjectName?.() ?? undefined,
      });

      if (event.type === "auto_task_claimed") {
        console.info("[AUTO-CLAUDE][TEMP] Activity event recorded", {
          type: event.type,
          title: event.title,
          worktreeId: event.worktreeId,
          projectName: event.projectName,
          metadata: event.metadata,
          groupKey: event.groupKey,
        });
      }

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
