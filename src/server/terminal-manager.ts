import { existsSync } from "fs";
import type { WebSocket } from "ws";
import type { IPty } from "node-pty";
import nodePty from "node-pty";

// Handle CJS/ESM interop: when externalized, default import may be nested
const pty: { spawn: typeof nodePty.spawn } = (nodePty as any).default ?? nodePty;

interface TerminalSession {
  id: string;
  worktreeId: string;
  startupCommand: string | null;
  pty: IPty | null;
  ws: WebSocket | null;
  dataHandler: { dispose: () => void } | null;
  outputBuffer: string;
  worktreePath: string;
  cols: number;
  rows: number;
}

export class TerminalManager {
  private static readonly MAX_BUFFER_CHARS = 400_000;
  private sessions = new Map<string, TerminalSession>();
  private idCounter = 0;

  createSession(
    worktreeId: string,
    worktreePath: string,
    cols = 80,
    rows = 24,
    startupCommand: string | null = null,
  ): string {
    if (!existsSync(worktreePath)) {
      throw new Error(`Worktree path does not exist: ${worktreePath}`);
    }

    const shell = process.env.SHELL || "/bin/zsh";
    if (!existsSync(shell)) {
      throw new Error(`Shell not found: ${shell}`);
    }

    const sessionId = `term-${++this.idCounter}`;

    this.sessions.set(sessionId, {
      id: sessionId,
      worktreeId,
      startupCommand,
      pty: null,
      ws: null,
      dataHandler: null,
      outputBuffer: "",
      worktreePath,
      cols,
      rows,
    });

    return sessionId;
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

    // Spawn PTY lazily on first attach, then keep it alive for reconnects.
    if (!session.pty) {
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
        try {
          ws.send(`\r\nFailed to start terminal: ${err}\r\n`);
          ws.close();
        } catch {
          /* ws closed */
        }
        this.sessions.delete(sessionId);
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
        this.sessions.delete(sessionId);
      });
    }

    const ptyProcess = session.pty;
    if (!ptyProcess) {
      this.sessions.delete(sessionId);
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
        if (msg.type === "resize" && msg.cols && msg.rows) {
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
    session.cols = cols;
    session.rows = rows;
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

    this.sessions.delete(sessionId);
    return true;
  }

  destroyAllForWorktree(worktreeId: string): void {
    for (const [id, session] of this.sessions) {
      if (session.worktreeId === worktreeId) {
        this.destroySession(id);
      }
    }
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroySession(id);
    }
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }
}
