import { useCallback, useEffect, useRef, useState } from "react";

import { createTerminalSession, destroyTerminalSession, getTerminalWsUrl } from "./api";
import { useServerUrlOptional } from "../contexts/ServerContext";

interface UseTerminalOptions {
  worktreeId: string;
  sessionScope?: "terminal" | "claude";
  createSessionStartupCommand?: string | null;
  onData?: (data: string) => void;
  onExit?: (exitCode: number) => void;
  getSize?: () => { cols: number; rows: number } | null;
}

interface UseTerminalReturn {
  sessionId: string | null;
  isConnected: boolean;
  error: string | null;
  connectionSource: "new" | "reused" | null;
  sendData: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  connect: () => Promise<void>;
  disconnect: () => void;
  destroy: () => Promise<void>;
}

const terminalSessionCache = new Map<string, string>();
const WEBSOCKET_STABLE_OPEN_MS = 180;

function cacheKey(
  worktreeId: string,
  serverUrl: string | null,
  sessionScope: "terminal" | "claude",
): string {
  return `${serverUrl ?? "__relative__"}::${worktreeId}::${sessionScope}`;
}

export function useTerminal({
  worktreeId,
  sessionScope = "terminal",
  createSessionStartupCommand = null,
  onData,
  onExit,
  getSize,
}: UseTerminalOptions): UseTerminalReturn {
  const serverUrl = useServerUrlOptional();
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionSource, setConnectionSource] = useState<"new" | "reused" | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const connectGenRef = useRef(0);
  const lastConnectFailureRef = useRef<string | null>(null);
  const onDataRef = useRef(onData);
  const onExitRef = useRef(onExit);
  const getSizeRef = useRef(getSize);

  onDataRef.current = onData;
  onExitRef.current = onExit;
  getSizeRef.current = getSize;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionSource(null);
  }, []);

  const openSessionWebSocket = useCallback(
    async (sid: string, gen: number): Promise<boolean> =>
      await new Promise<boolean>((resolve) => {
        const ws = new WebSocket(getTerminalWsUrl(sid, serverUrl));
        wsRef.current = ws;
        let opened = false;
        let stableOpen = false;
        let settled = false;
        let stableTimer: number | null = null;

        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (stableTimer !== null) {
            window.clearTimeout(stableTimer);
            stableTimer = null;
          }
          resolve(ok);
        };

        ws.onopen = () => {
          if (gen !== connectGenRef.current) {
            lastConnectFailureRef.current = "connect generation changed before websocket opened";
            ws.close();
            settle(false);
            return;
          }
          opened = true;
          setIsConnected(true);
          setError(null);
          console.info("[terminal][TEMP] websocket opened", {
            worktreeId,
            sessionScope,
            sessionId: sid,
            generation: gen,
          });
          stableTimer = window.setTimeout(() => {
            stableOpen = true;
            settle(true);
          }, WEBSOCKET_STABLE_OPEN_MS);
        };

        ws.onmessage = (event) => {
          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);
              if (msg.type === "exit") {
                const key = cacheKey(worktreeId, serverUrl, sessionScope);
                terminalSessionCache.delete(key);
                sessionIdRef.current = null;
                setSessionId(null);
                onExitRef.current?.(msg.exitCode);
                setIsConnected(false);
                return;
              }
            } catch {
              // Not a control message.
            }
            onDataRef.current?.(event.data);
          }
        };

        ws.onclose = (event) => {
          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          setIsConnected(false);
          if (!stableOpen) settle(false);
          if (!stableOpen) {
            lastConnectFailureRef.current =
              event.reason?.trim().length > 0
                ? `websocket closed early (${event.code}: ${event.reason})`
                : `websocket closed early (${event.code})`;
          }
          console.info("[terminal][TEMP] websocket closed", {
            worktreeId,
            sessionScope,
            sessionId: sid,
            generation: gen,
            code: event.code,
            reason: event.reason,
            opened,
            stableOpen,
          });
        };

        ws.onerror = () => {
          setIsConnected(false);
          if (!stableOpen) {
            if (!lastConnectFailureRef.current) {
              lastConnectFailureRef.current = "websocket error before stable connection";
            }
            settle(false);
            return;
          }
          console.info("[terminal][TEMP] websocket error", {
            worktreeId,
            sessionScope,
            sessionId: sid,
            generation: gen,
            opened,
            stableOpen,
          });
          setError("WebSocket connection failed");
        };
      }),
    [serverUrl, sessionScope, worktreeId],
  );

  const connect = useCallback(async () => {
    if (serverUrl === null) {
      setError("No active project");
      return;
    }

    // Invalidate any in-flight connect() that hasn't resolved yet
    connectGenRef.current++;
    const gen = connectGenRef.current;

    disconnect();
    setError(null);
    setConnectionSource(null);
    lastConnectFailureRef.current = null;

    const size = getSizeRef.current?.();
    lastSizeRef.current = size ?? null;

    const key = cacheKey(worktreeId, serverUrl, sessionScope);
    const cachedSessionId = sessionIdRef.current ?? terminalSessionCache.get(key) ?? null;
    if (cachedSessionId) {
      console.info("[terminal][TEMP] attempting cached session", {
        worktreeId,
        sessionScope,
        sessionId: cachedSessionId,
        generation: gen,
      });
      sessionIdRef.current = cachedSessionId;
      setSessionId(cachedSessionId);
      const reused = await openSessionWebSocket(cachedSessionId, gen);
      if (reused) {
        console.info("[terminal][TEMP] reused cached session", {
          worktreeId,
          sessionScope,
          sessionId: cachedSessionId,
          generation: gen,
        });
        setConnectionSource("reused");
        return;
      }
      if (gen !== connectGenRef.current) return;

      terminalSessionCache.delete(key);
      sessionIdRef.current = null;
      setSessionId(null);
      await destroyTerminalSession(cachedSessionId, serverUrl);
      console.info("[terminal][TEMP] cached session unusable; creating new session", {
        worktreeId,
        sessionScope,
        sessionId: cachedSessionId,
        generation: gen,
      });
    }

    const result = await createTerminalSession(
      worktreeId,
      size?.cols,
      size?.rows,
      createSessionStartupCommand ?? undefined,
      sessionScope,
      serverUrl,
    );

    // Another connect() or disconnect() was called while we were awaiting — abandon
    if (gen !== connectGenRef.current) {
      if (result.success && result.sessionId) {
        void destroyTerminalSession(result.sessionId, serverUrl);
      }
      return;
    }

    if (!result.success || !result.sessionId) {
      setError(result.error || "Failed to create terminal session");
      return;
    }

    const sid = result.sessionId;
    sessionIdRef.current = sid;
    setSessionId(sid);
    terminalSessionCache.set(key, sid);
    console.info("[terminal][TEMP] created terminal session", {
      worktreeId,
      sessionScope,
      sessionId: sid,
      generation: gen,
    });

    const opened = await openSessionWebSocket(sid, gen);
    if (!opened && gen === connectGenRef.current) {
      await destroyTerminalSession(sid, serverUrl);
      terminalSessionCache.delete(key);
      sessionIdRef.current = null;
      setSessionId(null);

      const retryResult = await createTerminalSession(
        worktreeId,
        size?.cols,
        size?.rows,
        createSessionStartupCommand ?? undefined,
        sessionScope,
        serverUrl,
      );
      if (gen !== connectGenRef.current) {
        if (retryResult.success && retryResult.sessionId) {
          void destroyTerminalSession(retryResult.sessionId, serverUrl);
        }
        return;
      }
      if (!retryResult.success || !retryResult.sessionId) {
        const retryError = retryResult.error || "Failed to create terminal session";
        const failureSuffix = lastConnectFailureRef.current
          ? ` (${lastConnectFailureRef.current})`
          : "";
        setError(`${retryError}${failureSuffix}`);
        setConnectionSource(null);
        return;
      }

      const retrySid = retryResult.sessionId;
      sessionIdRef.current = retrySid;
      setSessionId(retrySid);
      terminalSessionCache.set(key, retrySid);
      console.info("[terminal][TEMP] retrying with fresh terminal session", {
        worktreeId,
        sessionScope,
        sessionId: retrySid,
        generation: gen,
      });

      const retryOpened = await openSessionWebSocket(retrySid, gen);
      if (!retryOpened && gen === connectGenRef.current) {
        const failureSuffix = lastConnectFailureRef.current
          ? ` (${lastConnectFailureRef.current})`
          : "";
        setError(`Failed to connect to terminal session${failureSuffix}`);
        setConnectionSource(null);
        return;
      }
      if (gen === connectGenRef.current) {
        setConnectionSource("new");
      }
      return;
    }
    if (gen === connectGenRef.current) {
      setConnectionSource("new");
    }
  }, [
    worktreeId,
    sessionScope,
    createSessionStartupCommand,
    disconnect,
    serverUrl,
    openSessionWebSocket,
  ]);

  const sendData = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(data);
    }
  }, []);

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      const last = lastSizeRef.current;
      if (last && last.cols === cols && last.rows === rows) return;
      lastSizeRef.current = { cols, rows };
      wsRef.current.send(JSON.stringify({ type: "resize", cols, rows }));
    }
  }, []);

  const destroy = useCallback(async () => {
    connectGenRef.current++;

    const key = cacheKey(worktreeId, serverUrl, sessionScope);
    const sid = sessionIdRef.current ?? terminalSessionCache.get(key) ?? null;

    disconnect();
    terminalSessionCache.delete(key);
    sessionIdRef.current = null;
    setSessionId(null);

    if (!sid) return;
    await destroyTerminalSession(sid, serverUrl);
  }, [disconnect, serverUrl, sessionScope, worktreeId]);

  useEffect(() => {
    return () => {
      connectGenRef.current++;
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
      sessionIdRef.current = null;
      setSessionId(null);
      setIsConnected(false);
      setConnectionSource(null);
    };
  }, [serverUrl, sessionScope]);

  return {
    sessionId,
    isConnected,
    error,
    connectionSource,
    sendData,
    sendResize,
    connect,
    disconnect,
    destroy,
  };
}
