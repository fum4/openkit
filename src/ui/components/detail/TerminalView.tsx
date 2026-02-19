import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { useTerminal } from "../../hooks/useTerminal";
import { text } from "../../theme";
import { ClaudeIcon } from "../icons";
import { Spinner } from "../Spinner";

interface TerminalViewProps {
  worktreeId: string;
  visible: boolean;
  variant?: "terminal" | "claude";
  claudeLaunchRequest?: {
    mode: "resume" | "start";
    prompt?: string;
    requestId: number;
  } | null;
  closeRequestId?: number | null;
  onClaudeExit?: () => void;
}

const DEFAULT_CLAUDE_START_PROMPT =
  "You are already in the correct worktree. Read TASK.md first, then implement the task. Treat AI context and todo checklist as highest-priority instructions.";

function shellQuoteSingle(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildClaudeCommand(prompt: string | undefined): string {
  const claudeInvocation = prompt ? `claude ${shellQuoteSingle(prompt)}` : "claude";
  // Run Claude as the PTY's main process; when it exits, the session exits too.
  return `exec ${claudeInvocation}`;
}

export function TerminalView({
  worktreeId,
  visible,
  variant = "terminal",
  claudeLaunchRequest,
  closeRequestId,
  onClaudeExit,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const claudeExitNotifiedRef = useRef(false);
  const lastCloseRequestIdRef = useRef<number | null>(null);
  const activeClaudeRequestIdRef = useRef<number | null>(null);
  const hasOutputForClaudeRequestRef = useRef(false);
  const awaitingClaudeOutputRef = useRef(false);
  const [isClaudeBooting, setIsClaudeBooting] = useState(false);

  const createSessionStartupCommand = useMemo(() => {
    if (variant !== "claude" || !claudeLaunchRequest) return null;
    if (claudeLaunchRequest.mode === "start") {
      const prompt = claudeLaunchRequest.prompt?.trim() || DEFAULT_CLAUDE_START_PROMPT;
      return buildClaudeCommand(prompt);
    }
    return buildClaudeCommand(undefined);
  }, [claudeLaunchRequest, variant]);

  const handleData = useCallback(
    (data: string) => {
      if (variant === "claude" && claudeLaunchRequest) {
        if (activeClaudeRequestIdRef.current !== claudeLaunchRequest.requestId) {
          activeClaudeRequestIdRef.current = claudeLaunchRequest.requestId;
        }
        hasOutputForClaudeRequestRef.current = true;
        if (awaitingClaudeOutputRef.current || isClaudeBooting) {
          awaitingClaudeOutputRef.current = false;
          setIsClaudeBooting(false);
        }
      }
      terminalRef.current?.write(data);
    },
    [claudeLaunchRequest, isClaudeBooting, variant],
  );

  const handleExit = useCallback((exitCode: number) => {
    awaitingClaudeOutputRef.current = false;
    setIsClaudeBooting(false);
    if (variant === "claude" && !claudeExitNotifiedRef.current) {
      claudeExitNotifiedRef.current = true;
      onClaudeExit?.();
    }
    terminalRef.current?.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
  }, [onClaudeExit, variant]);

  const getSize = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return null;
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  const { error, isConnected, sendData, sendResize, connect, disconnect, destroy } =
    useTerminal({
      worktreeId,
      sessionScope: variant,
      createSessionStartupCommand,
      onData: handleData,
      onExit: handleExit,
      getSize,
    });

  // Initialize xterm and connect on first mount
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: "#000000",
        foreground: "#c9d1d9",
        cursor: "#2dd4bf",
        selectionBackground: "rgba(45,212,191,0.20)",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon());

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (containerRef.current) {
      terminal.open(containerRef.current);
      fitAddon.fit();
      connect();
    }

    terminal.onData((data) => {
      sendData(data);
    });

    return () => {
      disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      mountedRef.current = false;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Handle resize when visibility changes or window resizes
  useEffect(() => {
    if (!visible) return;

    const fit = () => {
      if (fitAddonRef.current && containerRef.current) {
        try {
          fitAddonRef.current.fit();
          const terminal = terminalRef.current;
          if (terminal) {
            sendResize(terminal.cols, terminal.rows);
          }
        } catch {
          // container not visible yet
        }
      }
    };

    // Fit and focus after visibility change (needs a frame for DOM layout)
    requestAnimationFrame(() => {
      fit();
      terminalRef.current?.focus();
    });

    const observer = new ResizeObserver(() => {
      requestAnimationFrame(fit);
    });

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [visible, sendResize]);

  useEffect(() => {
    if (variant !== "claude") {
      activeClaudeRequestIdRef.current = null;
      hasOutputForClaudeRequestRef.current = false;
      awaitingClaudeOutputRef.current = false;
      setIsClaudeBooting(false);
      return;
    }
    if (!claudeLaunchRequest) {
      activeClaudeRequestIdRef.current = null;
      hasOutputForClaudeRequestRef.current = false;
      awaitingClaudeOutputRef.current = false;
      setIsClaudeBooting(false);
      return;
    }

    if (activeClaudeRequestIdRef.current !== claudeLaunchRequest.requestId) {
      activeClaudeRequestIdRef.current = claudeLaunchRequest.requestId;
      hasOutputForClaudeRequestRef.current = false;
    }

    claudeExitNotifiedRef.current = false;
    if (!hasOutputForClaudeRequestRef.current) {
      awaitingClaudeOutputRef.current = true;
      setIsClaudeBooting(true);
      return;
    }

    awaitingClaudeOutputRef.current = false;
    setIsClaudeBooting(false);
  }, [claudeLaunchRequest, variant]);

  useEffect(() => {
    if (variant !== "claude") return;
    if (!closeRequestId) return;
    if (lastCloseRequestIdRef.current === closeRequestId) return;
    lastCloseRequestIdRef.current = closeRequestId;

    let cancelled = false;
    const closeSession = async () => {
      awaitingClaudeOutputRef.current = false;
      setIsClaudeBooting(false);
      claudeExitNotifiedRef.current = true;
      await destroy();
      if (!cancelled) {
        onClaudeExit?.();
      }
    };
    void closeSession();

    return () => {
      cancelled = true;
    };
  }, [closeRequestId, destroy, onClaudeExit, variant]);

  if (error) {
    return (
      <div
        className={`flex-1 flex items-center justify-center ${text.error} text-xs`}
        style={{ display: visible ? undefined : "none" }}
      >
        Terminal error: {error}
      </div>
    );
  }

  const reconnecting = visible && !isConnected;
  const startingClaude = visible && variant === "claude" && isConnected && isClaudeBooting;

  return (
    <div
      className={`flex-1 min-h-0 relative mx-1 mb-[3px] p-1 rounded-b-lg rounded-t-none bg-[#07090d] ${reconnecting ? "terminal-reconnecting" : ""} ${startingClaude ? "terminal-booting" : ""}`}
      style={{ display: visible ? undefined : "none" }}
    >
      <div className="h-full w-full min-h-0 rounded-b-md rounded-t-none bg-black overflow-hidden px-2">
        <div ref={containerRef} className="h-full w-full min-h-0" />
      </div>
      {startingClaude && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.18),rgba(0,0,0,0.06)_52%,transparent_78%)]" />
          <div className="relative flex items-center justify-center">
            <div className="claude-rotating">
              <ClaudeIcon className="w-7 h-7 text-[#d97757]/90 claude-breathing" />
            </div>
          </div>
        </div>
      )}
      {reconnecting && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.22),rgba(0,0,0,0.08)_52%,transparent_78%)]" />
          <div className="relative flex flex-col items-center gap-2.5">
            <Spinner size="sm" className="text-white/75" />
            <span className="text-[11px] font-medium tracking-[0.11em] text-white/72">
              Reconnecting terminal...
            </span>
          </div>
        </div>
      )}
      <style>{`
        .terminal-reconnecting .xterm-cursor,
        .terminal-reconnecting .xterm-cursor-layer,
        .terminal-booting .xterm-cursor,
        .terminal-booting .xterm-cursor-layer {
          opacity: 0 !important;
        }

        .claude-breathing {
          animation: claude-breathe 1.9s infinite ease-in-out;
          transform-origin: center;
        }

        .claude-rotating {
          animation: claude-rotate 7s infinite linear;
          transform-origin: center;
        }

        @keyframes claude-breathe {
          0%, 100% {
            transform: scale(1);
            opacity: 0.86;
          }
          50% {
            transform: scale(1.24);
            opacity: 1;
          }
        }

        @keyframes claude-rotate {
          from {
            transform: rotate(0deg);
          }
          to {
            transform: rotate(360deg);
          }
        }
      `}</style>
    </div>
  );
}
