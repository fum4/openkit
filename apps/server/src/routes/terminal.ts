import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";

import type { TerminalManager } from "../terminal-manager";
import type { WorktreeManager } from "../manager";

function isTerminalScope(
  value: unknown,
): value is "terminal" | "claude" | "codex" | "gemini" | "opencode" {
  return (
    value === "terminal" ||
    value === "claude" ||
    value === "codex" ||
    value === "gemini" ||
    value === "opencode"
  );
}

function isAgentTerminalScope(
  value: "terminal" | "claude" | "codex" | "gemini" | "opencode" | null,
): value is "claude" | "codex" | "gemini" | "opencode" {
  return value === "claude" || value === "codex" || value === "gemini" || value === "opencode";
}

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
      const scope = isTerminalScope(body.scope) ? body.scope : null;
      const startupCommand =
        typeof body.startupCommand === "string" && body.startupCommand.trim()
          ? body.startupCommand
          : null;

      if (isAgentTerminalScope(scope) && !startupCommand) {
        const activeSessionId = terminalManager.getSessionIdForScope(worktreeId, scope);
        if (activeSessionId) {
          return c.json({ success: true, sessionId: activeSessionId });
        }

        return c.json(
          {
            success: false,
            error: `No active ${scope} session to resume. Start a new ${scope} session first.`,
          },
          404,
        );
      }

      const sessionId = terminalManager.createSession(
        worktreeId,
        worktree.path,
        cols,
        rows,
        startupCommand,
        scope,
      );
      console.info("[terminal][TEMP] session created", {
        worktreeId,
        sessionId,
        scope,
        hasStartupCommand: Boolean(startupCommand),
      });
      return c.json({ success: true, sessionId });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create terminal session";
      console.error("[terminal] Failed to create session:", message);
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.get("/api/worktrees/:id/terminals/active", (c) => {
    const worktreeId = c.req.param("id");
    const scopeQuery = c.req.query("scope");
    const scope = isTerminalScope(scopeQuery) ? scopeQuery : null;
    if (!scope) {
      return c.json(
        {
          success: false,
          error: 'scope is required ("terminal", "claude", "codex", "gemini", or "opencode")',
        },
        400,
      );
    }

    const sessionId = terminalManager.getSessionIdForScope(worktreeId, scope);
    return c.json({ success: true, sessionId });
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
          const hadSession = terminalManager.hasSession(sessionId);
          const attached = terminalManager.attachWebSocket(sessionId, rawWs);
          if (!attached) {
            const reason = hadSession ? "terminal-spawn-failed" : "session-not-found";
            console.info(
              "[terminal][TEMP] websocket attach failed: session not found or spawn failed",
              {
                sessionId,
                reason,
              },
            );
            ws.close(1008, reason);
            return;
          }
          console.info("[terminal][TEMP] websocket attached", { sessionId });
        },
      };
    }),
  );
}
