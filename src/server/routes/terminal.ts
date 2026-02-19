import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";

import type { TerminalManager } from "../terminal-manager";
import type { WorktreeManager } from "../manager";

export function registerTerminalRoutes(
  app: Hono,
  worktreeManager: WorktreeManager,
  terminalManager: TerminalManager,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  app.post("/api/worktrees/:id/terminals", async (c) => {
    const worktreeId = c.req.param("id");
    const worktree = worktreeManager.getWorktrees().find((w) => w.id === worktreeId);

    if (!worktree) {
      return c.json({ success: false, error: "Worktree not found" }, 404);
    }

    try {
      const body = await c.req.json().catch(() => ({}));
      const cols = body.cols ?? 80;
      const rows = body.rows ?? 24;
      const startupCommand =
        typeof body.startupCommand === "string" && body.startupCommand.trim()
          ? body.startupCommand
          : null;

      const sessionId = terminalManager.createSession(
        worktreeId,
        worktree.path,
        cols,
        rows,
        startupCommand,
      );
      return c.json({ success: true, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create terminal session";
      console.error("[terminal] Failed to create session:", message);
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.delete("/api/terminals/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const destroyed = terminalManager.destroySession(sessionId);
    if (!destroyed) {
      return c.json({ success: false, error: "Session not found" }, 404);
    }
    return c.json({ success: true });
  });

  app.get(
    "/api/terminals/:sessionId/ws",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("sessionId");

      return {
        onOpen(_evt, ws) {
          const rawWs = ws.raw as WebSocket;
          const attached = terminalManager.attachWebSocket(sessionId, rawWs);
          if (!attached) {
            ws.close(1008, "Session not found");
          }
        },
      };
    }),
  );
}
