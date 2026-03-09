import { existsSync } from "fs";
import { createRequire } from "module";
import type { WebSocket } from "ws";
import type { IPty } from "node-pty";
import { Terminal as HeadlessTerminal } from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

const require = createRequire(import.meta.url);

type NodePtyModule = { spawn: (typeof import("node-pty"))["spawn"] };

function hasSpawn(value: unknown): value is NodePtyModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { spawn?: unknown }).spawn === "function"
  );
}

function resolveNodePtyModule(): NodePtyModule {
  const loaded: unknown = require("node-pty");

  if (hasSpawn(loaded)) {
    return loaded;
  }

  if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
    const defaultExport = (loaded as { default?: unknown }).default;
    if (hasSpawn(defaultExport)) {
      return defaultExport;
    }
  }

  throw new Error("node-pty module is missing a spawn() export");
}

interface TerminalSession {
  id: string;
  worktreeId: string;
  scope: "terminal" | "claude" | "codex" | "gemini" | "opencode" | null;
  startupCommand: string | null;
  pty: IPty | null;
  ws: WebSocket | null;
  dataHandler: { dispose: () => void } | null;
  fallbackBuffer: string;
  restoreTerminal: HeadlessTerminal;
  serializeAddon: SerializeAddon;
  restoreSnapshot: string;
  worktreePath: string;
  cols: number;
  rows: number;
}

export interface TerminalSessionCreateResult {
  sessionId: string;
  reusedScopedSession: boolean;
  replacedScopedShellSession: boolean;
}

export class TerminalManager {
  private static readonly MAX_FALLBACK_BUFFER_CHARS = 80_000;
  private static readonly RESTORE_SCROLLBACK_LINES = 10_000;
  private sessions = new Map<string, TerminalSession>();
  private sessionsByScope = new Map<string, string>();
  private idCounter = 0;

  private scopeKey(
    worktreeId: string,
    scope: "terminal" | "claude" | "codex" | "gemini" | "opencode",
  ): string {
    return `${worktreeId}::${scope}`;
  }

  private clearScopeIndex(session: TerminalSession): void {
    if (!session.scope) return;
    const key = this.scopeKey(session.worktreeId, session.scope);
    if (this.sessionsByScope.get(key) === session.id) {
      this.sessionsByScope.delete(key);
    }
  }

  private isSessionProcessAlive(session: TerminalSession): boolean {
    if (!session.pty) return false;
    const pid = (session.pty as unknown as { pid?: number }).pid;
    if (typeof pid !== "number" || !Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  private isScopedSessionHealthy(session: TerminalSession): boolean {
    // Scoped shell sessions can be lazily spawned on websocket attach.
    if (session.startupCommand === null) return true;
    return this.isSessionProcessAlive(session);
  }

  private createRestoreTracker(
    cols: number,
    rows: number,
  ): {
    restoreTerminal: HeadlessTerminal;
    serializeAddon: SerializeAddon;
    restoreSnapshot: string;
  } {
    const restoreTerminal = new HeadlessTerminal({
      cols,
      rows,
      scrollback: TerminalManager.RESTORE_SCROLLBACK_LINES,
      allowProposedApi: false,
    });
    const serializeAddon = new SerializeAddon();
    restoreTerminal.loadAddon(serializeAddon);
    return {
      restoreTerminal,
      serializeAddon,
      restoreSnapshot: "",
    };
  }

  private updateFallbackBuffer(session: TerminalSession, data: string): void {
    session.fallbackBuffer += data;
    if (session.fallbackBuffer.length > TerminalManager.MAX_FALLBACK_BUFFER_CHARS) {
      session.fallbackBuffer = session.fallbackBuffer.slice(
        session.fallbackBuffer.length - TerminalManager.MAX_FALLBACK_BUFFER_CHARS,
      );
    }
  }

  private refreshRestoreSnapshot(session: TerminalSession): void {
    try {
      session.restoreSnapshot = session.serializeAddon.serialize({
        scrollback: TerminalManager.RESTORE_SCROLLBACK_LINES,
      });
    } catch (error) {
      console.info("[terminal][TEMP] failed to serialize terminal state", {
        worktreeId: session.worktreeId,
        scope: session.scope,
        sessionId: session.id,
        error: error instanceof Error ? error.message : "unknown",
      });
      session.restoreSnapshot = "";
    }
  }

  private writeToRestoreTracker(session: TerminalSession, data: string): void {
    this.updateFallbackBuffer(session, data);
    session.restoreTerminal.write(data, () => {
      this.refreshRestoreSnapshot(session);
    });
  }

  private resizeRestoreTracker(session: TerminalSession, cols: number, rows: number): void {
    session.cols = cols;
    session.rows = rows;
    session.restoreTerminal.resize(cols, rows);
    this.refreshRestoreSnapshot(session);
  }

  private getRestorePayload(session: TerminalSession): string {
    if (session.restoreSnapshot.length > 0) {
      return session.restoreSnapshot;
    }
    return session.fallbackBuffer;
  }

  private spawnSessionPty(sessionId: string, session: TerminalSession): boolean {
    if (session.pty) return true;

    const shell = process.env.SHELL || "/bin/zsh";
    let ptyProcess: IPty;
    try {
      const pty = resolveNodePtyModule();
      const shellArgs = session.startupCommand ? ["-lc", session.startupCommand] : [];
      ptyProcess = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: session.cols,
        rows: session.rows,
        cwd: session.worktreePath,
        env: {
          ...process.env,
          SHELL: shell,
          TERM: "xterm-256color",
          COLORTERM: "truecolor",
        } as Record<string, string>,
      });
    } catch (err) {
      console.error(`[terminal] Failed to spawn PTY: ${err}`);
      this.clearScopeIndex(session);
      this.sessions.delete(sessionId);
      return false;
    }

    session.pty = ptyProcess;
    session.dataHandler = ptyProcess.onData((data: string) => {
      this.writeToRestoreTracker(session, data);
      try {
        const activeWs = session.ws;
        if (activeWs && activeWs.readyState === 1) {
          activeWs.send(data);
        }
      } catch {
        // ws closed
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      if (session.dataHandler) {
        session.dataHandler.dispose();
        session.dataHandler = null;
      }
      if (session.ws) {
        try {
          session.ws.send(JSON.stringify({ type: "exit", exitCode }));
          session.ws.close();
        } catch {
          // ws already closed
        }
      }
      this.clearScopeIndex(session);
      this.sessions.delete(sessionId);
    });

    return true;
  }

  createSession(
    worktreeId: string,
    worktreePath: string,
    cols = 80,
    rows = 24,
    startupCommand: string | null = null,
    scope: "terminal" | "claude" | "codex" | "gemini" | "opencode" | null = null,
  ): TerminalSessionCreateResult {
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree path does not exist: ${worktreePath}`);
    }

    const shell = process.env.SHELL || "/bin/zsh";
    if (!existsSync(shell)) {
      throw new Error(`Shell not found: ${shell}`);
    }

    let replacedScopedShellSession = false;
    if (scope) {
      const scopeKey = this.scopeKey(worktreeId, scope);
      const existingSessionId = this.sessionsByScope.get(scopeKey);
      if (existingSessionId) {
        const existingSession = this.sessions.get(existingSessionId);
        if (!existingSession) {
          this.sessionsByScope.delete(scopeKey);
        } else {
          const existingSessionHealthy = this.isScopedSessionHealthy(existingSession);
          if (!existingSessionHealthy) {
            console.info("[terminal][TEMP] createSession scope decision", {
              worktreeId,
              scope,
              sessionId: existingSessionId,
              decision: "replaced-unhealthy-scope",
              reason:
                existingSession.startupCommand === null
                  ? "existing-scoped-shell-session-unhealthy"
                  : "existing-scoped-agent-session-unhealthy",
            });
            this.destroySession(existingSessionId);
            if (existingSession.startupCommand === null) {
              replacedScopedShellSession = true;
            }
          } else {
            const hasStartupCommand = Boolean(startupCommand);
            const existingIsAgentSession = existingSession.startupCommand !== null;
            if (!hasStartupCommand) {
              console.info("[terminal][TEMP] createSession scope decision", {
                worktreeId,
                scope,
                sessionId: existingSessionId,
                decision: "reused-agent-scope",
                reason: "no-startup-command",
              });
              return {
                sessionId: existingSessionId,
                reusedScopedSession: true,
                replacedScopedShellSession: false,
              };
            }
            if (existingIsAgentSession) {
              console.info("[terminal][TEMP] createSession scope decision", {
                worktreeId,
                scope,
                sessionId: existingSessionId,
                decision: "reused-agent-scope",
                reason: "existing-scoped-agent-session",
              });
              return {
                sessionId: existingSessionId,
                reusedScopedSession: true,
                replacedScopedShellSession: false,
              };
            }

            console.info("[terminal][TEMP] createSession scope decision", {
              worktreeId,
              scope,
              sessionId: existingSessionId,
              decision: "replaced-shell-scope",
              reason: "startup-command-requested",
            });
            this.destroySession(existingSessionId);
            replacedScopedShellSession = true;
          }
        }
      }
    }

    const sessionId = `term-${++this.idCounter}`;
    const { restoreTerminal, serializeAddon, restoreSnapshot } = this.createRestoreTracker(
      cols,
      rows,
    );

    const session: TerminalSession = {
      id: sessionId,
      worktreeId,
      scope,
      startupCommand,
      pty: null,
      ws: null,
      dataHandler: null,
      fallbackBuffer: "",
      restoreTerminal,
      serializeAddon,
      restoreSnapshot,
      worktreePath,
      cols,
      rows,
    };

    this.sessions.set(sessionId, session);
    if (scope) {
      this.sessionsByScope.set(this.scopeKey(worktreeId, scope), sessionId);
    }

    if (startupCommand && !this.spawnSessionPty(sessionId, session)) {
      throw new Error("Failed to start terminal session");
    }

    console.info("[terminal][TEMP] createSession scope decision", {
      worktreeId,
      scope,
      sessionId,
      decision: "created-fresh",
      hasStartupCommand: Boolean(startupCommand),
      replacedScopedShellSession,
    });
    return {
      sessionId,
      reusedScopedSession: false,
      replacedScopedShellSession,
    };
  }

  attachWebSocket(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.ws && session.ws !== ws) {
      try {
        session.ws.close();
      } catch {
        // Ignore close errors.
      }
    }
    session.ws = ws;

    // Spawn PTY lazily on first attach when not already started.
    if (!session.pty) {
      const spawned = this.spawnSessionPty(sessionId, session);
      if (!spawned) {
        try {
          ws.send("\r\nFailed to start terminal session\r\n");
          ws.close();
        } catch {
          /* ws closed */
        }
        return false;
      }
    }

    const ptyProcess = session.pty;
    if (!ptyProcess) {
      this.sessions.delete(sessionId);
      return false;
    }

    const restorePayload = this.getRestorePayload(session);
    try {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: "restore", payload: restorePayload }));
      }
    } catch {
      // Ignore restore replay errors.
    }

    ws.on("message", (rawData: Buffer | string) => {
      const data = typeof rawData === "string" ? rawData : rawData.toString("utf-8");
      try {
        const msg = JSON.parse(data);
        if (msg.type === "resize" && msg.cols && msg.rows) {
          this.resizeRestoreTracker(session, msg.cols, msg.rows);
          ptyProcess.resize(msg.cols, msg.rows);
          return;
        }
      } catch {
        // Not JSON control message — raw input
      }
      ptyProcess.write(data);
    });

    ws.on("close", () => {
      if (session.ws === ws) {
        session.ws = null;
      }
    });

    return true;
  }

  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    this.resizeRestoreTracker(session, cols, rows);
    session.pty?.resize(cols, rows);
    return true;
  }

  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.dataHandler) {
      session.dataHandler.dispose();
      session.dataHandler = null;
    }
    try {
      session.ws?.close();
    } catch {
      /* ignore */
    }
    try {
      session.pty?.kill();
    } catch {
      /* ignore */
    }

    this.clearScopeIndex(session);
    this.sessions.delete(sessionId);
    return true;
  }

  destroyAllForWorktree(worktreeId: string): number {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if (session.worktreeId === worktreeId) {
        if (this.destroySession(id)) {
          removed += 1;
        }
      }
    }
    return removed;
  }

  destroyAll(): void {
    for (const id of this.sessions.keys()) {
      this.destroySession(id);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessionIdForScope(
    worktreeId: string,
    scope: "terminal" | "claude" | "codex" | "gemini" | "opencode",
  ): string | null {
    const key = this.scopeKey(worktreeId, scope);
    const sessionId = this.sessionsByScope.get(key);
    if (!sessionId) return null;
    if (!this.sessions.has(sessionId)) {
      this.sessionsByScope.delete(key);
      return null;
    }
    return sessionId;
  }
}
