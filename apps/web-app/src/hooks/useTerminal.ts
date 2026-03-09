import { useCallback, useEffect, useRef, useState } from "react";

import { useServer, useServerUrlOptional } from "../contexts/ServerContext";
import { showPersistentErrorToast } from "../errorToasts";
import {
  createTerminalSession,
  destroyTerminalSession,
  fetchActiveTerminalSession,
  getTerminalWsUrl,
} from "./api";

type TerminalSessionScope = "terminal" | "claude" | "codex" | "gemini" | "opencode";
type TerminalConnectSource = "new" | "reused" | null;
type TerminalConnectReason = "visible-reconnect" | "explicit-launch" | "watchdog-retry";

interface UseTerminalOptions {
  worktreeId: string;
  sessionScope?: TerminalSessionScope;
  createSessionStartupCommand?: string | null;
  visible?: boolean;
  onData?: (data: string) => void;
  onRestore?: (payload: string) => void;
  onExit?: (exitCode: number) => void;
  getSize?: () => { cols: number; rows: number } | null;
}

interface TerminalConnectOptions {
  reason?: TerminalConnectReason;
  bypassClientCache?: boolean;
}

interface TerminalConnectResult {
  success: boolean;
  reason: TerminalConnectReason;
  source: TerminalConnectSource;
  sessionId: string | null;
  reusedScopedSession?: boolean;
  replacedScopedShellSession?: boolean;
  error?: string;
}

interface UseTerminalReturn {
  sessionId: string | null;
  isConnected: boolean;
  error: string | null;
  connectionSource: TerminalConnectSource;
  sendData: (data: string) => void;
  sendResize: (cols: number, rows: number) => void;
  connect: (options?: TerminalConnectOptions) => Promise<TerminalConnectResult>;
  disconnect: () => void;
  destroy: () => Promise<void>;
}

const terminalSessionCache = new Map<string, string>();
const WEBSOCKET_STABLE_OPEN_MS = 180;
const WEBSOCKET_OPEN_TIMEOUT_MS = 5_000;
const RAPID_CLOSE_WINDOW_MS = 1_500;
const RAPID_CLOSE_THRESHOLD = 2;
const VISIBLE_RECONNECT_STUCK_MS = 8_000;

function isAgentSessionScope(scope: TerminalSessionScope): boolean {
  return scope !== "terminal";
}

function formatTempLog(prefix: string, message: string, payload?: Record<string, unknown>): string {
  if (!payload) return `${prefix} ${message}`;
  try {
    return `${prefix} ${message} ${JSON.stringify(payload)}`;
  } catch {
    return `${prefix} ${message}`;
  }
}

function cacheKey(runtimeScopeKey: string, worktreeId: string, sessionScope: TerminalSessionScope) {
  return `${runtimeScopeKey}::${worktreeId}::${sessionScope}`;
}

function isPassiveAgentReconnect(
  sessionScope: TerminalSessionScope,
  reason: TerminalConnectReason,
): boolean {
  return isAgentSessionScope(sessionScope) && reason !== "explicit-launch";
}

export function clearTerminalSessionCacheForRuntimeWorktree(
  runtimeScopeKey: string,
  worktreeId: string,
): number {
  const prefix = `${runtimeScopeKey}::${worktreeId}::`;
  let removed = 0;
  const keysToRemove: string[] = [];
  for (const key of terminalSessionCache.keys()) {
    if (!key.startsWith(prefix)) continue;
    keysToRemove.push(key);
  }
  for (const key of keysToRemove) {
    if (!terminalSessionCache.delete(key)) continue;
    removed += 1;
  }
  return removed;
}

export function clearTerminalSessionCacheForWorktree(
  worktreeId: string,
  serverUrl: string | null,
): number {
  return clearTerminalSessionCacheForRuntimeWorktree(
    `server:${serverUrl ?? "__relative__"}`,
    worktreeId,
  );
}

export function useTerminal({
  worktreeId,
  sessionScope = "terminal",
  createSessionStartupCommand = null,
  visible = false,
  onData,
  onRestore,
  onExit,
  getSize,
}: UseTerminalOptions): UseTerminalReturn {
  const { activeProject, isElectron } = useServer();
  const serverUrl = useServerUrlOptional();
  const runtimeScopeKey = isElectron
    ? `project:${activeProject?.id ?? "__none__"}`
    : `server:${serverUrl ?? "__relative__"}`;
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectionSource, setConnectionSource] = useState<TerminalConnectSource>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastSizeRef = useRef<{ cols: number; rows: number } | null>(null);
  const connectGenRef = useRef(0);
  const isConnectingRef = useRef(false);
  const lastConnectFailureRef = useRef<string | null>(null);
  const rapidCloseCountRef = useRef(0);
  const forceFreshSessionRef = useRef(false);
  const visibleReconnectWatchdogTriggeredRef = useRef(false);
  const expectedSocketClosuresRef = useRef(new Set<WebSocket>());
  const passiveReconnectMissRef = useRef(false);
  const onDataRef = useRef(onData);
  const onRestoreRef = useRef(onRestore);
  const onExitRef = useRef(onExit);
  const getSizeRef = useRef(getSize);

  onDataRef.current = onData;
  onRestoreRef.current = onRestore;
  onExitRef.current = onExit;
  getSizeRef.current = getSize;

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      expectedSocketClosuresRef.current.add(wsRef.current);
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setConnectionSource(null);
  }, []);

  const openSessionWebSocket = useCallback(
    async (sid: string, gen: number): Promise<boolean> =>
      await new Promise<boolean>((resolve) => {
        let ws: WebSocket;
        try {
          ws = new WebSocket(getTerminalWsUrl(sid, serverUrl));
        } catch (openError) {
          const message =
            openError instanceof Error
              ? openError.message
              : "invalid websocket URL or constructor error";
          lastConnectFailureRef.current = `websocket constructor failed (${message})`;
          forceFreshSessionRef.current = true;
          resolve(false);
          return;
        }
        wsRef.current = ws;
        let opened = false;
        let openedAt = 0;
        let stableOpen = false;
        let settled = false;
        let stableTimer: number | null = null;
        let openTimeoutTimer: number | null = null;

        const settle = (ok: boolean) => {
          if (settled) return;
          settled = true;
          if (stableTimer !== null) {
            window.clearTimeout(stableTimer);
            stableTimer = null;
          }
          if (openTimeoutTimer !== null) {
            window.clearTimeout(openTimeoutTimer);
            openTimeoutTimer = null;
          }
          resolve(ok);
        };

        openTimeoutTimer = window.setTimeout(() => {
          if (settled || stableOpen) return;
          lastConnectFailureRef.current = "websocket open timeout";
          forceFreshSessionRef.current = true;
          try {
            ws.close();
          } catch {
            // Ignore close errors from half-open sockets.
          }
          settle(false);
        }, WEBSOCKET_OPEN_TIMEOUT_MS);

        ws.onopen = () => {
          if (gen !== connectGenRef.current) {
            expectedSocketClosuresRef.current.add(ws);
            ws.close();
            settle(false);
            return;
          }
          opened = true;
          openedAt = Date.now();
          passiveReconnectMissRef.current = false;
          setIsConnected(true);
          setError(null);
          console.info(
            formatTempLog("[terminal][TEMP]", "websocket opened", {
              worktreeId,
              sessionScope,
              sessionId: sid,
              generation: gen,
            }),
          );
          stableTimer = window.setTimeout(() => {
            stableOpen = true;
            settle(true);
          }, WEBSOCKET_STABLE_OPEN_MS);
        };

        ws.onmessage = (event) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.type === "exit") {
              const key = cacheKey(runtimeScopeKey, worktreeId, sessionScope);
              terminalSessionCache.delete(key);
              sessionIdRef.current = null;
              setSessionId(null);
              rapidCloseCountRef.current = 0;
              forceFreshSessionRef.current = false;
              onExitRef.current?.(msg.exitCode);
              setIsConnected(false);
              return;
            }
            if (msg.type === "restore" && typeof msg.payload === "string") {
              onRestoreRef.current?.(msg.payload);
              return;
            }
          } catch {
            // Not a control message.
          }
          onDataRef.current?.(event.data);
        };

        ws.onclose = (event) => {
          const key = cacheKey(runtimeScopeKey, worktreeId, sessionScope);
          const expectedClose = expectedSocketClosuresRef.current.delete(ws);
          if (wsRef.current === ws) {
            wsRef.current = null;
          }
          setIsConnected(false);
          if (!stableOpen) settle(false);
          console.info(
            formatTempLog("[terminal][TEMP]", "websocket closed", {
              worktreeId,
              sessionScope,
              sessionId: sid,
              generation: gen,
              code: event.code,
              reason: event.reason,
              opened,
              stableOpen,
              expectedClose,
            }),
          );
          if (expectedClose) {
            return;
          }
          if (!stableOpen) {
            lastConnectFailureRef.current =
              event.reason?.trim().length > 0
                ? `websocket closed early (${event.code}: ${event.reason})`
                : `websocket closed early (${event.code})`;
          }

          if (opened && openedAt > 0) {
            const elapsedMs = Date.now() - openedAt;
            if (elapsedMs <= RAPID_CLOSE_WINDOW_MS) {
              rapidCloseCountRef.current += 1;
            } else {
              rapidCloseCountRef.current = 0;
            }
            if (rapidCloseCountRef.current >= RAPID_CLOSE_THRESHOLD) {
              forceFreshSessionRef.current = true;
              terminalSessionCache.delete(key);
              sessionIdRef.current = null;
              setSessionId(null);
              console.info(
                formatTempLog("[terminal][TEMP]", "rapid close detected; forcing fresh session", {
                  worktreeId,
                  sessionScope,
                  sessionId: sid,
                  generation: gen,
                  rapidCloseCount: rapidCloseCountRef.current,
                  elapsedMs,
                }),
              );
            }
          }
        };

        ws.onerror = () => {
          if (expectedSocketClosuresRef.current.has(ws)) {
            return;
          }
          setIsConnected(false);
          if (!stableOpen) {
            if (!lastConnectFailureRef.current) {
              lastConnectFailureRef.current = "websocket error before stable connection";
            }
            settle(false);
            return;
          }
          console.info(
            formatTempLog("[terminal][TEMP]", "websocket error", {
              worktreeId,
              sessionScope,
              sessionId: sid,
              generation: gen,
              opened,
              stableOpen,
            }),
          );
          setError("WebSocket connection failed");
        };
      }),
    [runtimeScopeKey, serverUrl, sessionScope, worktreeId],
  );

  const destroyScopedSessionIfPresent = useCallback(
    async (candidateSessionId: string | null) => {
      const destroyedIds = new Set<string>();
      const destroyIfPresent = async (sid: string | null) => {
        if (!sid || destroyedIds.has(sid)) return;
        destroyedIds.add(sid);
        const destroyResult = await destroyTerminalSession(sid, serverUrl);
        if (!destroyResult.success) {
          const missingSession = destroyResult.error?.toLowerCase().includes("session not found");
          if (missingSession) {
            console.info(
              formatTempLog("[terminal][TEMP]", "destroy skipped for stale session", {
                worktreeId,
                sessionScope,
                sessionId: sid,
              }),
            );
            return;
          }
          console.info(
            formatTempLog("[terminal][TEMP]", "destroy failed during scoped cleanup", {
              worktreeId,
              sessionScope,
              sessionId: sid,
              error: destroyResult.error ?? "unknown",
            }),
          );
        }
      };

      await destroyIfPresent(candidateSessionId);
      const active = await fetchActiveTerminalSession(worktreeId, sessionScope, serverUrl);
      if (active.success && active.sessionId) {
        await destroyIfPresent(active.sessionId);
      }
    },
    [serverUrl, sessionScope, worktreeId],
  );

  const connect = useCallback(
    async (options?: TerminalConnectOptions): Promise<TerminalConnectResult> => {
      const reason = options?.reason ?? "visible-reconnect";
      const bypassClientCache = options?.bypassClientCache ?? false;
      if (isConnectingRef.current) {
        console.info(
          formatTempLog("[terminal][TEMP]", "connect skipped: already in progress", {
            worktreeId,
            sessionScope,
            reason,
            bypassClientCache,
            sessionId: sessionIdRef.current,
          }),
        );
        return {
          success: false,
          reason,
          source: null,
          sessionId: sessionIdRef.current,
          error: "connect already in progress",
        };
      }

      if (serverUrl === null) {
        setError(null);
        return {
          success: false,
          reason,
          source: null,
          sessionId: null,
          error: "no active server",
        };
      }

      isConnectingRef.current = true;

      connectGenRef.current += 1;
      const gen = connectGenRef.current;

      try {
        disconnect();
        setError(null);
        setConnectionSource(null);
        lastConnectFailureRef.current = null;

        const size = getSizeRef.current?.();
        lastSizeRef.current = size ?? null;

        const key = cacheKey(runtimeScopeKey, worktreeId, sessionScope);
        const explicitLaunch = reason === "explicit-launch";
        const passiveAgentReconnect = isPassiveAgentReconnect(sessionScope, reason);
        if (explicitLaunch) {
          passiveReconnectMissRef.current = false;
        }
        const forceFreshSession = forceFreshSessionRef.current;
        if (forceFreshSession) {
          forceFreshSessionRef.current = false;
        }
        const shouldBypassClientCache =
          explicitLaunch || bypassClientCache || (forceFreshSession && !passiveAgentReconnect);
        const launchReason = createSessionStartupCommand ? "explicit_launch" : "passive_reconnect";

        console.info(
          formatTempLog("[terminal][TEMP]", "connect attempt", {
            worktreeId,
            sessionScope,
            key,
            generation: gen,
            reason,
            bypassClientCache,
            hasStartupCommand: Boolean(createSessionStartupCommand),
            launchReason,
            forceFreshSession,
            shouldBypassClientCache,
            passiveAgentReconnect,
          }),
        );

        if (forceFreshSession) {
          const staleCandidateSessionId =
            sessionIdRef.current ?? terminalSessionCache.get(key) ?? null;
          terminalSessionCache.delete(key);
          sessionIdRef.current = null;
          setSessionId(null);
          if (!explicitLaunch && !passiveAgentReconnect) {
            await destroyScopedSessionIfPresent(staleCandidateSessionId);
          }
          console.info(
            formatTempLog("[terminal][TEMP]", "skipping cache; fresh session required", {
              worktreeId,
              sessionScope,
              key,
              generation: gen,
              reason,
              path: explicitLaunch
                ? "explicit-launch"
                : passiveAgentReconnect
                  ? "passive-reconnect"
                  : "forced-fresh",
              hasStartupCommand: Boolean(createSessionStartupCommand),
              launchReason,
              rapidCloseCount: rapidCloseCountRef.current,
            }),
          );
        }

        const cachedSessionId = shouldBypassClientCache
          ? null
          : (sessionIdRef.current ?? terminalSessionCache.get(key) ?? null);

        if (passiveAgentReconnect) {
          const activeResult = await fetchActiveTerminalSession(
            worktreeId,
            sessionScope,
            serverUrl,
          );
          const activeSessionId = activeResult.success ? activeResult.sessionId : null;
          console.info(
            formatTempLog("[terminal][TEMP]", "passive reconnect session resolution", {
              worktreeId,
              sessionScope,
              key,
              generation: gen,
              reason,
              serverActiveSessionId: activeSessionId,
              cachedSessionId,
              lookupSucceeded: activeResult.success,
              lookupError: activeResult.success ? null : (activeResult.error ?? "unknown"),
            }),
          );

          const tryAttach = async (
            candidateSessionId: string,
            path: "server-active" | "client-cache",
          ): Promise<TerminalConnectResult | null> => {
            sessionIdRef.current = candidateSessionId;
            setSessionId(candidateSessionId);
            terminalSessionCache.set(key, candidateSessionId);
            console.info(
              formatTempLog("[terminal][TEMP]", "attempting passive reconnect session", {
                worktreeId,
                sessionScope,
                sessionId: candidateSessionId,
                generation: gen,
                reason,
                path,
                launchReason,
              }),
            );
            const reused = await openSessionWebSocket(candidateSessionId, gen);
            if (reused) {
              rapidCloseCountRef.current = 0;
              passiveReconnectMissRef.current = false;
              setConnectionSource("reused");
              console.info(
                formatTempLog("[terminal][TEMP]", "passive reconnect attached existing session", {
                  worktreeId,
                  sessionScope,
                  sessionId: candidateSessionId,
                  generation: gen,
                  reason,
                  path,
                }),
              );
              return {
                success: true,
                reason,
                source: "reused",
                sessionId: candidateSessionId,
              };
            }
            if (gen !== connectGenRef.current) {
              return {
                success: false,
                reason,
                source: null,
                sessionId: null,
                error: "connect generation changed",
              };
            }
            if (path === "client-cache") {
              terminalSessionCache.delete(key);
              sessionIdRef.current = null;
              setSessionId(null);
            }
            console.info(
              formatTempLog("[terminal][TEMP]", "passive reconnect attach failed", {
                worktreeId,
                sessionScope,
                sessionId: candidateSessionId,
                generation: gen,
                reason,
                path,
                lastConnectFailure: lastConnectFailureRef.current,
              }),
            );
            return null;
          };

          if (activeSessionId) {
            if (cachedSessionId && cachedSessionId !== activeSessionId) {
              console.info(
                formatTempLog("[terminal][TEMP]", "passive reconnect cache mismatch", {
                  worktreeId,
                  sessionScope,
                  generation: gen,
                  reason,
                  cachedSessionId,
                  serverActiveSessionId: activeSessionId,
                }),
              );
            }
            const result = await tryAttach(activeSessionId, "server-active");
            if (result) return result;
            if (gen !== connectGenRef.current) {
              return {
                success: false,
                reason,
                source: null,
                sessionId: null,
                error: "connect generation changed",
              };
            }
            return {
              success: false,
              reason,
              source: null,
              sessionId: activeSessionId,
              error:
                lastConnectFailureRef.current ??
                "failed to attach server active scoped session during passive reconnect",
            };
          }

          if (cachedSessionId) {
            const result = await tryAttach(cachedSessionId, "client-cache");
            if (result) return result;
            if (gen !== connectGenRef.current) {
              return {
                success: false,
                reason,
                source: null,
                sessionId: null,
                error: "connect generation changed",
              };
            }
          }

          passiveReconnectMissRef.current = true;
          console.info(
            formatTempLog("[terminal][TEMP]", "passive reconnect miss", {
              worktreeId,
              sessionScope,
              key,
              generation: gen,
              reason,
              path: "passive-no-session",
              cachedSessionId,
              serverActiveSessionId: activeSessionId,
            }),
          );
          return {
            success: false,
            reason,
            source: null,
            sessionId: null,
            error: "passive reconnect miss",
          };
        }

        if (!shouldBypassClientCache) {
          if (cachedSessionId) {
            console.info(
              formatTempLog("[terminal][TEMP]", "attempting cached session", {
                worktreeId,
                sessionScope,
                sessionId: cachedSessionId,
                generation: gen,
                reason,
                path: "cached",
                hasStartupCommand: Boolean(createSessionStartupCommand),
                launchReason,
              }),
            );
            sessionIdRef.current = cachedSessionId;
            setSessionId(cachedSessionId);
            const reused = await openSessionWebSocket(cachedSessionId, gen);
            if (reused) {
              rapidCloseCountRef.current = 0;
              setConnectionSource("reused");
              console.info(
                formatTempLog("[terminal][TEMP]", "reused cached session", {
                  worktreeId,
                  sessionScope,
                  sessionId: cachedSessionId,
                  generation: gen,
                  reason,
                  path: "cached",
                  hasStartupCommand: Boolean(createSessionStartupCommand),
                  launchReason,
                }),
              );
              return {
                success: true,
                reason,
                source: "reused",
                sessionId: cachedSessionId,
              };
            }
            if (gen !== connectGenRef.current) {
              return {
                success: false,
                reason,
                source: null,
                sessionId: null,
                error: "connect generation changed",
              };
            }

            terminalSessionCache.delete(key);
            sessionIdRef.current = null;
            setSessionId(null);
            await destroyScopedSessionIfPresent(cachedSessionId);
            console.info(
              formatTempLog("[terminal][TEMP]", "cached session unusable; creating new session", {
                worktreeId,
                sessionScope,
                sessionId: cachedSessionId,
                generation: gen,
                reason,
                path: "fresh",
                hasStartupCommand: Boolean(createSessionStartupCommand),
                launchReason,
              }),
            );
          }
        } else {
          terminalSessionCache.delete(key);
          sessionIdRef.current = null;
          setSessionId(null);
        }

        const createResult = await createTerminalSession(
          worktreeId,
          size?.cols,
          size?.rows,
          createSessionStartupCommand ?? undefined,
          sessionScope,
          serverUrl,
        );

        if (gen !== connectGenRef.current) {
          if (createResult.success && createResult.sessionId) {
            void destroyTerminalSession(createResult.sessionId, serverUrl);
          }
          return {
            success: false,
            reason,
            source: null,
            sessionId: null,
            error: "connect generation changed",
          };
        }

        if (!createResult.success || !createResult.sessionId) {
          const createError = createResult.error || "Failed to create terminal session";
          setError(createError);
          return {
            success: false,
            reason,
            source: null,
            sessionId: null,
            error: createError,
          };
        }

        const sid = createResult.sessionId;
        sessionIdRef.current = sid;
        setSessionId(sid);
        terminalSessionCache.set(key, sid);
        console.info(
          formatTempLog("[terminal][TEMP]", "created terminal session", {
            worktreeId,
            sessionScope,
            sessionId: sid,
            generation: gen,
            reason,
            path: createResult.reusedScopedSession ? "reused-scoped" : "fresh",
            hasStartupCommand: Boolean(createSessionStartupCommand),
            launchReason,
            reusedScopedSession: createResult.reusedScopedSession ?? false,
            replacedScopedShellSession: createResult.replacedScopedShellSession ?? false,
          }),
        );

        const opened = await openSessionWebSocket(sid, gen);
        if (!opened && gen === connectGenRef.current) {
          await destroyScopedSessionIfPresent(sid);
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
            return {
              success: false,
              reason,
              source: null,
              sessionId: null,
              error: "connect generation changed",
            };
          }
          if (!retryResult.success || !retryResult.sessionId) {
            const retryError = retryResult.error || "Failed to create terminal session";
            const failureSuffix = lastConnectFailureRef.current
              ? ` (${lastConnectFailureRef.current})`
              : "";
            const message = `${retryError}${failureSuffix}`;
            setError(message);
            setConnectionSource(null);
            return {
              success: false,
              reason,
              source: null,
              sessionId: null,
              error: message,
            };
          }

          const retrySid = retryResult.sessionId;
          sessionIdRef.current = retrySid;
          setSessionId(retrySid);
          terminalSessionCache.set(key, retrySid);
          console.info(
            formatTempLog("[terminal][TEMP]", "retrying with fresh terminal session", {
              worktreeId,
              sessionScope,
              sessionId: retrySid,
              generation: gen,
              reason,
              path: "forced-fresh",
              hasStartupCommand: Boolean(createSessionStartupCommand),
              launchReason,
              reusedScopedSession: retryResult.reusedScopedSession ?? false,
              replacedScopedShellSession: retryResult.replacedScopedShellSession ?? false,
            }),
          );

          const retryOpened = await openSessionWebSocket(retrySid, gen);
          if (!retryOpened && gen === connectGenRef.current) {
            const failureSuffix = lastConnectFailureRef.current
              ? ` (${lastConnectFailureRef.current})`
              : "";
            const message = `Failed to reconnect to a fresh terminal session${failureSuffix}`;
            setError(message);
            setConnectionSource(null);
            return {
              success: false,
              reason,
              source: null,
              sessionId: null,
              error: message,
            };
          }
          if (gen === connectGenRef.current) {
            rapidCloseCountRef.current = 0;
            const source: TerminalConnectSource = retryResult.reusedScopedSession
              ? "reused"
              : "new";
            setConnectionSource(source);
            return {
              success: true,
              reason,
              source,
              sessionId: retrySid,
              reusedScopedSession: retryResult.reusedScopedSession,
              replacedScopedShellSession: retryResult.replacedScopedShellSession,
            };
          }
          return {
            success: false,
            reason,
            source: null,
            sessionId: null,
            error: "connect generation changed",
          };
        }

        if (gen === connectGenRef.current) {
          rapidCloseCountRef.current = 0;
          const source: TerminalConnectSource = createResult.reusedScopedSession ? "reused" : "new";
          setConnectionSource(source);
          return {
            success: true,
            reason,
            source,
            sessionId: sid,
            reusedScopedSession: createResult.reusedScopedSession,
            replacedScopedShellSession: createResult.replacedScopedShellSession,
          };
        }
        return {
          success: false,
          reason,
          source: null,
          sessionId: null,
          error: "connect generation changed",
        };
      } finally {
        isConnectingRef.current = false;
      }
    },
    [
      worktreeId,
      sessionScope,
      createSessionStartupCommand,
      disconnect,
      destroyScopedSessionIfPresent,
      runtimeScopeKey,
      serverUrl,
      openSessionWebSocket,
    ],
  );

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
    connectGenRef.current += 1;

    const key = cacheKey(runtimeScopeKey, worktreeId, sessionScope);
    const sid = sessionIdRef.current ?? terminalSessionCache.get(key) ?? null;

    disconnect();
    terminalSessionCache.delete(key);
    sessionIdRef.current = null;
    setSessionId(null);

    if (!sid) return;
    await destroyTerminalSession(sid, serverUrl);
  }, [disconnect, runtimeScopeKey, serverUrl, sessionScope, worktreeId]);

  useEffect(() => {
    return () => {
      connectGenRef.current += 1;
      if (wsRef.current) {
        expectedSocketClosuresRef.current.add(wsRef.current);
        wsRef.current.close();
        wsRef.current = null;
      }
      passiveReconnectMissRef.current = false;
      sessionIdRef.current = null;
      setSessionId(null);
      setIsConnected(false);
      setConnectionSource(null);
    };
  }, [runtimeScopeKey, serverUrl, sessionScope]);

  useEffect(() => {
    if (!visible || serverUrl === null) {
      visibleReconnectWatchdogTriggeredRef.current = false;
      passiveReconnectMissRef.current = false;
      return;
    }
    if (isConnected) {
      visibleReconnectWatchdogTriggeredRef.current = false;
      passiveReconnectMissRef.current = false;
      return;
    }
    if (passiveReconnectMissRef.current) {
      visibleReconnectWatchdogTriggeredRef.current = false;
      return;
    }

    const key = cacheKey(runtimeScopeKey, worktreeId, sessionScope);
    const timeoutId = window.setTimeout(() => {
      if (visibleReconnectWatchdogTriggeredRef.current) return;
      visibleReconnectWatchdogTriggeredRef.current = true;
      if (!isAgentSessionScope(sessionScope)) {
        forceFreshSessionRef.current = true;
      }
      lastConnectFailureRef.current = "visible reconnect watchdog timeout";
      console.info(
        formatTempLog("[terminal][TEMP]", "visible reconnect watchdog forcing refresh", {
          worktreeId,
          sessionScope,
          key,
        }),
      );
      void connect({ reason: "watchdog-retry" });
    }, VISIBLE_RECONNECT_STUCK_MS);

    return () => window.clearTimeout(timeoutId);
  }, [connect, isConnected, runtimeScopeKey, serverUrl, sessionScope, visible, worktreeId]);

  useEffect(() => {
    if (!error) return;
    showPersistentErrorToast(error, {
      scope: `terminal:${sessionScope}:${worktreeId}`,
      dedupeWindowMs: 250,
    });
  }, [error, sessionScope, worktreeId]);

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
