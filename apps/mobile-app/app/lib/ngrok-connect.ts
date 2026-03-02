const REQUEST_TIMEOUT_MS = 10_000;
const SESSION_REFRESH_WINDOW_MS = 60 * 1000;
const AGENT_SCOPES = ["claude", "codex", "gemini", "opencode"] as const;

export type MobileAgentScope = (typeof AGENT_SCOPES)[number];

export interface PairingUrlPayload {
  origin: string;
  token: string;
}

interface PairingExchangeResponse {
  success?: boolean;
  sessionJwt?: string;
  expiresIn?: number;
  expiresAt?: string;
  replayed?: boolean;
  project?: {
    id: string;
    name: string;
  };
  error?: {
    message?: string;
  };
}

interface GatewayHealthResponse {
  ok?: boolean;
  service?: string;
}

interface RefreshSessionResponse {
  success?: boolean;
  sessionJwt?: string;
  expiresIn?: number;
  expiresAt?: string;
  error?: {
    message?: string;
  };
}

interface MobileContextResponse {
  success?: boolean;
  project?: {
    id: string;
    name: string;
  };
  scopes?: string[];
}

interface MobileWorktreesResponse {
  success?: boolean;
  worktrees?: MobileWorktreeSummary[];
}

interface MobileAgentSessionsResponse {
  success?: boolean;
  sessions?: MobileAgentSessionSummary[];
  worktree?: {
    id: string;
    branch: string;
  };
}

interface ConnectAgentSessionResponse {
  success?: boolean;
  sessionId?: string;
  created?: boolean;
}

export interface GatewayConnection {
  sessionJwt: string;
  sessionExpiresAtMs: number;
  gatewayOrigin: string;
  gatewayApiBase: string;
  projectId: string;
  projectName: string | null;
  service: string | null;
}

export interface MobileGatewayContext {
  projectId: string;
  projectName: string;
  scopes: MobileAgentScope[];
}

export interface MobileWorktreeSummary {
  id: string;
  branch: string;
  status: "running" | "stopped" | "starting" | "creating";
  jiraStatus: string | null;
  linearStatus: string | null;
  localIssueStatus: string | null;
  hasActivePorts: boolean;
}

export interface MobileAgentSessionSummary {
  scope: MobileAgentScope;
  sessionId: string | null;
  active: boolean;
}

export interface MobileConnectSessionRequest {
  worktreeId: string;
  scope: MobileAgentScope;
  startIfMissing: boolean;
  prompt?: string;
  skipPermissions?: boolean;
  cols?: number;
  rows?: number;
}

export interface MobileConnectSessionResult {
  sessionId: string;
  created: boolean;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Failed to connect to the scanned gateway URL.";
}

export function getStringParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0]?.trim() || null;
  if (typeof value === "string") return value.trim() || null;
  return null;
}

export function parsePairingUrl(value: string): PairingUrlPayload {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Scanned code is not a valid URL.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Pairing URL must use HTTPS.");
  }

  if (parsed.pathname !== "/_ok/pair") {
    throw new Error("QR code is not an OpenKit ngrok pairing URL.");
  }

  const token = parsed.searchParams.get("token")?.trim();
  if (!token) {
    throw new Error("Pairing URL is missing the token parameter.");
  }

  return { origin: parsed.origin, token };
}

function parseMobileConnectDeepLink(parsed: URL): PairingUrlPayload | null {
  const routeTarget = parsed.hostname || parsed.pathname.replace(/^\/+/, "");
  if (routeTarget !== "connect") return null;

  const origin = parsed.searchParams.get("origin")?.trim();
  const token = parsed.searchParams.get("token")?.trim();
  if (!origin || !token) return null;

  return { origin, token };
}

function parseMobileConnectHttpsUrl(parsed: URL): PairingUrlPayload | null {
  if (parsed.protocol !== "https:") return null;
  if (parsed.pathname !== "/_ok/mobile/connect") return null;

  const token = parsed.searchParams.get("token")?.trim();
  if (!token) return null;
  return { origin: parsed.origin, token };
}

function normalizeOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Deep link origin is invalid.");
  }

  if (parsed.protocol !== "https:") {
    throw new Error("Deep link origin must use HTTPS.");
  }

  parsed.pathname = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

async function fetchJsonWithTimeout<T>(url: string, init?: RequestInit): Promise<T> {
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, { ...init, signal: abortController.signal });
    const payload = (await response
      .json()
      .catch(() => ({}) as T & { error?: { message?: string }; retryAfterSec?: number })) as T & {
      error?: { message?: string };
      retryAfterSec?: number;
    };

    if (!response.ok) {
      const retryAfterSec =
        typeof payload.retryAfterSec === "number" && Number.isFinite(payload.retryAfterSec)
          ? Math.max(1, Math.floor(payload.retryAfterSec))
          : null;
      const baseMessage =
        payload.error?.message ?? `Request failed with status ${response.status}.`;
      if (retryAfterSec !== null) {
        throw new Error(`${baseMessage} Retry in ${retryAfterSec}s.`);
      }
      throw new Error(baseMessage);
    }

    return payload;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error("Timed out while contacting the gateway.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function assertAgentScope(value: unknown): asserts value is MobileAgentScope {
  if (value === "claude" || value === "codex" || value === "gemini" || value === "opencode") {
    return;
  }
  throw new Error("Server returned an invalid agent scope.");
}

async function exchangePairingToken(
  origin: string,
  token: string,
): Promise<{
  sessionJwt: string;
  projectId: string;
  projectName: string | null;
  sessionExpiresAtMs: number;
}> {
  const payload = await fetchJsonWithTimeout<PairingExchangeResponse>(
    `${origin}/api/ngrok/pairing/exchange`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ token }),
    },
  );

  if (!payload.success || !payload.sessionJwt || !payload.project?.id) {
    throw new Error("Pairing exchange did not return a usable session.");
  }

  const sessionExpiresAtMs = getSessionExpiryMs(payload);
  return {
    sessionJwt: payload.sessionJwt,
    projectId: payload.project.id,
    projectName: payload.project.name ?? null,
    sessionExpiresAtMs,
  };
}

function getSessionExpiryMs(payload: { expiresAt?: string; expiresIn?: number }): number {
  if (typeof payload.expiresAt === "string") {
    const parsed = Date.parse(payload.expiresAt);
    if (Number.isFinite(parsed)) return parsed;
  }

  if (typeof payload.expiresIn === "number" && payload.expiresIn > 0) {
    return Date.now() + payload.expiresIn * 1000;
  }

  return Date.now() + 15 * 60 * 1000;
}

export async function runGatewayHealthcheck(
  origin: string,
  sessionJwt: string,
): Promise<{
  service: string | null;
}> {
  const payload = await fetchJsonWithTimeout<GatewayHealthResponse>(`${origin}/_ok/health`, {
    headers: {
      authorization: `Bearer ${sessionJwt}`,
    },
  });

  if (payload.ok !== true) {
    throw new Error("Gateway health check returned an unexpected response.");
  }

  return { service: payload.service ?? null };
}

export async function refreshGatewaySession(
  origin: string,
  sessionJwt: string,
): Promise<{ sessionJwt: string; sessionExpiresAtMs: number }> {
  const payload = await fetchJsonWithTimeout<RefreshSessionResponse>(`${origin}/_ok/refresh`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${sessionJwt}`,
    },
  });

  if (!payload.success || !payload.sessionJwt) {
    throw new Error("Gateway session refresh did not return a usable session.");
  }

  return {
    sessionJwt: payload.sessionJwt,
    sessionExpiresAtMs: getSessionExpiryMs(payload),
  };
}

export async function ensureFreshGatewaySession(
  session: GatewayConnection,
): Promise<GatewayConnection> {
  if (Date.now() + SESSION_REFRESH_WINDOW_MS < session.sessionExpiresAtMs) {
    return session;
  }

  const refreshed = await refreshGatewaySession(session.gatewayOrigin, session.sessionJwt);
  return {
    ...session,
    sessionJwt: refreshed.sessionJwt,
    sessionExpiresAtMs: refreshed.sessionExpiresAtMs,
  };
}

export async function connectToGatewayFromToken(
  rawOrigin: string,
  token: string,
): Promise<GatewayConnection> {
  const origin = normalizeOrigin(rawOrigin);
  const exchange = await exchangePairingToken(origin, token);
  const health = await runGatewayHealthcheck(origin, exchange.sessionJwt);

  return {
    sessionJwt: exchange.sessionJwt,
    sessionExpiresAtMs: exchange.sessionExpiresAtMs,
    gatewayOrigin: origin,
    gatewayApiBase: `${origin}/_ok/mobile/v1`,
    projectId: exchange.projectId,
    projectName: exchange.projectName,
    service: health.service,
  };
}

export async function connectToGatewayFromPairingUrl(
  pairingUrl: string,
): Promise<GatewayConnection> {
  const parsed = parsePairingUrl(pairingUrl);
  return connectToGatewayFromToken(parsed.origin, parsed.token);
}

export function parseConnectionPayloadFromQrData(value: string): PairingUrlPayload {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Scanned code is not a valid URL.");
  }

  const fromDeepLink = parseMobileConnectDeepLink(parsed);
  if (fromDeepLink) return fromDeepLink;

  const fromHttpsConnect = parseMobileConnectHttpsUrl(parsed);
  if (fromHttpsConnect) return fromHttpsConnect;

  if (parsed.protocol === "https:" && parsed.pathname === "/_ok/pair") {
    const token = parsed.searchParams.get("token")?.trim();
    if (!token) {
      throw new Error("Pairing URL is missing the token parameter.");
    }
    return { origin: parsed.origin, token };
  }

  throw new Error("QR code is not a supported OpenKit pairing link.");
}

export async function connectToGatewayFromQrData(qrData: string): Promise<GatewayConnection> {
  const payload = parseConnectionPayloadFromQrData(qrData);
  return connectToGatewayFromToken(payload.origin, payload.token);
}

async function fetchMobileApiWithAuth<T>(
  session: GatewayConnection,
  path: string,
  init?: RequestInit,
): Promise<{ session: GatewayConnection; payload: T }> {
  const freshSession = await ensureFreshGatewaySession(session);
  const headers = new Headers(init?.headers);
  headers.set("authorization", `Bearer ${freshSession.sessionJwt}`);
  const payload = await fetchJsonWithTimeout<T>(`${freshSession.gatewayApiBase}${path}`, {
    ...init,
    headers,
  });
  return { session: freshSession, payload };
}

export async function fetchMobileGatewayContext(
  session: GatewayConnection,
): Promise<{ session: GatewayConnection; context: MobileGatewayContext }> {
  const { session: freshSession, payload } = await fetchMobileApiWithAuth<MobileContextResponse>(
    session,
    "/context",
  );

  if (!payload.success || !payload.project?.id || !payload.project?.name || !payload.scopes) {
    throw new Error("Gateway did not return a valid mobile context.");
  }

  const scopes: MobileAgentScope[] = [];
  for (const scope of payload.scopes) {
    assertAgentScope(scope);
    scopes.push(scope);
  }

  const context: MobileGatewayContext = {
    projectId: payload.project.id,
    projectName: payload.project.name,
    scopes,
  };

  return { session: freshSession, context };
}

export async function fetchMobileWorktrees(
  session: GatewayConnection,
): Promise<{ session: GatewayConnection; worktrees: MobileWorktreeSummary[] }> {
  const { session: freshSession, payload } = await fetchMobileApiWithAuth<MobileWorktreesResponse>(
    session,
    "/worktrees",
  );

  if (!payload.success || !Array.isArray(payload.worktrees)) {
    throw new Error("Gateway did not return a valid worktree list.");
  }

  return {
    session: freshSession,
    worktrees: payload.worktrees,
  };
}

export async function fetchMobileAgentSessions(
  session: GatewayConnection,
  worktreeId: string,
): Promise<{ session: GatewayConnection; sessions: MobileAgentSessionSummary[] }> {
  if (!worktreeId.trim()) {
    throw new Error("worktreeId is required.");
  }

  const { session: freshSession, payload } =
    await fetchMobileApiWithAuth<MobileAgentSessionsResponse>(
      session,
      `/agent-sessions?worktreeId=${encodeURIComponent(worktreeId)}`,
    );

  if (!payload.success || !Array.isArray(payload.sessions)) {
    throw new Error("Gateway did not return a valid agent session list.");
  }

  const sessions: MobileAgentSessionSummary[] = payload.sessions.map((entry) => {
    assertAgentScope(entry.scope);
    return {
      scope: entry.scope,
      sessionId: typeof entry.sessionId === "string" ? entry.sessionId : null,
      active: entry.active === true,
    };
  });

  return { session: freshSession, sessions };
}

export async function connectMobileAgentSession(
  session: GatewayConnection,
  request: MobileConnectSessionRequest,
): Promise<{ session: GatewayConnection; result: MobileConnectSessionResult }> {
  const { session: freshSession, payload } =
    await fetchMobileApiWithAuth<ConnectAgentSessionResponse>(session, "/agent-sessions/connect", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify(request),
    });

  if (!payload.success || !payload.sessionId) {
    throw new Error("Gateway did not return a valid session connection response.");
  }

  return {
    session: freshSession,
    result: {
      sessionId: payload.sessionId,
      created: payload.created === true,
    },
  };
}

export function getMobileSessionWebSocketUrl(
  session: GatewayConnection,
  sessionId: string,
): string {
  if (!sessionId.trim()) {
    throw new Error("sessionId is required.");
  }

  const wsOrigin = session.gatewayOrigin.replace(/^http/, "ws");
  const tokenParam = encodeURIComponent(session.sessionJwt);
  return `${wsOrigin}/_ok/mobile/v1/agent-sessions/${encodeURIComponent(sessionId)}/ws?accessToken=${tokenParam}`;
}
