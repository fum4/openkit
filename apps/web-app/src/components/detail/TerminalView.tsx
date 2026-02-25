import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { useTerminal } from "../../hooks/useTerminal";
import { text } from "../../theme";
import { ClaudeIcon, CodexIcon, GeminiIcon, OpenCodeIcon } from "../../icons";
import { Spinner } from "../Spinner";

interface TerminalLaunchRequest {
  mode: "resume" | "start";
  prompt?: string;
  skipPermissions?: boolean;
  requestId: number;
}

interface TerminalViewProps {
  worktreeId: string;
  visible: boolean;
  variant?: "terminal" | "claude" | "codex" | "gemini" | "opencode";
  launchRequest?: TerminalLaunchRequest | null;
  closeRequestId?: number | null;
  onAgentExit?: (exitCode?: number) => void;
}

const DEFAULT_AGENT_START_PROMPT =
  "You are already in the correct worktree. Read TASK.md first, then implement the task. Treat AI context and todo checklist as highest-priority instructions.";
const AUTO_CLAUDE_DEBUG_PREFIX = "[AUTO-CLAUDE][TEMP]";

function shellQuoteSingle(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildClaudeCommand(
  prompt: string | undefined,
  options?: { skipPermissions?: boolean },
): string {
  const args: string[] = [];
  if (options?.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  }
  if (prompt) {
    args.push(shellQuoteSingle(prompt));
  }
  const invocation = args.length > 0 ? `claude ${args.join(" ")}` : "claude";
  return `exec ${invocation}`;
}

function buildCodexCommandWithOptions(
  prompt: string | undefined,
  options?: { skipPermissions?: boolean },
): string {
  const args: string[] = [];
  if (options?.skipPermissions) {
    args.push("--dangerously-bypass-approvals-and-sandbox");
  }
  if (prompt) {
    args.push(shellQuoteSingle(prompt));
  }
  const invocation = args.length > 0 ? `codex ${args.join(" ")}` : "codex";
  return `exec ${invocation}`;
}

function buildGeminiCommand(
  prompt: string | undefined,
  options?: { skipPermissions?: boolean },
): string {
  const args: string[] = [];
  if (options?.skipPermissions) {
    args.push("--yolo");
  }
  if (prompt) {
    args.push("-i", shellQuoteSingle(prompt));
  }
  const invocation = args.length > 0 ? `gemini ${args.join(" ")}` : "gemini";
  return `exec ${invocation}`;
}

function buildOpenCodeCommand(
  prompt: string | undefined,
  options?: { skipPermissions?: boolean },
): string {
  const args: string[] = [];
  if (prompt) {
    args.push("--prompt", shellQuoteSingle(prompt));
  }
  const prefix = options?.skipPermissions ? `OPENCODE_PERMISSION='{"*":"allow"}' ` : "";
  const invocation = args.length > 0 ? `${prefix}opencode ${args.join(" ")}` : `${prefix}opencode`;
  return `exec ${invocation}`;
}

export function TerminalView({
  worktreeId,
  visible,
  variant = "terminal",
  launchRequest,
  closeRequestId,
  onAgentExit,
}: TerminalViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const mountedRef = useRef(false);
  const agentExitNotifiedRef = useRef(false);
  const lastCloseRequestIdRef = useRef<number | null>(null);
  const activeRequestIdRef = useRef<number | null>(null);
  const hasOutputForRequestRef = useRef(false);
  const awaitingOutputRef = useRef(false);
  const [isAgentBooting, setIsAgentBooting] = useState(false);
  const logAutoClaude = useCallback((message: string, extra?: Record<string, unknown>) => {
    if (extra) {
      console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`, extra);
      return;
    }
    console.info(`${AUTO_CLAUDE_DEBUG_PREFIX} ${message}`);
  }, []);
  const isAgentVariant = variant !== "terminal";
  const agentLabel =
    variant === "claude"
      ? "Claude"
      : variant === "codex"
        ? "Codex"
        : variant === "gemini"
          ? "Gemini CLI"
          : variant === "opencode"
            ? "OpenCode"
            : "Terminal";

  const createSessionStartupCommand = useMemo(() => {
    if (!isAgentVariant || !launchRequest) return null;

    if (variant === "claude") {
      const commandOptions = { skipPermissions: launchRequest.skipPermissions };
      if (launchRequest.mode === "start") {
        const prompt = launchRequest.prompt?.trim() || DEFAULT_AGENT_START_PROMPT;
        return buildClaudeCommand(prompt, commandOptions);
      }
      return buildClaudeCommand(undefined, commandOptions);
    }

    if (variant === "codex") {
      const commandOptions = { skipPermissions: launchRequest.skipPermissions };
      if (launchRequest.mode === "start") {
        const prompt = launchRequest.prompt?.trim() || DEFAULT_AGENT_START_PROMPT;
        return buildCodexCommandWithOptions(prompt, commandOptions);
      }
      return buildCodexCommandWithOptions(undefined, commandOptions);
    }

    if (variant === "gemini") {
      const commandOptions = { skipPermissions: launchRequest.skipPermissions };
      if (launchRequest.mode === "start") {
        const prompt = launchRequest.prompt?.trim() || DEFAULT_AGENT_START_PROMPT;
        return buildGeminiCommand(prompt, commandOptions);
      }
      return buildGeminiCommand(undefined, commandOptions);
    }

    const commandOptions = { skipPermissions: launchRequest.skipPermissions };
    if (launchRequest.mode === "start") {
      const prompt = launchRequest.prompt?.trim() || DEFAULT_AGENT_START_PROMPT;
      return buildOpenCodeCommand(prompt, commandOptions);
    }
    return buildOpenCodeCommand(undefined, commandOptions);
  }, [isAgentVariant, launchRequest, variant]);

  useEffect(() => {
    if (!isAgentVariant || !launchRequest) return;
    logAutoClaude(`${agentLabel} terminal launch request received`, {
      worktreeId,
      requestId: launchRequest.requestId,
      mode: launchRequest.mode,
      hasPrompt: Boolean(launchRequest.prompt?.trim()),
      skipPermissions: launchRequest.skipPermissions ?? false,
    });
  }, [agentLabel, isAgentVariant, launchRequest, logAutoClaude, worktreeId]);

  const handleData = useCallback(
    (data: string) => {
      if (isAgentVariant && launchRequest) {
        if (activeRequestIdRef.current !== launchRequest.requestId) {
          activeRequestIdRef.current = launchRequest.requestId;
        }
        hasOutputForRequestRef.current = true;
        if (awaitingOutputRef.current || isAgentBooting) {
          awaitingOutputRef.current = false;
          setIsAgentBooting(false);
        }
      }

      terminalRef.current?.write(data);
    },
    [isAgentBooting, isAgentVariant, launchRequest],
  );

  const handleExit = useCallback(
    (exitCode: number) => {
      awaitingOutputRef.current = false;
      setIsAgentBooting(false);
      if (isAgentVariant && !agentExitNotifiedRef.current) {
        agentExitNotifiedRef.current = true;
        onAgentExit?.(exitCode);
      }
      terminalRef.current?.write(`\r\n\x1b[90m[Process exited with code ${exitCode}]\x1b[0m\r\n`);
    },
    [isAgentVariant, onAgentExit],
  );

  const getSize = useCallback(() => {
    const terminal = terminalRef.current;
    if (!terminal) return null;
    return { cols: terminal.cols, rows: terminal.rows };
  }, []);

  const { error, isConnected, sendData, sendResize, connect, disconnect, destroy } = useTerminal({
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
    if (!isAgentVariant) {
      activeRequestIdRef.current = null;
      hasOutputForRequestRef.current = false;
      awaitingOutputRef.current = false;
      setIsAgentBooting(false);
      return;
    }
    if (!launchRequest) {
      activeRequestIdRef.current = null;
      hasOutputForRequestRef.current = false;
      awaitingOutputRef.current = false;
      setIsAgentBooting(false);
      return;
    }

    if (activeRequestIdRef.current !== launchRequest.requestId) {
      activeRequestIdRef.current = launchRequest.requestId;
      hasOutputForRequestRef.current = false;
    }

    agentExitNotifiedRef.current = false;
    if (!hasOutputForRequestRef.current) {
      awaitingOutputRef.current = true;
      setIsAgentBooting(true);
      return;
    }

    awaitingOutputRef.current = false;
    setIsAgentBooting(false);
  }, [isAgentVariant, launchRequest]);

  useEffect(() => {
    if (!isAgentVariant) return;
    if (!closeRequestId) return;
    if (lastCloseRequestIdRef.current === closeRequestId) return;
    lastCloseRequestIdRef.current = closeRequestId;

    let cancelled = false;
    const closeSession = async () => {
      awaitingOutputRef.current = false;
      setIsAgentBooting(false);
      agentExitNotifiedRef.current = true;
      await destroy();
      if (!cancelled) {
        onAgentExit?.();
      }
    };
    void closeSession();

    return () => {
      cancelled = true;
    };
  }, [closeRequestId, destroy, isAgentVariant, onAgentExit]);

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
  const startingAgent = visible && isAgentVariant && isConnected && isAgentBooting;

  return (
    <div
      className={`flex-1 min-h-0 relative mx-1 mb-[4px] p-1 rounded-t-xl rounded-b-lg bg-[#07090d] ${reconnecting ? "terminal-reconnecting" : ""} ${startingAgent ? "terminal-booting" : ""}`}
      style={{ display: visible ? undefined : "none" }}
    >
      <div className="h-full w-full min-h-0 rounded-t-lg rounded-b-md bg-black overflow-hidden px-2">
        <div ref={containerRef} className="h-full w-full min-h-0" />
      </div>
      {startingAgent && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,0,0,0.18),rgba(0,0,0,0.06)_52%,transparent_78%)]" />
          <div className="relative flex items-center justify-center">
            <div className="claude-rotating">
              {variant === "claude" ? (
                <ClaudeIcon className="w-7 h-7 text-[#d97757]/90 claude-breathing" />
              ) : variant === "codex" ? (
                <CodexIcon className="w-7 h-7 text-white/90 claude-breathing" />
              ) : variant === "gemini" ? (
                <GeminiIcon className="w-7 h-7 text-[#8AB4FF]/95 claude-breathing" />
              ) : (
                <OpenCodeIcon className="w-7 h-7 text-[#78D0A9]/95 claude-breathing" />
              )}
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
