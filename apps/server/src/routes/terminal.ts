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

export function registerTerminalRoutes(
  app: Hono,
  worktreeManager: WorktreeManager,
  terminalManager: TerminalManager,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  const opsLog = worktreeManager.getOpsLog();
  const getProjectName = () => worktreeManager.getProjectName() ?? undefined;
  const logTerminalEvent = (options: {
    action: string;
    message: string;
    status?: "info" | "succeeded" | "failed";
    level?: "debug" | "info" | "warning" | "error";
    worktreeId?: string;
    metadata?: Record<string, unknown>;
  }) => {
    opsLog.addEvent({
      source: "terminal",
      action: options.action,
      message: options.message,
      level: options.level ?? (options.status === "failed" ? "error" : "info"),
      status: options.status ?? "info",
      worktreeId: options.worktreeId,
      projectName: getProjectName(),
      metadata: options.metadata,
    });
  };

  const toResolutionStatus = (code: string): 404 | 409 => {
    return code === "WORKTREE_ID_AMBIGUOUS" ? 409 : 404;
  };

  app.post("/api/worktrees/:id/terminals", async (c) => {
    const worktreeId = c.req.param("id");
    const resolved = worktreeManager.resolveWorktree(worktreeId);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    const { worktree, worktreeId: canonicalWorktreeId } = resolved;

    try {
      const body = await c.req.json().catch(() => ({}));
      const cols = body.cols ?? 80;
      const rows = body.rows ?? 24;
      const scope = isTerminalScope(body.scope) ? body.scope : null;
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
      logTerminalEvent({
        action: "terminal.session.create.request",
        message: "Terminal session created",
        status: "succeeded",
        worktreeId: canonicalWorktreeId,
        metadata: {
          sessionId: createResult.sessionId,
          scope,
          hasStartupCommand: Boolean(startupCommand),
          reusedScopedSession: createResult.reusedScopedSession,
          replacedScopedShellSession: createResult.replacedScopedShellSession,
        },
      });
      return c.json({
        success: true,
        sessionId: createResult.sessionId,
        reusedScopedSession: createResult.reusedScopedSession,
        replacedScopedShellSession: createResult.replacedScopedShellSession,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create terminal session";
      logTerminalEvent({
        action: "terminal.session.create.request",
        message: "Failed to create terminal session",
        status: "failed",
        worktreeId: canonicalWorktreeId,
        metadata: {
          requestedWorktreeId: worktreeId,
          error: message,
        },
      });
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
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }

    const sessionId = terminalManager.getSessionIdForScope(resolved.worktreeId, scope);
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
      logTerminalEvent({
        action: "terminal.agent.restore.lookup",
        message: "Resolved agent session history",
        status: "succeeded",
        worktreeId: resolved.worktreeId,
        metadata: {
          agent,
          requestedWorktreeId: worktreeId,
          resolvedWorktreePath: resolved.worktree.path,
          activeSessionId,
          matchCount: historyMatches.length,
          matchedSessionIds: historyMatches.map((m) => m.sessionId),
        },
      });
      return c.json({
        success: true,
        activeSessionId,
        historyMatches,
        resolvedWorktreePath: resolved.worktree.path,
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to resolve historical agent sessions";
      logTerminalEvent({
        action: "terminal.agent.restore.lookup",
        message: "Failed to resolve historical agent sessions",
        status: "failed",
        worktreeId: resolved.worktreeId,
        metadata: {
          agent,
          requestedWorktreeId: worktreeId,
          error: message,
        },
      });
      return c.json({ success: false, error: message }, 500);
    }
  });

  app.delete("/api/terminals/:sessionId", (c) => {
    const sessionId = c.req.param("sessionId");
    const sessionWorktreeId = terminalManager.getSessionWorktreeId(sessionId);
    const destroyed = terminalManager.destroySession(sessionId);
    if (!destroyed) {
      logTerminalEvent({
        action: "terminal.session.destroy",
        message: "Terminal session not found",
        status: "failed",
        level: "warning",
        metadata: { sessionId },
      });
      return c.json({ success: false, error: "Session not found" }, 404);
    }
    logTerminalEvent({
      action: "terminal.session.destroy",
      message: "Terminal session destroyed",
      status: "succeeded",
      worktreeId: sessionWorktreeId ?? undefined,
      metadata: { sessionId },
    });
    return c.json({ success: true });
  });

  app.get(
    "/api/terminals/:sessionId/ws",
    upgradeWebSocket((c) => {
      const sessionId = c.req.param("sessionId");

      return {
        onOpen(_evt, ws) {
          const rawWs = ws.raw as WebSocket;
          const sessionWorktreeId = terminalManager.getSessionWorktreeId(sessionId);
          const hadSession = terminalManager.hasSession(sessionId);
          const attached = terminalManager.attachWebSocket(sessionId, rawWs);
          if (!attached) {
            const reason = hadSession ? "terminal-spawn-failed" : "session-not-found";
            logTerminalEvent({
              action: "terminal.websocket.attach",
              message: "Failed to attach terminal websocket",
              status: "failed",
              worktreeId: sessionWorktreeId ?? undefined,
              metadata: {
                sessionId,
                reason,
              },
            });
            ws.close(1008, reason);
            return;
          }
          logTerminalEvent({
            action: "terminal.websocket.attach",
            message: "Terminal websocket attached",
            status: "succeeded",
            worktreeId: sessionWorktreeId ?? undefined,
            metadata: {
              sessionId,
            },
          });
        },
      };
    }),
  );
}
