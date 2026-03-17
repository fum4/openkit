import type { Hono } from "hono";

import { log } from "../logger";
import type { WorktreeManager } from "../manager";

export function registerEventRoutes(app: Hono, manager: WorktreeManager) {
  app.get("/api/events", (c) => {
    const stream = new ReadableStream({
      start(controller) {
        const worktrees = manager.getWorktrees();
        controller.enqueue(`data: ${JSON.stringify({ type: "worktrees", worktrees })}\n\n`);

        // Send recent activity events on initial connection
        const activityLog = manager.getActivityLog();
        const opsLog = manager.getOpsLog();
        const recentEvents = activityLog.getRecentEvents(50);
        const recentOpsEvents = opsLog.getRecentEvents(200);
        if (recentEvents.length > 0) {
          controller.enqueue(
            `data: ${JSON.stringify({ type: "activity-history", events: recentEvents })}\n\n`,
          );
        }
        if (recentOpsEvents.length > 0) {
          controller.enqueue(
            `data: ${JSON.stringify({ type: "ops-log-history", events: recentOpsEvents })}\n\n`,
          );
        }

        const unsubscribeWorktrees = manager.subscribe((updatedWorktrees) => {
          try {
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "worktrees",
                worktrees: updatedWorktrees,
              })}\n\n`,
            );
          } catch {
            unsubscribeWorktrees();
          }
        });

        const unsubscribeNotifications = manager.subscribeNotifications((notification) => {
          try {
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "notification",
                ...notification,
              })}\n\n`,
            );
          } catch {
            unsubscribeNotifications();
          }
        });

        const unsubscribeHookUpdates = manager.subscribeHookUpdates((worktreeId) => {
          try {
            controller.enqueue(
              `data: ${JSON.stringify({
                type: "hook-update",
                worktreeId,
              })}\n\n`,
            );
          } catch {
            unsubscribeHookUpdates();
          }
        });

        const unsubscribeFileChange = manager.subscribeFileChange((category) => {
          try {
            if (category === "config") {
              const config = manager.getConfig();
              const projectName = manager.getProjectName();
              controller.enqueue(
                `data: ${JSON.stringify({ type: "config-changed", config, projectName })}\n\n`,
              );
            } else {
              controller.enqueue(`data: ${JSON.stringify({ type: "file-changed", category })}\n\n`);
            }
          } catch (error) {
            log.debug("File-change SSE enqueue failed, unsubscribing", {
              domain: "events",
              error,
            });
            unsubscribeFileChange();
          }
        });

        const unsubscribeActivity = activityLog.subscribe((event) => {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: "activity", event })}\n\n`);
          } catch {
            unsubscribeActivity();
          }
        });

        const unsubscribeOpsLog = opsLog.subscribe((event) => {
          try {
            controller.enqueue(`data: ${JSON.stringify({ type: "ops-log", event })}\n\n`);
          } catch {
            unsubscribeOpsLog();
          }
        });

        c.req.raw.signal.addEventListener("abort", () => {
          unsubscribeWorktrees();
          unsubscribeNotifications();
          unsubscribeHookUpdates();
          unsubscribeFileChange();
          unsubscribeActivity();
          unsubscribeOpsLog();
          controller.close();
        });
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  });
}
