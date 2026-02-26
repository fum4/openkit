import { existsSync } from "fs";
import type { WebSocket } from "ws";
import type { IPty } from "node-pty";
import nodePty from "node-pty";

// Handle CJS/ESM interop: when externalized, default import may be nested
const pty: { spawn: typeof nodePty.spawn } = (nodePty as any).default ?? nodePty;

export type TerminalScope = "terminal" | "claude" | "codex" | "gemini" | "opencode";

export interface TerminalSessionLifecycleEvent {
  action: "created" | "closed";
  sessionId: string;
  worktreeId: string;
  scope: TerminalScope | null;
  reason?: "destroyed" | "exited" | "spawn-failed";
  exitCode?: number;
  timestamp: string;
}

interface TerminalSession {
  id: string;
  worktreeId: string;
  scope: TerminalScope | null;
  startupCommand: string | null;
  pty: IPty | null;
  wsClients: Set<WebSocket>;
  dataHandler: { dispose: () => void } | null;
  outputBuffer: string;
  worktreePath: string;
  cols: number;
  rows: number;
  announced: boolean;
}

export class TerminalManager {
  private static readonly MAX_BUFFER_CHARS = 400_000;
  private sessions = new Map<string, TerminalSession>();
  private sessionsByScope = new Map<string, string>();
  private sessionLifecycleListeners: Set<(event: TerminalSessionLifecycleEvent) => void> =
    new Set();
  private idCounter = 0;

  private scopeKey(worktreeId: string, scope: TerminalScope): string {
    return `${worktreeId}::${scope}`;
  }

  subscribeSessionLifecycle(listener: (event: TerminalSessionLifecycleEvent) => void): () => void {
    this.sessionLifecycleListeners.add(listener);
    return () => this.sessionLifecycleListeners.delete(listener);
  }

  private emitSessionLifecycle(event: TerminalSessionLifecycleEvent): void {
    for (const listener of this.sessionLifecycleListeners) {
      try {
        listener(event);
      } catch {
        // Ignore listener failures.
      }
    }
  }

  private clearScopeIndex(session: TerminalSession): void {
    if (!session.scope) return;
    const key = this.scopeKey(session.worktreeId, session.scope);
    if (this.sessionsByScope.get(key) === session.id) {
      this.sessionsByScope.delete(key);
    }
  }

  private closeSessionClients(session: TerminalSession, exitCode?: number): void {
    if (session.wsClients.size === 0) return;
    for (const client of session.wsClients) {
      try {
        if (exitCode !== undefined) {
          client.send(JSON.stringify({ type: "exit", exitCode }));
        }
        client.close();
      } catch {
        // ws already closed
      }
    }
    session.wsClients.clear();
  }

  private finalizeSession(
    sessionId: string,
    reason: "destroyed" | "exited" | "spawn-failed",
    exitCode?: number,
  ): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    if (session.dataHandler) {
      session.dataHandler.dispose();
      session.dataHandler = null;
    }

    this.clearScopeIndex(session);
    this.sessions.delete(sessionId);

    if (session.announced) {
      this.emitSessionLifecycle({
        action: "closed",
        sessionId: session.id,
        worktreeId: session.worktreeId,
        scope: session.scope,
        reason,
        exitCode,
        timestamp: new Date().toISOString(),
      });
    }

    return true;
  }

  private spawnSessionPty(sessionId: string, session: TerminalSession): boolean {
    if (session.pty) return true;

    const shell = process.env.SHELL || "/bin/zsh";
    let ptyProcess: IPty;
    try {
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
      this.closeSessionClients(session);
      this.finalizeSession(sessionId, "spawn-failed");
      return false;
    }

    session.pty = ptyProcess;
    session.dataHandler = ptyProcess.onData((data: string) => {
      session.outputBuffer += data;
      if (session.outputBuffer.length > TerminalManager.MAX_BUFFER_CHARS) {
        session.outputBuffer = session.outputBuffer.slice(
          session.outputBuffer.length - TerminalManager.MAX_BUFFER_CHARS,
        );
      }
      for (const client of session.wsClients) {
        try {
          if (client.readyState === client.OPEN) {
            client.send(data);
          }
        } catch {
          // Ignore client send failures; close handler will clean up.
        }
      }
    });

    ptyProcess.onExit(({ exitCode }) => {
      const liveSession = this.sessions.get(sessionId);
      if (!liveSession || liveSession !== session) return;
      console.info("[terminal] session-exit", {
        sessionId,
        worktreeId: session.worktreeId,
        scope: session.scope,
        exitCode,
      });
      this.closeSessionClients(session, exitCode);
      this.finalizeSession(sessionId, "exited", exitCode);
    });

    return true;
  }

  createSession(
    worktreeId: string,
    worktreePath: string,
    cols = 80,
    rows = 24,
    startupCommand: string | null = null,
    scope: TerminalScope | null = null,
  ): string {
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree path does not exist: ${worktreePath}`);
    }

    const shell = process.env.SHELL || "/bin/zsh";
    if (!existsSync(shell)) {
      throw new Error(`Shell not found: ${shell}`);
    }

    if (scope) {
      const existingSessionId = this.sessionsByScope.get(this.scopeKey(worktreeId, scope));
      if (existingSessionId && this.sessions.has(existingSessionId)) {
        return existingSessionId;
      }
      if (existingSessionId) {
        this.sessionsByScope.delete(this.scopeKey(worktreeId, scope));
      }
    }

    const sessionId = `term-${++this.idCounter}`;

    const session: TerminalSession = {
      id: sessionId,
      worktreeId,
      scope,
      startupCommand,
      pty: null,
      wsClients: new Set<WebSocket>(),
      dataHandler: null,
      outputBuffer: "",
      worktreePath,
      cols,
      rows,
      announced: false,
    };

    this.sessions.set(sessionId, session);
    if (scope) {
      this.sessionsByScope.set(this.scopeKey(worktreeId, scope), sessionId);
    }
    console.info("[terminal] session-created", {
      sessionId,
      worktreeId,
      scope,
      hasStartupCommand: Boolean(startupCommand),
      cols,
      rows,
    });

    if (startupCommand && !this.spawnSessionPty(sessionId, session)) {
      throw new Error("Failed to start terminal session");
    }

    session.announced = true;
    this.emitSessionLifecycle({
      action: "created",
      sessionId: session.id,
      worktreeId: session.worktreeId,
      scope: session.scope,
      timestamp: new Date().toISOString(),
    });

    return sessionId;
  }

  attachWebSocket(sessionId: string, ws: WebSocket): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.wsClients.add(ws);

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
      this.finalizeSession(sessionId, "spawn-failed");
      return false;
    }

    if (session.outputBuffer.length > 0) {
      try {
        if (ws.readyState === ws.OPEN) {
          ws.send(session.outputBuffer);
        }
      } catch {
        // Ignore replay errors.
      }
    }

    ws.on("message", (rawData: Buffer | string) => {
      const data = typeof rawData === "string" ? rawData : rawData.toString("utf-8");
      try {
        const msg = JSON.parse(data);
        if (msg?.type === "resize") {
          if (typeof msg.cols === "number" && typeof msg.rows === "number") {
            ptyProcess.resize(msg.cols, msg.rows);
          }
          return;
        }
        if (msg?.type === "ping") {
          try {
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: "pong" }));
            }
          } catch {
            // Ignore keepalive send failures.
          }
          return;
        }
        if (msg?.type === "input" && typeof msg.data === "string") {
          ptyProcess.write(msg.data);
          return;
        }
      } catch {
        // Not JSON control message — raw input
      }
      ptyProcess.write(data);
    });

    ws.on("close", () => {
      session.wsClients.delete(ws);
    });

    return true;
  }

  resizeSession(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.cols = cols;
    session.rows = rows;
    session.pty?.resize(cols, rows);
    return true;
  }

  destroySession(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    this.closeSessionClients(session);
    const ptyProcess = session.pty;
    session.pty = null;
    const finalized = this.finalizeSession(sessionId, "destroyed");

    try {
      ptyProcess?.kill();
    } catch {
      /* ignore */
    }

    return finalized;
  }

  destroyAllForWorktree(worktreeId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.worktreeId === worktreeId) {
        this.destroySession(id);
      }
    }
  }

  destroyAll(): void {
    for (const id of this.sessions.keys()) {
      this.destroySession(id);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  getSessionIdForScope(worktreeId: string, scope: TerminalScope): string | null {
    const key = this.scopeKey(worktreeId, scope);
    const sessionId = this.sessionsByScope.get(key);
    if (!sessionId) return null;
    if (!this.sessions.has(sessionId)) {
      this.sessionsByScope.delete(key);
      return null;
    }
    return sessionId;
  }

  getSessionMetadata(sessionId: string): {
    worktreeId: string;
    scope: TerminalScope | null;
    cols: number;
    rows: number;
  } | null {
    const session = this.sessions.get(sessionId);
    if (!session) return null;
    return {
      worktreeId: session.worktreeId,
      scope: session.scope,
      cols: session.cols,
      rows: session.rows,
    };
  }
}
