import type { Hono } from "hono";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";

import type { TerminalManager } from "../terminal-manager";
import type { WorktreeManager } from "../manager";
import { findHistoricalAgentSessions, type RestorableAgent } from "./agent-history";

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

function isRestorableAgent(value: unknown): value is RestorableAgent {
  return value === "claude" || value === "codex";
}

function formatTempLog(prefix: string, message: string, payload?: Record<string, unknown>): string {
  if (!payload) return `${prefix} ${message}`;
  try {
    return `${prefix} ${message} ${JSON.stringify(payload)}`;
  } catch {
    return `${prefix} ${message}`;
  }
}

export function registerTerminalRoutes(
  app: Hono,
  worktreeManager: WorktreeManager,
  terminalManager: TerminalManager,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  const toResolutionStatus = (code: string): 404 | 409 => {
    return code === "WORKTREE_ID_AMBIGUOUS" ? 409 : 404;
  };

  app.post("/api/worktrees/:id/terminals", async (c) => {
    const worktreeId = c.req.param("id");
    const body = await c.req.json().catch(() => ({}));
    const scope = isTerminalScope(body.scope) ? body.scope : null;
    const resolved = worktreeManager.resolveWorktree(worktreeId);
    if (!resolved.success) {
      console.info(
        formatTempLog("[terminal][TEMP]", "create session worktree resolution failed", {
          requestedWorktreeId: worktreeId,
          scope,
          code: resolved.code,
          error: resolved.error,
        }),
      );
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    const { worktree, worktreeId: canonicalWorktreeId } = resolved;

    try {
      const cols = body.cols ?? 80;
      const rows = body.rows ?? 24;
      const startupCommand =
        typeof body.startupCommand === "string" && body.startupCommand.trim()
          ? body.startupCommand
          : null;

      const createResult = terminalManager.createSession(
        canonicalWorktreeId,
        worktree.path,
        cols,
        rows,
        startupCommand,
        scope,
      );
      console.info(
        formatTempLog("[terminal][TEMP]", "session created", {
          worktreeId: canonicalWorktreeId,
          sessionId: createResult.sessionId,
          scope,
          hasStartupCommand: Boolean(startupCommand),
          reusedScopedSession: createResult.reusedScopedSession,
          replacedScopedShellSession: createResult.replacedScopedShellSession,
          createPath: startupCommand ? "explicit-create" : "passive-create",
        }),
      );
      return c.json({
        success: true,
        sessionId: createResult.sessionId,
        reusedScopedSession: createResult.reusedScopedSession,
        replacedScopedShellSession: createResult.replacedScopedShellSession,
      });
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

    const resolved = worktreeManager.resolveWorktreeId(worktreeId);
    if (!resolved.success) {
      console.info(
        formatTempLog("[terminal][TEMP]", "active session worktree resolution failed", {
          requestedWorktreeId: worktreeId,
          scope,
          code: resolved.code,
          error: resolved.error,
        }),
      );
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }

    const sessionId = terminalManager.getSessionIdForScope(resolved.worktreeId, scope);
    console.info(
      formatTempLog("[terminal][TEMP]", "active session resolved", {
        requestedWorktreeId: worktreeId,
        canonicalWorktreeId: resolved.worktreeId,
        scope,
        sessionId,
      }),
    );
    return c.json({ success: true, sessionId });
  });

  app.get("/api/worktrees/:id/agents/:agent/restore", (c) => {
    const worktreeId = c.req.param("id");
    const agent = c.req.param("agent");
    if (!isRestorableAgent(agent)) {
      return c.json(
        {
          success: false,
          error: 'agent must be "claude" or "codex"',
        },
        400,
      );
    }

    const resolved = worktreeManager.resolveWorktree(worktreeId);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }

    try {
      const activeSessionId = terminalManager.getSessionIdForScope(resolved.worktreeId, agent);
      const historyMatches = findHistoricalAgentSessions(agent, resolved.worktree.path);
      console.info(
        formatTempLog("[terminal][TEMP]", "restore targets resolved", {
          requestedWorktreeId: worktreeId,
          canonicalWorktreeId: resolved.worktreeId,
          worktreePath: resolved.worktree.path,
          agent,
          activeSessionId,
          historySessionIds: historyMatches.map((match) => match.sessionId),
        }),
      );
      return c.json({
        success: true,
        activeSessionId,
        historyMatches,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve historical agent sessions";
      console.error("[terminal] Failed to resolve historical agent sessions:", message);
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
          const hadSession = terminalManager.hasSession(sessionId);
          const attached = terminalManager.attachWebSocket(sessionId, rawWs);
          if (!attached) {
            const reason = hadSession ? "terminal-spawn-failed" : "session-not-found";
            console.info(
              formatTempLog(
                "[terminal][TEMP]",
                "websocket attach failed: session not found or spawn failed",
                {
                  sessionId,
                  reason,
                },
              ),
            );
            ws.close(1008, reason);
            return;
          }
          console.info(formatTempLog("[terminal][TEMP]", "websocket attached", { sessionId }));
        },
      };
    }),
  );
}
