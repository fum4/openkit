import { Link, useLocalSearchParams } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Keyboard,
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  type NativeSyntheticEvent,
  type TextInputSubmitEditingEventData,
} from "react-native";

import {
  connectMobileAgentSession,
  connectToGatewayFromQrData,
  connectToGatewayFromToken,
  ensureFreshGatewaySession,
  fetchMobileAgentSessions,
  fetchMobileGatewayContext,
  fetchMobileWorktrees,
  getErrorMessage,
  getMobileSessionWebSocketUrl,
  getStringParam,
  refreshGatewaySession,
  type GatewayConnection,
  type MobileAgentScope,
  type MobileAgentSessionSummary,
  type MobileGatewayContext,
  type MobileWorktreeSummary,
} from "./lib/ngrok-connect";
import { TerminalWebView, type TerminalWebViewHandle } from "./components/TerminalWebView";

type ConnectionStatus = "connecting" | "connected" | "error";

interface ConnectionState {
  status: ConnectionStatus;
  message: string;
}

type ReactNativeWebSocketCtor = new (
  uri: string,
  protocols?: string | string[] | null,
  options?: { headers: Record<string, string> },
) => WebSocket;
const ReactNativeWebSocket = WebSocket as unknown as ReactNativeWebSocketCtor;
const MAX_TERMINAL_RECONNECT_ATTEMPTS = 8;
const TERMINAL_RECONNECT_DELAY_MS = 1200;
const TERMINAL_HEARTBEAT_INTERVAL_MS = 8000;
const TERMINAL_HEARTBEAT_TIMEOUT_MS = 25000;
const MAX_TERMINAL_DEBUG_LINES = 32;
const TERMINAL_CONTROL_KEYS: Array<{ label: string; sequence: string }> = [
  { label: "Esc", sequence: "\u001b" },
  { label: "Tab", sequence: "\t" },
  { label: "Up", sequence: "\u001b[A" },
  { label: "Down", sequence: "\u001b[B" },
  { label: "Left", sequence: "\u001b[D" },
  { label: "Right", sequence: "\u001b[C" },
  { label: "Ctrl+C", sequence: "\u0003" },
  { label: "Ctrl+D", sequence: "\u0004" },
];

function redactAccessTokenInUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.searchParams.has("accessToken")) {
      parsed.searchParams.set("accessToken", "<redacted>");
    }
    return parsed.toString();
  } catch {
    return rawUrl.replace(/accessToken=[^&]+/, "accessToken=<redacted>");
  }
}

export default function DeepLinkConnectScreen() {
  const params = useLocalSearchParams<{
    origin?: string | string[];
    token?: string | string[];
    pairUrl?: string | string[];
  }>();

  const [session, setSession] = useState<GatewayConnection | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>({
    status: "connecting",
    message: "Reading deep link and connecting to ngrok gateway...",
  });
  const [context, setContext] = useState<MobileGatewayContext | null>(null);
  const [worktrees, setWorktrees] = useState<MobileWorktreeSummary[]>([]);
  const [worktreesLoading, setWorktreesLoading] = useState(false);
  const [selectedWorktreeId, setSelectedWorktreeId] = useState<string | null>(null);
  const [selectedScope, setSelectedScope] = useState<MobileAgentScope>("claude");
  const [scopeSessions, setScopeSessions] = useState<MobileAgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [startPrompt, setStartPrompt] = useState("");
  const [isConnectingSession, setIsConnectingSession] = useState(false);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [terminalConnected, setTerminalConnected] = useState(false);
  const [terminalStatus, setTerminalStatus] = useState("No agent session attached yet.");
  const [terminalDebugLines, setTerminalDebugLines] = useState<string[]>([]);
  const [terminalInput, setTerminalInput] = useState("");
  const [isTerminalSheetOpen, setIsTerminalSheetOpen] = useState(false);

  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<TerminalWebViewHandle | null>(null);
  const sessionRef = useRef<GatewayConnection | null>(null);
  const activeSessionIdRef = useRef<string | null>(null);
  const selectedWorktreeIdRef = useRef<string | null>(null);
  const selectedScopeRef = useRef<MobileAgentScope>("claude");
  const openTerminalSocketRef = useRef<
    | ((connectedSession: GatewayConnection, agentSessionId: string, isRetry?: boolean) => void)
    | null
  >(null);
  const attemptedPairingKeyRef = useRef<string | null>(null);
  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSocketErrorHintRef = useRef<string | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastPongAtRef = useRef(0);
  const lastWsUrlRef = useRef<string | null>(null);
  const pendingBootstrapPromptRef = useRef<string | null>(null);

  const pairUrl = useMemo(() => getStringParam(params.pairUrl), [params.pairUrl]);
  const origin = useMemo(() => getStringParam(params.origin), [params.origin]);
  const token = useMemo(() => getStringParam(params.token), [params.token]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    selectedWorktreeIdRef.current = selectedWorktreeId;
  }, [selectedWorktreeId]);

  useEffect(() => {
    selectedScopeRef.current = selectedScope;
  }, [selectedScope]);

  const appendTerminalDebug = useCallback((message: string) => {
    const timestamp = new Date().toISOString().slice(11, 19);
    const line = `${timestamp} ${message}`;
    setTerminalDebugLines((previous) => {
      const next = [...previous, line];
      if (next.length <= MAX_TERMINAL_DEBUG_LINES) return next;
      return next.slice(next.length - MAX_TERMINAL_DEBUG_LINES);
    });
  }, []);

  const closeTerminalSocket = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (heartbeatTimerRef.current !== null) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
    lastPongAtRef.current = 0;
    const socket = socketRef.current;
    socketRef.current = null;
    if (socket) {
      try {
        socket.close();
      } catch {
        // ignore close errors
      }
    }
    setTerminalConnected(false);
  }, []);

  useEffect(() => {
    return () => {
      closeTerminalSocket();
    };
  }, [closeTerminalSocket]);

  const sendSocketData = useCallback((payload: string): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      setTerminalStatus("Session is not connected.");
      return false;
    }

    try {
      socket.send(payload);
      return true;
    } catch {
      setTerminalStatus("Failed to send input to terminal session.");
      return false;
    }
  }, []);

  const sendSocketResize = useCallback((cols: number, rows: number) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    try {
      socket.send(JSON.stringify({ type: "resize", cols, rows }));
    } catch {
      // ignore resize failures; later events will retry.
    }
  }, []);

  const recoverTerminalSession = useCallback(
    async (options?: { forceTokenRefresh?: boolean }): Promise<boolean> => {
      const currentSession = sessionRef.current;
      const worktreeId = selectedWorktreeIdRef.current;
      const scope = selectedScopeRef.current;
      if (!currentSession || !worktreeId) return false;
      appendTerminalDebug(
        `recover start scope=${scope} worktree=${worktreeId} forceRefresh=${options?.forceTokenRefresh === true}`,
      );

      let authSession = currentSession;
      try {
        if (options?.forceTokenRefresh) {
          const refreshed = await refreshGatewaySession(
            currentSession.gatewayOrigin,
            currentSession.sessionJwt,
          );
          authSession = {
            ...currentSession,
            sessionJwt: refreshed.sessionJwt,
            sessionExpiresAtMs: refreshed.sessionExpiresAtMs,
          };
        } else {
          authSession = await ensureFreshGatewaySession(currentSession);
        }
        setSession(authSession);
      } catch (error) {
        setTerminalStatus(`Reconnect failed during auth refresh: ${getErrorMessage(error)}`);
        appendTerminalDebug(`recover auth refresh failed: ${getErrorMessage(error)}`);
        return false;
      }

      try {
        const latest = await fetchMobileAgentSessions(authSession, worktreeId);
        setSession(latest.session);
        authSession = latest.session;
        setScopeSessions(latest.sessions);

        const latestSessionId =
          latest.sessions.find((entry) => entry.scope === scope)?.sessionId ?? null;
        if (latestSessionId) {
          setActiveSessionId(latestSessionId);
          activeSessionIdRef.current = latestSessionId;
          setTerminalStatus(`Recovering ${scope} session ${latestSessionId}...`);
          appendTerminalDebug(`recover found latest scoped session=${latestSessionId}`);
          setIsTerminalSheetOpen(true);
          openTerminalSocketRef.current?.(latest.session, latestSessionId, true);
          return true;
        }
        appendTerminalDebug(`recover no existing scoped session for scope=${scope}; will create`);
      } catch {
        // Fallback to create-or-attach route below.
        appendTerminalDebug("recover latest-session lookup failed; falling back to connect/start");
      }

      try {
        const result = await connectMobileAgentSession(authSession, {
          worktreeId,
          scope,
          startIfMissing: true,
          cols: 120,
          rows: 30,
        });

        setSession(result.session);
        setActiveSessionId(result.result.sessionId);
        activeSessionIdRef.current = result.result.sessionId;
        if (result.result.created) {
          terminalRef.current?.clear();
        }
        setTerminalStatus(
          result.result.created
            ? `Recovered by starting ${scope} session ${result.result.sessionId}.`
            : `Recovered ${scope} session ${result.result.sessionId}.`,
        );
        appendTerminalDebug(
          `recover connect succeeded session=${result.result.sessionId} created=${result.result.created}`,
        );
        setIsTerminalSheetOpen(true);
        openTerminalSocketRef.current?.(result.session, result.result.sessionId, true);

        const sessionsResult = await fetchMobileAgentSessions(result.session, worktreeId);
        setSession(sessionsResult.session);
        setScopeSessions(sessionsResult.sessions);
        return true;
      } catch (error) {
        setTerminalStatus(`Reconnect failed: ${getErrorMessage(error)}`);
        appendTerminalDebug(`recover failed: ${getErrorMessage(error)}`);
        return false;
      }
    },
    [appendTerminalDebug],
  );

  const tryAttachLatestScopedSession = useCallback(async (): Promise<boolean> => {
    const currentSession = sessionRef.current;
    const worktreeId = selectedWorktreeIdRef.current;
    const scope = selectedScopeRef.current;
    if (!currentSession || !worktreeId) return false;

    try {
      const latest = await fetchMobileAgentSessions(currentSession, worktreeId);
      setSession(latest.session);
      setScopeSessions(latest.sessions);

      const latestSessionId =
        latest.sessions.find((entry) => entry.scope === scope)?.sessionId ?? null;
      if (!latestSessionId) return false;
      if (latestSessionId === activeSessionIdRef.current) return false;

      setActiveSessionId(latestSessionId);
      activeSessionIdRef.current = latestSessionId;
      setTerminalStatus(`Switching to latest ${scope} session ${latestSessionId}...`);
      appendTerminalDebug(`reattach switched to newer scoped session=${latestSessionId}`);
      setIsTerminalSheetOpen(true);
      openTerminalSocketRef.current?.(latest.session, latestSessionId, true);
      return true;
    } catch {
      appendTerminalDebug("reattach latest scoped session lookup failed");
      return false;
    }
  }, [appendTerminalDebug]);

  const openTerminalSocket = useCallback(
    (connectedSession: GatewayConnection, agentSessionId: string, isRetry = false) => {
      if (!isRetry) {
        reconnectAttemptsRef.current = 0;
      }

      closeTerminalSocket();
      setTerminalStatus(
        isRetry
          ? `Reconnecting to agent session ${agentSessionId}...`
          : `Connecting to agent session ${agentSessionId}...`,
      );

      const wsUrl = getMobileSessionWebSocketUrl(connectedSession, agentSessionId);
      const wsDebugUrl = redactAccessTokenInUrl(wsUrl);
      lastWsUrlRef.current = wsDebugUrl;
      appendTerminalDebug(
        `ws open attempt retry=${isRetry} session=${agentSessionId} url=${wsDebugUrl}`,
      );
      const socket = new ReactNativeWebSocket(wsUrl, undefined, {
        headers: {
          authorization: `Bearer ${connectedSession.sessionJwt}`,
        },
      });
      socketRef.current = socket;
      let sawExitMessage = false;
      lastSocketErrorHintRef.current = null;

      socket.onopen = () => {
        if (socketRef.current !== socket) return;
        reconnectAttemptsRef.current = 0;
        lastSocketErrorHintRef.current = null;
        if (heartbeatTimerRef.current !== null) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        lastPongAtRef.current = Date.now();
        heartbeatTimerRef.current = setInterval(() => {
          if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
            return;
          }
          const now = Date.now();
          if (now - lastPongAtRef.current > TERMINAL_HEARTBEAT_TIMEOUT_MS) {
            setTerminalStatus("Terminal heartbeat timed out. Reconnecting...");
            try {
              socket.close();
            } catch {
              // ignore close failure and let reconnect loop handle it
            }
            return;
          }
          try {
            socket.send(JSON.stringify({ type: "ping" }));
          } catch {
            // ignore keepalive send failures; close handler will recover
          }
        }, TERMINAL_HEARTBEAT_INTERVAL_MS);
        setTerminalConnected(true);
        setTerminalStatus(
          isRetry
            ? `Reconnected to ${selectedScope} session ${agentSessionId}.`
            : `Connected to ${selectedScope} session ${agentSessionId}.`,
        );
        appendTerminalDebug(`ws open success session=${agentSessionId}`);
        const bootstrapPrompt = pendingBootstrapPromptRef.current;
        if (bootstrapPrompt && activeSessionIdRef.current === agentSessionId) {
          pendingBootstrapPromptRef.current = null;
          try {
            socket.send(`${bootstrapPrompt}\n`);
            appendTerminalDebug(`ws bootstrap prompt sent chars=${bootstrapPrompt.length}`);
          } catch {
            appendTerminalDebug("ws bootstrap prompt send failed");
          }
        }
        terminalRef.current?.focus();
      };

      socket.onmessage = (event) => {
        if (socketRef.current !== socket) return;
        if (typeof event.data !== "string") return;

        try {
          const payload = JSON.parse(event.data);
          if (payload?.type === "exit") {
            sawExitMessage = true;
            terminalRef.current?.write(
              `\r\n[Session exited: ${payload.exitCode ?? "unknown"}]\r\n`,
            );
            setActiveSessionId(null);
            activeSessionIdRef.current = null;
            setTerminalConnected(false);
            setIsTerminalSheetOpen(false);
            setTerminalStatus(`Session exited (${payload.exitCode ?? "unknown"}).`);
            appendTerminalDebug(`ws received exit event code=${payload.exitCode ?? "unknown"}`);
            return;
          }
          if (payload?.type === "pong") {
            lastPongAtRef.current = Date.now();
            return;
          }
        } catch {
          // treat as terminal output
        }

        terminalRef.current?.write(event.data);
      };

      socket.onerror = (event: unknown) => {
        if (socketRef.current !== socket) return;
        let errorHintForDebug = "";
        if (
          typeof event === "object" &&
          event !== null &&
          "message" in event &&
          typeof (event as { message?: unknown }).message === "string"
        ) {
          lastSocketErrorHintRef.current = (event as { message: string }).message;
          errorHintForDebug = lastSocketErrorHintRef.current;
        }
        setTerminalConnected(false);
        setTerminalStatus("Terminal websocket error. Trying to reconnect...");
        appendTerminalDebug(
          `ws error session=${agentSessionId}${errorHintForDebug ? ` hint=${errorHintForDebug}` : ""}`,
        );
      };

      socket.onclose = (event) => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        if (heartbeatTimerRef.current !== null) {
          clearInterval(heartbeatTimerRef.current);
          heartbeatTimerRef.current = null;
        }
        lastPongAtRef.current = 0;
        setTerminalConnected(false);

        const reason = event.reason?.trim();
        const errorHint = lastSocketErrorHintRef.current?.trim() ?? "";
        lastSocketErrorHintRef.current = null;
        const has404Hint = errorHint.includes("404");
        const reasonSuffix = reason ? `: ${reason}` : "";

        if (sawExitMessage) {
          appendTerminalDebug(`ws closed after exit message session=${agentSessionId}`);
          return;
        }

        if (event.code === 1006 && has404Hint) {
          setTerminalStatus(
            `Terminal endpoint returned 404. Attempting recovery (${lastWsUrlRef.current ?? "unknown-url"}).`,
          );
        }
        if (event.code === 1008 && reason === "project-forbidden") {
          setTerminalStatus("Terminal disconnected: project access denied.");
          return;
        }
        if (event.code === 1008 && reason === "scope-forbidden") {
          setTerminalStatus("Terminal disconnected: scope is not allowed.");
          return;
        }

        const latestSession = sessionRef.current;
        const sameActiveSession = activeSessionIdRef.current === agentSessionId;
        appendTerminalDebug(
          `ws close code=${event.code} reason=${reason || "-"} hint=${errorHint || "-"} session=${agentSessionId} activeRef=${activeSessionIdRef.current ?? "null"} sameActive=${sameActiveSession} latestSession=${latestSession ? "yes" : "no"}`,
        );
        if (!latestSession || !sameActiveSession) {
          appendTerminalDebug(
            "ws close skipped recovery due to stale/missing active session state",
          );
          setTerminalStatus(`Terminal disconnected (${event.code}${reasonSuffix}).`);
          return;
        }

        if (reconnectAttemptsRef.current >= MAX_TERMINAL_RECONNECT_ATTEMPTS) {
          setTerminalStatus(
            `Terminal disconnected (${event.code}${reasonSuffix}). Reconnect limit reached. Use Connect / Start Session to retry.`,
          );
          return;
        }

        reconnectAttemptsRef.current += 1;
        const attempt = reconnectAttemptsRef.current;
        const forceTokenRefresh = event.code === 1008 && reason === "unauthenticated";
        const delayMs = TERMINAL_RECONNECT_DELAY_MS * attempt;
        appendTerminalDebug(
          `ws scheduling recovery attempt=${attempt}/${MAX_TERMINAL_RECONNECT_ATTEMPTS} delayMs=${delayMs} forceTokenRefresh=${forceTokenRefresh}`,
        );
        setTerminalStatus(
          `Terminal disconnected (${event.code}${reasonSuffix}). Recovering ${attempt}/${MAX_TERMINAL_RECONNECT_ATTEMPTS}...`,
        );

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (activeSessionIdRef.current !== agentSessionId) {
            appendTerminalDebug(
              `ws recovery cancelled; active session changed from ${agentSessionId} to ${activeSessionIdRef.current ?? "null"}`,
            );
            return;
          }

          void (async () => {
            const recovered = await recoverTerminalSession({ forceTokenRefresh });
            appendTerminalDebug(`ws recovery result recovered=${recovered}`);
            if (!recovered && event.code === 1008 && reason === "session-not-found") {
              const switched = await tryAttachLatestScopedSession();
              appendTerminalDebug(`ws session-not-found reattach switched=${switched}`);
              if (!switched) {
                setTerminalStatus(
                  "Terminal disconnected: session no longer exists. Use Connect / Start Session to start a fresh agent.",
                );
              }
            }
          })();
        }, delayMs);
      };
    },
    [
      appendTerminalDebug,
      closeTerminalSocket,
      recoverTerminalSession,
      selectedScope,
      tryAttachLatestScopedSession,
    ],
  );

  useEffect(() => {
    openTerminalSocketRef.current = openTerminalSocket;
  }, [openTerminalSocket]);

  const loadWorktreeSessions = useCallback(
    async (activeSession: GatewayConnection, worktreeId: string) => {
      setSessionsLoading(true);
      try {
        const result = await fetchMobileAgentSessions(activeSession, worktreeId);
        setSession(result.session);
        setScopeSessions(result.sessions);
      } catch (error) {
        setConnectionState({
          status: "error",
          message: getErrorMessage(error),
        });
      } finally {
        setSessionsLoading(false);
      }
    },
    [],
  );

  const loadMobileContext = useCallback(async (activeSession: GatewayConnection) => {
    setWorktreesLoading(true);
    try {
      const contextResult = await fetchMobileGatewayContext(activeSession);
      const worktreeResult = await fetchMobileWorktrees(contextResult.session);

      setSession(worktreeResult.session);
      setContext(contextResult.context);
      setWorktrees(worktreeResult.worktrees);

      const supportedScopes = contextResult.context.scopes;
      setSelectedScope((previous) => {
        if (supportedScopes.includes(previous)) return previous;
        return supportedScopes[0] ?? "claude";
      });

      setSelectedWorktreeId((previous) => {
        if (previous && worktreeResult.worktrees.some((worktree) => worktree.id === previous)) {
          return previous;
        }
        return worktreeResult.worktrees[0]?.id ?? null;
      });
      setConnectionState({
        status: "connected",
        message: "Connected. Select a worktree and agent scope.",
      });
    } catch (error) {
      setConnectionState({
        status: "error",
        message: getErrorMessage(error),
      });
    } finally {
      setWorktreesLoading(false);
    }
  }, []);

  const connectFromDeepLink = useCallback(async () => {
    try {
      let connectedGateway: GatewayConnection;
      if (pairUrl) {
        connectedGateway = await connectToGatewayFromQrData(pairUrl);
      } else if (origin && token) {
        connectedGateway = await connectToGatewayFromToken(origin, token);
      } else {
        throw new Error("Missing deep-link params. Expected origin+token or pairUrl.");
      }

      setSession(connectedGateway);
      appendTerminalDebug(`gateway paired origin=${connectedGateway.gatewayOrigin}`);
      await loadMobileContext(connectedGateway);
    } catch (error) {
      appendTerminalDebug(`gateway pairing failed: ${getErrorMessage(error)}`);
      setConnectionState({
        status: "error",
        message: getErrorMessage(error),
      });
    }
  }, [appendTerminalDebug, loadMobileContext, origin, pairUrl, token]);

  useEffect(() => {
    if (!pairUrl && !(origin && token)) {
      attemptedPairingKeyRef.current = null;
      setConnectionState({
        status: "error",
        message: "Missing deep-link params. Open this screen using the pairing QR link.",
      });
      return;
    }

    const pairingKey = pairUrl ? `pair:${pairUrl}` : `${origin}:${token}`;
    if (attemptedPairingKeyRef.current === pairingKey) {
      return;
    }
    attemptedPairingKeyRef.current = pairingKey;

    void connectFromDeepLink();
  }, [connectFromDeepLink, origin, pairUrl, token]);

  useEffect(() => {
    if (!session || !selectedWorktreeId) {
      setScopeSessions([]);
      return;
    }
    void loadWorktreeSessions(session, selectedWorktreeId);
  }, [loadWorktreeSessions, selectedWorktreeId, session]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const refreshIfNeeded = async () => {
      try {
        const refreshed = await ensureFreshGatewaySession(session);
        if (cancelled) return;
        if (
          refreshed.sessionJwt !== session.sessionJwt ||
          refreshed.sessionExpiresAtMs !== session.sessionExpiresAtMs
        ) {
          setSession(refreshed);
        }
      } catch (error) {
        if (cancelled) return;
        closeTerminalSocket();
        setConnectionState({
          status: "error",
          message: getErrorMessage(error),
        });
      }
    };

    void refreshIfNeeded();
    const refreshInterval = setInterval(() => {
      void refreshIfNeeded();
    }, 30_000);

    return () => {
      cancelled = true;
      clearInterval(refreshInterval);
    };
  }, [closeTerminalSocket, session]);

  const connectSelectedSession = useCallback(async () => {
    if (!session || !selectedWorktreeId) {
      setConnectionState({
        status: "error",
        message: "Select a worktree before connecting.",
      });
      return;
    }

    setIsConnectingSession(true);
    setTerminalStatus("Connecting to selected agent session...");
    pendingBootstrapPromptRef.current = null;

    try {
      const result = await connectMobileAgentSession(session, {
        worktreeId: selectedWorktreeId,
        scope: selectedScope,
        startIfMissing: true,
        prompt: undefined,
        cols: 120,
        rows: 30,
      });

      setSession(result.session);
      setActiveSessionId(result.result.sessionId);
      activeSessionIdRef.current = result.result.sessionId;
      const bootstrapPrompt = startPrompt.trim();
      pendingBootstrapPromptRef.current =
        result.result.created && bootstrapPrompt.length > 0 ? bootstrapPrompt : null;
      appendTerminalDebug(
        `connect selected scope=${selectedScope} worktree=${selectedWorktreeId} session=${result.result.sessionId} created=${result.result.created}`,
      );
      if (result.result.created) {
        terminalRef.current?.clear();
      }
      setTerminalStatus(
        result.result.created
          ? `Started new ${selectedScope} session ${result.result.sessionId}.`
          : `Attached existing ${selectedScope} session ${result.result.sessionId}.`,
      );
      setIsTerminalSheetOpen(true);
      openTerminalSocket(result.session, result.result.sessionId);

      const sessionsResult = await fetchMobileAgentSessions(result.session, selectedWorktreeId);
      setSession(sessionsResult.session);
      setScopeSessions(sessionsResult.sessions);
    } catch (error) {
      appendTerminalDebug(`connect selected failed: ${getErrorMessage(error)}`);
      setConnectionState({
        status: "error",
        message: getErrorMessage(error),
      });
      setTerminalStatus("Could not connect to the selected agent session.");
    } finally {
      setIsConnectingSession(false);
    }
  }, [
    appendTerminalDebug,
    openTerminalSocket,
    selectedScope,
    selectedWorktreeId,
    session,
    startPrompt,
  ]);

  const sendTerminalInput = useCallback(
    (appendNewline: boolean) => {
      const payload = appendNewline ? `${terminalInput}\n` : terminalInput;
      if (!payload) return;
      const sent = sendSocketData(payload);
      if (sent) {
        setTerminalInput("");
      }
    },
    [sendSocketData, terminalInput],
  );

  const handleSubmitInput = useCallback(
    (_event: NativeSyntheticEvent<TextInputSubmitEditingEventData>) => {
      sendTerminalInput(true);
    },
    [sendTerminalInput],
  );

  const handleTerminalInput = useCallback(
    (data: string) => {
      void sendSocketData(data);
    },
    [sendSocketData],
  );

  const handleTerminalResize = useCallback(
    (cols: number, rows: number) => {
      sendSocketResize(cols, rows);
    },
    [sendSocketResize],
  );

  const sendControlSequence = useCallback(
    (sequence: string) => {
      void sendSocketData(sequence);
    },
    [sendSocketData],
  );

  const hideKeyboard = useCallback(() => {
    Keyboard.dismiss();
    terminalRef.current?.blur();
  }, []);

  const closeTerminalSheet = useCallback(() => {
    hideKeyboard();
    setIsTerminalSheetOpen(false);
  }, [hideKeyboard]);

  const openTerminalSheet = useCallback(() => {
    setIsTerminalSheetOpen(true);
  }, []);

  const canConnectSession = Boolean(session && selectedWorktreeId && context);

  return (
    <TouchableWithoutFeedback onPress={hideKeyboard} accessible={false}>
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <ScrollView
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="never"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.panel}>
            <Text style={styles.title}>OpenKit Mobile Agent Bridge</Text>
            <Text style={styles.message}>{connectionState.message}</Text>

            {session ? (
              <View style={styles.detailCard}>
                <Text style={styles.detailText}>Gateway: {session.gatewayOrigin}</Text>
                <Text style={styles.detailText}>Project ID: {session.projectId}</Text>
                {session.projectName ? (
                  <Text style={styles.detailText}>Project: {session.projectName}</Text>
                ) : null}
                {session.service ? (
                  <Text style={styles.detailText}>Service: {session.service}</Text>
                ) : null}
              </View>
            ) : null}

            <View style={styles.section}>
              <View style={styles.sectionHeaderRow}>
                <Text style={styles.sectionTitle}>Worktrees</Text>
                <Pressable
                  style={styles.inlineButton}
                  onPress={() => {
                    if (!session) return;
                    void loadMobileContext(session);
                  }}
                  disabled={!session || worktreesLoading}
                >
                  <Text style={styles.inlineButtonText}>
                    {worktreesLoading ? "Refreshing..." : "Refresh"}
                  </Text>
                </Pressable>
              </View>
              {worktrees.length === 0 ? (
                <Text style={styles.emptyText}>No worktrees available for this project.</Text>
              ) : (
                <View style={styles.optionGrid}>
                  {worktrees.map((worktree) => {
                    const selected = selectedWorktreeId === worktree.id;
                    return (
                      <Pressable
                        key={worktree.id}
                        style={[styles.optionCard, selected ? styles.optionCardSelected : null]}
                        onPress={() => setSelectedWorktreeId(worktree.id)}
                      >
                        <Text style={styles.optionTitle}>{worktree.id}</Text>
                        <Text style={styles.optionMeta}>{worktree.branch}</Text>
                        <Text style={styles.optionMeta}>Status: {worktree.status}</Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Agent Scope</Text>
              <View style={styles.scopeRow}>
                {(context?.scopes ?? ["claude", "codex", "gemini", "opencode"]).map((scope) => {
                  const selected = selectedScope === scope;
                  return (
                    <Pressable
                      key={scope}
                      style={[styles.scopeButton, selected ? styles.scopeButtonSelected : null]}
                      onPress={() => setSelectedScope(scope)}
                    >
                      <Text style={styles.scopeButtonText}>{scope}</Text>
                    </Pressable>
                  );
                })}
              </View>

              <TextInput
                style={styles.promptInput}
                value={startPrompt}
                onChangeText={setStartPrompt}
                placeholder="Optional prompt when starting a missing session"
                placeholderTextColor="#7f8ea8"
                multiline
              />

              {sessionsLoading ? (
                <Text style={styles.message}>Loading scope sessions...</Text>
              ) : (
                <View style={styles.sessionsCard}>
                  {scopeSessions.map((entry) => (
                    <Text key={entry.scope} style={styles.sessionRowText}>
                      {entry.scope}: {entry.sessionId ? entry.sessionId : "none"}
                    </Text>
                  ))}
                </View>
              )}

              <Pressable
                style={[styles.buttonPrimary, !canConnectSession ? styles.buttonDisabled : null]}
                onPress={() => void connectSelectedSession()}
                disabled={!canConnectSession || isConnectingSession}
              >
                <Text style={styles.buttonPrimaryText}>
                  {isConnectingSession ? "Connecting..." : "Connect / Start Session"}
                </Text>
              </Pressable>

              {activeSessionId ? (
                <Text style={styles.metaLine}>Active session: {activeSessionId}</Text>
              ) : null}
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Terminal</Text>
              <Text style={styles.metaLine}>{terminalStatus}</Text>
              <Text style={styles.metaLine}>
                {terminalConnected ? "Connected" : "Disconnected"}
              </Text>
              <View style={styles.debugCard}>
                <Text style={styles.debugTitle}>Debug</Text>
                {terminalDebugLines.length === 0 ? (
                  <Text style={styles.debugLine}>No terminal debug events yet.</Text>
                ) : (
                  terminalDebugLines.slice(-8).map((line, index) => (
                    <Text key={`${index}-${line}`} style={styles.debugLine}>
                      {line}
                    </Text>
                  ))
                )}
              </View>
              <Pressable
                style={[
                  styles.buttonSecondaryStandalone,
                  !activeSessionId ? styles.buttonDisabled : null,
                ]}
                onPress={openTerminalSheet}
                disabled={!activeSessionId}
              >
                <Text style={styles.buttonSecondaryText}>
                  {activeSessionId ? "Open Terminal Sheet" : "Connect a Session First"}
                </Text>
              </Pressable>
            </View>

            <Link href="/" style={styles.linkText}>
              Open QR Scanner
            </Link>
          </View>
        </ScrollView>

        <Modal
          visible={isTerminalSheetOpen}
          transparent
          animationType="slide"
          onRequestClose={closeTerminalSheet}
        >
          <SafeAreaView style={styles.sheetOverlay}>
            <Pressable style={styles.sheetBackdrop} onPress={hideKeyboard} />
            <TouchableWithoutFeedback onPress={hideKeyboard} accessible={false}>
              <View style={styles.sheetContainer}>
                <View style={styles.sheetHandle} />
                <View style={styles.sheetHeaderRow}>
                  <View>
                    <Text style={styles.sheetTitle}>Terminal</Text>
                    <Text style={styles.sheetSubtitle}>
                      {selectedScope.toUpperCase()} · {activeSessionId ?? "No Session"}
                    </Text>
                  </View>
                  <Pressable style={styles.sheetCloseButton} onPress={closeTerminalSheet}>
                    <Text style={styles.sheetCloseButtonText}>Close</Text>
                  </Pressable>
                </View>

                <Text style={styles.metaLine}>{terminalStatus}</Text>
                <Text style={styles.metaLine}>
                  {terminalConnected ? "Connected" : "Disconnected"}
                </Text>

                <View style={styles.sheetTerminalArea}>
                  <TerminalWebView
                    ref={terminalRef}
                    onInput={handleTerminalInput}
                    onResize={handleTerminalResize}
                  />
                  <View style={styles.floatingActionRail}>
                    <Pressable
                      style={styles.floatingActionButton}
                      onPress={() => {
                        if (terminalInput.trim().length > 0) {
                          sendTerminalInput(true);
                          return;
                        }
                        sendControlSequence("\n");
                      }}
                    >
                      <Text style={styles.floatingActionText}>Submit</Text>
                    </Pressable>
                    <Pressable
                      style={styles.floatingActionButton}
                      onPress={() => sendControlSequence("\u001b")}
                    >
                      <Text style={styles.floatingActionText}>Esc</Text>
                    </Pressable>
                    {TERMINAL_CONTROL_KEYS.map((control) => (
                      <Pressable
                        key={control.label}
                        style={styles.floatingActionButton}
                        onPress={() => sendControlSequence(control.sequence)}
                      >
                        <Text style={styles.floatingActionText}>{control.label}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={styles.floatingActionButton} onPress={hideKeyboard}>
                      <Text style={styles.floatingActionText}>Hide</Text>
                    </Pressable>
                  </View>
                </View>

                <TextInput
                  style={styles.terminalInput}
                  value={terminalInput}
                  onChangeText={setTerminalInput}
                  onSubmitEditing={handleSubmitInput}
                  placeholder="Type terminal input"
                  placeholderTextColor="#7f8ea8"
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <View style={styles.sendRow}>
                  <Pressable
                    style={styles.buttonSecondary}
                    onPress={() => sendTerminalInput(false)}
                  >
                    <Text style={styles.buttonSecondaryText}>Send Raw</Text>
                  </Pressable>
                  <Pressable style={styles.buttonSecondary} onPress={() => sendTerminalInput(true)}>
                    <Text style={styles.buttonSecondaryText}>Send + Enter</Text>
                  </Pressable>
                </View>
              </View>
            </TouchableWithoutFeedback>
          </SafeAreaView>
        </Modal>
      </SafeAreaView>
    </TouchableWithoutFeedback>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#090b10",
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  panel: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#273043",
    backgroundColor: "#101723",
    padding: 16,
    gap: 14,
  },
  title: {
    color: "#e9eefc",
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  message: {
    color: "#d1ddfb",
    lineHeight: 20,
    textAlign: "center",
  },
  detailCard: {
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: "#131c29",
    borderWidth: 1,
    borderColor: "#243246",
    gap: 4,
  },
  detailText: {
    color: "#c6d4f5",
    textAlign: "center",
    fontSize: 12,
    lineHeight: 18,
  },
  section: {
    gap: 10,
  },
  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sectionTitle: {
    color: "#ecf2ff",
    fontWeight: "700",
    fontSize: 14,
  },
  inlineButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#2b3a50",
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: "#111b2b",
  },
  inlineButtonText: {
    color: "#9fbeff",
    fontSize: 12,
    fontWeight: "600",
  },
  emptyText: {
    color: "#a2b0ca",
    fontSize: 12,
  },
  optionGrid: {
    gap: 8,
  },
  optionCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a3648",
    backgroundColor: "#111a26",
    padding: 10,
    gap: 2,
  },
  optionCardSelected: {
    borderColor: "#66a0ff",
    backgroundColor: "#17253a",
  },
  optionTitle: {
    color: "#e7efff",
    fontSize: 13,
    fontWeight: "700",
  },
  optionMeta: {
    color: "#9fb0d0",
    fontSize: 12,
  },
  scopeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  scopeButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#2b3a50",
    backgroundColor: "#121d2e",
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  scopeButtonSelected: {
    borderColor: "#66a0ff",
    backgroundColor: "#1a2b45",
  },
  scopeButtonText: {
    color: "#d8e6ff",
    fontSize: 12,
    fontWeight: "700",
    textTransform: "capitalize",
  },
  promptInput: {
    minHeight: 64,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2f4059",
    backgroundColor: "#0d1521",
    color: "#dce8ff",
    padding: 10,
    textAlignVertical: "top",
    fontSize: 12,
  },
  sessionsCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#26344a",
    backgroundColor: "#0e1724",
    padding: 10,
    gap: 4,
  },
  sessionRowText: {
    color: "#b8c9e9",
    fontSize: 12,
    textTransform: "capitalize",
  },
  buttonPrimary: {
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    alignItems: "center",
    backgroundColor: "#39d98a",
  },
  buttonPrimaryText: {
    color: "#081017",
    fontWeight: "700",
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  metaLine: {
    color: "#9fb0d0",
    fontSize: 12,
  },
  debugCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2a3b52",
    backgroundColor: "#0c1420",
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 4,
  },
  debugTitle: {
    color: "#d8e7ff",
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.4,
  },
  debugLine: {
    color: "#9fb2d3",
    fontSize: 10,
    lineHeight: 13,
  },
  sheetOverlay: {
    flex: 1,
    justifyContent: "flex-end",
    backgroundColor: "rgba(3, 5, 9, 0.44)",
  },
  sheetBackdrop: {
    flex: 1,
  },
  sheetContainer: {
    maxHeight: "86%",
    minHeight: "58%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    borderColor: "#2b3a50",
    borderBottomWidth: 0,
    backgroundColor: "#0f1726",
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 8,
    gap: 10,
  },
  sheetHandle: {
    alignSelf: "center",
    width: 42,
    height: 5,
    borderRadius: 999,
    backgroundColor: "#3a4b67",
    marginBottom: 2,
  },
  sheetHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  sheetTitle: {
    color: "#ebf2ff",
    fontSize: 15,
    fontWeight: "700",
  },
  sheetSubtitle: {
    color: "#9fb0d0",
    fontSize: 11,
    marginTop: 2,
  },
  sheetCloseButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#364b6b",
    backgroundColor: "#122138",
    paddingVertical: 7,
    paddingHorizontal: 12,
  },
  sheetCloseButtonText: {
    color: "#d3e5ff",
    fontSize: 12,
    fontWeight: "700",
  },
  sheetTerminalArea: {
    position: "relative",
  },
  floatingActionRail: {
    position: "absolute",
    right: 8,
    top: 8,
    gap: 6,
    alignItems: "stretch",
  },
  floatingActionButton: {
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#35507b",
    backgroundColor: "rgba(17, 32, 53, 0.94)",
    paddingVertical: 6,
    paddingHorizontal: 8,
    minWidth: 62,
  },
  floatingActionText: {
    color: "#d4e6ff",
    fontSize: 10,
    fontWeight: "700",
    textAlign: "center",
  },
  terminalInput: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#2f4059",
    backgroundColor: "#0d1521",
    color: "#dce8ff",
    paddingHorizontal: 10,
    paddingVertical: 8,
    fontSize: 12,
  },
  sendRow: {
    flexDirection: "row",
    gap: 8,
  },
  buttonSecondary: {
    flex: 1,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334866",
    backgroundColor: "#132035",
    paddingVertical: 10,
    alignItems: "center",
  },
  buttonSecondaryText: {
    color: "#cde1ff",
    fontWeight: "700",
    fontSize: 12,
  },
  buttonSecondaryStandalone: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#334866",
    backgroundColor: "#132035",
    paddingVertical: 10,
    alignItems: "center",
    paddingHorizontal: 12,
  },
  linkText: {
    color: "#8ab4ff",
    textAlign: "center",
    textDecorationLine: "underline",
    fontSize: 12,
  },
});
