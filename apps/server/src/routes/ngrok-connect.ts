import { spawn, type ChildProcess } from "child_process";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { UpgradeWebSocket } from "hono/ws";
import type { WebSocket } from "ws";

import type { WorktreeManager } from "../manager";
import type { TerminalManager } from "../terminal-manager";

const LOCAL_SESSION_COOKIE = "ok_session";

const LOCAL_SESSION_TTL_SEC = 8 * 60 * 60;
const GATEWAY_SESSION_TTL_SEC = 15 * 60;
const PAIRING_TOKEN_TTL_MS = 90 * 1000;
const PAIRING_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PAIRING_RATE_LIMIT_MAX_ATTEMPTS = 12;
const PAIRING_RATE_LIMIT_BLOCK_MS = 5 * 60 * 1000;
const PAIRING_STATUS_RETENTION_MS = 10 * 60 * 1000;
const PAIRING_REPLAY_WINDOW_MS = 30 * 1000;
const NGROK_START_TIMEOUT_MS = 20 * 1000;
const NGROK_PUBLIC_URL_PATTERN = /https:\/\/[a-zA-Z0-9.-]+\.ngrok(?:-free)?\.(?:app|io)/;
const DEFAULT_MOBILE_DEEP_LINK_SCHEME = "mobileapp";
const MAX_MOBILE_PROMPT_CHARS = 4000;
const MOBILE_AGENT_SCOPES = ["claude", "codex", "gemini", "opencode"] as const;

type TunnelStatus = "stopped" | "starting" | "running" | "error";
type MobileAgentScope = (typeof MOBILE_AGENT_SCOPES)[number];

interface SignedTokenPayload {
  typ: "ok";
  exp: number;
  iat: number;
  userId: string;
  email?: string;
  projectId: string;
}

interface PendingPairingToken {
  id: string;
  projectId: string;
  expiresAt: number;
  usedAt: number | null;
}

type PairingStatus = "pending" | "used" | "expired";

interface PairingStatusRecord {
  id: string;
  projectId: string;
  status: PairingStatus;
  expiresAt: number;
  usedAt: number | null;
  updatedAt: number;
}

interface PairingAttemptBucket {
  windowStartMs: number;
  attempts: number;
  blockedUntilMs: number;
}

interface ConsumedPairingTokenRecord {
  pairingId: string;
  projectId: string;
  consumedAtMs: number;
  clientIp: string;
}

interface NgrokTunnelRuntime {
  enabled: boolean;
  status: TunnelStatus;
  publicUrl: string | null;
  localPort: number | null;
  startedAt: string | null;
  error: string | null;
  process: ChildProcess | null;
  manualStop: boolean;
}

function isMobileAgentScope(value: unknown): value is MobileAgentScope {
  return value === "claude" || value === "codex" || value === "gemini" || value === "opencode";
}

function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}

function hashSha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function signInput(input: string, secret: string): string {
  return createHmac("sha256", secret).update(input, "utf-8").digest("base64url");
}

function createSignedToken(payload: SignedTokenPayload, secret: string): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf-8").toString("base64url");
  const signature = signInput(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

function parseSignedToken(token: string, secret: string): SignedTokenPayload | null {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) return null;

  const expected = signInput(encodedPayload, secret);
  const providedBuf = Buffer.from(signature, "utf-8");
  const expectedBuf = Buffer.from(expected, "utf-8");
  if (providedBuf.length !== expectedBuf.length) return null;
  if (!timingSafeEqual(providedBuf, expectedBuf)) return null;

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf-8"),
    ) as Partial<SignedTokenPayload>;
    if (payload.typ !== "ok") return null;
    if (typeof payload.userId !== "string" || !payload.userId) return null;
    if (typeof payload.projectId !== "string" || !payload.projectId) return null;
    if (typeof payload.iat !== "number" || typeof payload.exp !== "number") return null;
    if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return payload as SignedTokenPayload;
  } catch {
    return null;
  }
}

function sanitizeNextPath(value: string | null | undefined): string {
  if (!value) return "/";
  if (!value.startsWith("/")) return "/";
  if (value.startsWith("//")) return "/";
  return value;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeNgrokUrl(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol !== "https:") return null;
    url.pathname = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

function normalizeDeepLinkScheme(rawValue: string | undefined): string {
  const candidate = rawValue?.trim().toLowerCase();
  if (!candidate) return DEFAULT_MOBILE_DEEP_LINK_SCHEME;
  if (!/^[a-z][a-z0-9+.-]*$/.test(candidate)) return DEFAULT_MOBILE_DEEP_LINK_SCHEME;
  return candidate;
}

function isSecureRequest(url: URL): boolean {
  return url.protocol === "https:";
}

function getClientIp(c: Context): string {
  const fromForwarded = c.req.header("x-forwarded-for");
  if (fromForwarded) {
    const candidate = fromForwarded.split(",")[0]?.trim();
    if (candidate) return candidate;
  }
  const fromCf = c.req.header("cf-connecting-ip");
  if (fromCf) return fromCf.trim();
  return "unknown";
}

function getProjectId(configDir: string): string {
  return createHash("sha1").update(configDir, "utf-8").digest("hex").slice(0, 12);
}

function extractNgrokPublicUrl(raw: string): string | null {
  const match = raw.match(NGROK_PUBLIC_URL_PATTERN);
  if (!match?.[0]) return null;
  return normalizeNgrokUrl(match[0]);
}

function getRequestPort(c: Context): number {
  const reqUrl = new URL(c.req.url);
  if (reqUrl.port) {
    const parsed = Number.parseInt(reqUrl.port, 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return reqUrl.protocol === "https:" ? 443 : 80;
}

function shellQuoteSingle(value: string): string {
  if (!value) return "''";
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function buildAgentStartupCommand(
  scope: MobileAgentScope,
  options: { prompt: string | null; skipPermissions: boolean },
): string {
  const prompt = options.prompt?.trim() || "";

  if (scope === "claude") {
    const args: string[] = [];
    if (options.skipPermissions) args.push("--dangerously-skip-permissions");
    if (prompt) args.push(shellQuoteSingle(prompt));
    const invocation = args.length > 0 ? `claude ${args.join(" ")}` : "claude";
    return `exec ${invocation}`;
  }

  if (scope === "codex") {
    const args: string[] = [];
    if (options.skipPermissions) args.push("--dangerously-bypass-approvals-and-sandbox");
    if (prompt) args.push(shellQuoteSingle(prompt));
    const invocation = args.length > 0 ? `codex ${args.join(" ")}` : "codex";
    return `exec ${invocation}`;
  }

  if (scope === "gemini") {
    const args: string[] = [];
    if (options.skipPermissions) args.push("--yolo");
    if (prompt) args.push("-i", shellQuoteSingle(prompt));
    const invocation = args.length > 0 ? `gemini ${args.join(" ")}` : "gemini";
    return `exec ${invocation}`;
  }

  const args: string[] = [];
  if (prompt) args.push("--prompt", shellQuoteSingle(prompt));
  const prefix = options.skipPermissions ? `OPENCODE_PERMISSION='{"*":"allow"}' ` : "";
  const invocation = args.length > 0 ? `${prefix}opencode ${args.join(" ")}` : `${prefix}opencode`;
  return `exec ${invocation}`;
}

function normalizePrompt(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_MOBILE_PROMPT_CHARS) {
    throw new Error(`prompt must be <= ${MAX_MOBILE_PROMPT_CHARS} characters.`);
  }
  return trimmed;
}

function normalizeTerminalDimension(
  input: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof input !== "number" || !Number.isFinite(input)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(input)));
}

export function registerNgrokConnectRoutes(
  app: Hono,
  manager: WorktreeManager,
  terminalManager: TerminalManager,
  upgradeWebSocket: UpgradeWebSocket<WebSocket>,
) {
  const pairingTokens = new Map<string, PendingPairingToken>();
  const pairingStatusById = new Map<string, PairingStatusRecord>();
  const consumedPairingTokens = new Map<string, ConsumedPairingTokenRecord>();
  const pairingAttempts = new Map<string, PairingAttemptBucket>();
  const signingSecret = process.env.OPENKIT_NGROK_SIGNING_SECRET || randomToken(32);

  const currentProjectId = getProjectId(manager.getConfigDir());
  const currentProjectName = manager.getProjectName() ?? currentProjectId;
  const mobileDeepLinkScheme = normalizeDeepLinkScheme(process.env.OPENKIT_NGROK_MOBILE_SCHEME);
  const pairingRateLimitEnabled = process.env.OPENKIT_NGROK_PAIRING_RATE_LIMIT === "1";

  const tunnel: NgrokTunnelRuntime = {
    enabled: false,
    status: "stopped",
    publicUrl: null,
    localPort: null,
    startedAt: null,
    error: null,
    process: null,
    manualStop: false,
  };

  let tunnelStartPromise: Promise<string> | null = null;

  const getStatusPayload = () => ({
    success: true,
    project: {
      id: currentProjectId,
      name: currentProjectName,
    },
    tunnel: {
      enabled: tunnel.enabled,
      status: tunnel.status,
      publicUrl: tunnel.publicUrl,
      localPort: tunnel.localPort,
      startedAt: tunnel.startedAt,
      error: tunnel.error,
    },
  });

  const prunePairingTokens = (nowMs = Date.now()) => {
    for (const [tokenHash, token] of pairingTokens.entries()) {
      if (token.usedAt !== null) {
        pairingTokens.delete(tokenHash);
        continue;
      }
      if (token.expiresAt <= nowMs) {
        const record = pairingStatusById.get(token.id);
        if (record?.status === "pending") {
          record.status = "expired";
          record.updatedAt = nowMs;
        }
        pairingTokens.delete(tokenHash);
      }
    }
  };

  const prunePairingStatus = (nowMs = Date.now()) => {
    for (const [pairingId, pairing] of pairingStatusById.entries()) {
      if (pairing.status === "pending" && pairing.expiresAt <= nowMs) {
        pairing.status = "expired";
        pairing.updatedAt = nowMs;
      }

      const retentionBaseMs =
        pairing.status === "used" ? (pairing.usedAt ?? pairing.updatedAt) : pairing.expiresAt;
      if (nowMs - retentionBaseMs > PAIRING_STATUS_RETENTION_MS) {
        pairingStatusById.delete(pairingId);
      }
    }
  };

  const prunePairingState = (nowMs = Date.now()) => {
    prunePairingTokens(nowMs);
    prunePairingStatus(nowMs);
    for (const [tokenHash, consumed] of consumedPairingTokens.entries()) {
      if (nowMs - consumed.consumedAtMs > PAIRING_REPLAY_WINDOW_MS) {
        consumedPairingTokens.delete(tokenHash);
      }
    }
  };

  const takePairingToken = (
    token: string,
    expectedProjectId: string,
    clientIp: string,
  ): { ok: true; sessionId: string; replayed: boolean } | { ok: false } => {
    const tokenHash = hashSha256Hex(token);
    const nowMs = Date.now();
    prunePairingState(nowMs);

    const pending = pairingTokens.get(tokenHash);
    if (!pending) {
      const consumed = consumedPairingTokens.get(tokenHash);
      if (!consumed) return { ok: false };
      if (consumed.projectId !== expectedProjectId) return { ok: false };
      if (nowMs - consumed.consumedAtMs > PAIRING_REPLAY_WINDOW_MS) return { ok: false };

      const sameClient =
        consumed.clientIp === clientIp || consumed.clientIp === "unknown" || clientIp === "unknown";
      if (!sameClient) return { ok: false };

      return { ok: true, sessionId: consumed.pairingId, replayed: true };
    }
    if (pending.usedAt !== null) return { ok: false };
    if (pending.expiresAt <= nowMs) {
      pairingTokens.delete(tokenHash);
      return { ok: false };
    }
    if (pending.projectId !== expectedProjectId) return { ok: false };

    pending.usedAt = nowMs;
    pairingTokens.delete(tokenHash);
    consumedPairingTokens.set(tokenHash, {
      pairingId: pending.id,
      projectId: pending.projectId,
      consumedAtMs: nowMs,
      clientIp,
    });
    const pairingStatus = pairingStatusById.get(pending.id);
    if (pairingStatus) {
      pairingStatus.status = "used";
      pairingStatus.usedAt = nowMs;
      pairingStatus.updatedAt = nowMs;
    }
    return { ok: true, sessionId: pending.id, replayed: false };
  };

  const applyPairingRateLimit = (c: Context): Response | null => {
    if (!pairingRateLimitEnabled) {
      return null;
    }

    const nowMs = Date.now();
    const ip = getClientIp(c);
    const existing = pairingAttempts.get(ip);

    if (existing?.blockedUntilMs && existing.blockedUntilMs > nowMs) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.blockedUntilMs - nowMs) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        {
          error: {
            code: "pair_rate_limited",
            message: "Pairing temporarily blocked. Try again shortly.",
          },
          retryAfterSec,
        },
        429,
      );
    }

    if (!existing || nowMs - existing.windowStartMs >= PAIRING_RATE_LIMIT_WINDOW_MS) {
      pairingAttempts.set(ip, {
        windowStartMs: nowMs,
        attempts: 1,
        blockedUntilMs: 0,
      });
      return null;
    }

    existing.attempts += 1;
    if (existing.attempts > PAIRING_RATE_LIMIT_MAX_ATTEMPTS) {
      existing.blockedUntilMs = nowMs + PAIRING_RATE_LIMIT_BLOCK_MS;
      const retryAfterSec = Math.max(1, Math.ceil(PAIRING_RATE_LIMIT_BLOCK_MS / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        {
          error: {
            code: "pair_rate_limited",
            message: "Pairing temporarily blocked. Try again shortly.",
          },
          retryAfterSec,
        },
        429,
      );
    }

    return null;
  };

  const parseLocalSession = (c: Context): SignedTokenPayload | null => {
    const raw = getCookie(c, LOCAL_SESSION_COOKIE);
    if (!raw) return null;
    return parseSignedToken(raw, signingSecret);
  };

  const parseGatewayAuth = (c: Context): SignedTokenPayload | null => {
    const cookiePayload = parseLocalSession(c);
    if (cookiePayload) return cookiePayload;

    const authHeader = c.req.header("authorization");
    if (!authHeader?.startsWith("Bearer ")) return null;
    const token = authHeader.slice("Bearer ".length).trim();
    return parseSignedToken(token, signingSecret);
  };

  const issueGatewaySession = (payload: {
    userId: string;
    projectId: string;
    email?: string;
  }): {
    sessionJwt: string;
    expiresIn: number;
    expiresAt: string;
  } => {
    const nowSec = Math.floor(Date.now() / 1000);
    const expiresIn = GATEWAY_SESSION_TTL_SEC;
    const sessionJwt = createSignedToken(
      {
        typ: "ok",
        userId: payload.userId,
        email: payload.email,
        projectId: payload.projectId,
        iat: nowSec,
        exp: nowSec + expiresIn,
      },
      signingSecret,
    );

    return {
      sessionJwt,
      expiresIn,
      expiresAt: new Date((nowSec + expiresIn) * 1000).toISOString(),
    };
  };

  const stopNgrokTunnel = async (): Promise<void> => {
    const processRef = tunnel.process;

    tunnel.manualStop = true;
    tunnel.process = null;
    tunnelStartPromise = null;

    if (processRef) {
      await new Promise<void>((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        const timeout = setTimeout(() => {
          try {
            processRef.kill("SIGKILL");
          } catch {
            // ignore
          }
          finish();
        }, 1500);

        processRef.once("exit", () => {
          clearTimeout(timeout);
          finish();
        });

        try {
          processRef.kill("SIGTERM");
        } catch {
          clearTimeout(timeout);
          finish();
        }
      });
    }

    tunnel.enabled = false;
    tunnel.status = "stopped";
    tunnel.publicUrl = null;
    tunnel.localPort = null;
    tunnel.startedAt = null;
    tunnel.error = null;
    tunnel.manualStop = false;
  };

  const startNgrokTunnel = async (localPort: number, forceRestart = false): Promise<string> => {
    if (forceRestart) {
      await stopNgrokTunnel();
    }

    if (
      tunnel.status === "running" &&
      tunnel.publicUrl &&
      tunnel.localPort === localPort &&
      tunnel.process
    ) {
      return tunnel.publicUrl;
    }

    if (tunnelStartPromise) {
      return tunnelStartPromise;
    }

    if (tunnel.process) {
      await stopNgrokTunnel();
    }

    tunnel.status = "starting";
    tunnel.enabled = false;
    tunnel.publicUrl = null;
    tunnel.localPort = localPort;
    tunnel.startedAt = null;
    tunnel.error = null;
    tunnel.manualStop = false;

    const proc = spawn("ngrok", ["http", String(localPort), "--log", "stdout"], {
      stdio: ["ignore", "pipe", "pipe"],
    });

    tunnel.process = proc;

    tunnelStartPromise = new Promise<string>((resolve, reject) => {
      let settled = false;
      let stdOutBuffer = "";
      let stdErrBuffer = "";

      const fail = (message: string) => {
        if (settled) return;
        settled = true;
        tunnel.enabled = false;
        tunnel.status = "error";
        tunnel.error = message;
        tunnel.publicUrl = null;
        tunnel.startedAt = null;
        if (tunnel.process === proc) {
          tunnel.process = null;
        }
        reject(new Error(message));
      };

      const succeed = (publicUrl: string) => {
        if (settled) return;
        settled = true;
        tunnel.enabled = true;
        tunnel.status = "running";
        tunnel.publicUrl = publicUrl;
        tunnel.startedAt = new Date().toISOString();
        tunnel.error = null;
        resolve(publicUrl);
      };

      const scanChunk = (chunk: string, isStdErr: boolean) => {
        if (isStdErr) {
          stdErrBuffer += chunk;
        } else {
          stdOutBuffer += chunk;
        }

        const lines = chunk.split("\n");
        for (const line of lines) {
          const match = extractNgrokPublicUrl(line);
          if (match) {
            succeed(match);
            return;
          }
        }
      };

      const timeout = setTimeout(() => {
        const detail = (stdErrBuffer || stdOutBuffer).trim();
        const suffix = detail ? ` ${detail}` : "";
        fail(`Timed out waiting for ngrok public URL.${suffix}`);
        try {
          proc.kill("SIGTERM");
        } catch {
          // ignore
        }
      }, NGROK_START_TIMEOUT_MS);

      proc.stdout.on("data", (data: Buffer) => scanChunk(data.toString("utf-8"), false));
      proc.stderr.on("data", (data: Buffer) => scanChunk(data.toString("utf-8"), true));

      proc.once("error", (err) => {
        clearTimeout(timeout);
        fail(`Failed to start ngrok process: ${err.message}`);
      });

      proc.on("exit", (code, signal) => {
        if (tunnel.process === proc) {
          tunnel.process = null;
          if (tunnel.manualStop) {
            tunnel.enabled = false;
            tunnel.status = "stopped";
            tunnel.publicUrl = null;
            tunnel.localPort = null;
            tunnel.startedAt = null;
            tunnel.error = null;
          } else if (settled) {
            tunnel.enabled = false;
            tunnel.status = "error";
            tunnel.error = `ngrok tunnel exited (${code ?? "null"}/${signal ?? "null"}).`;
            tunnel.publicUrl = null;
            tunnel.startedAt = null;
          }
        }

        if (!settled) {
          clearTimeout(timeout);
          const detail = (stdErrBuffer || stdOutBuffer).trim();
          const suffix = detail ? ` ${detail}` : "";
          fail(
            `ngrok exited before reporting a public URL (${code ?? "null"}/${signal ?? "null"}).${suffix}`,
          );
        }
      });
    }).finally(() => {
      tunnelStartPromise = null;
    });

    return tunnelStartPromise;
  };

  const ensureTunnelUrl = async (
    c: Context,
    options?: { regenerateUrl?: boolean },
  ): Promise<string> => {
    const localPort = getRequestPort(c);
    const publicUrl = await startNgrokTunnel(localPort, options?.regenerateUrl === true);
    if (!publicUrl) {
      throw new Error("ngrok did not return a public URL.");
    }
    return publicUrl;
  };

  app.get("/api/ngrok/status", (c) => c.json(getStatusPayload()));

  app.get("/api/ngrok/tunnel/status", (c) => c.json(getStatusPayload()));

  app.post("/api/ngrok/tunnel/enable", async (c) => {
    const body = await c.req
      .json<{ regenerateUrl?: boolean }>()
      .catch(() => ({ regenerateUrl: undefined }));

    try {
      await ensureTunnelUrl(c, { regenerateUrl: body.regenerateUrl === true });
      return c.json(getStatusPayload());
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to start ngrok tunnel.";
      return c.json({ error: { code: "ngrok_start_failed", message } }, 500);
    }
  });

  app.post("/api/ngrok/tunnel/disable", async (c) => {
    await stopNgrokTunnel();
    return c.json(getStatusPayload());
  });

  app.post("/api/ngrok/pairing/start", async (c) => {
    const body = await c.req
      .json<{ next?: string; regenerateUrl?: boolean }>()
      .catch(() => ({ next: undefined, regenerateUrl: undefined }));

    try {
      const publicUrl = await ensureTunnelUrl(c, { regenerateUrl: body.regenerateUrl === true });
      const next = sanitizeNextPath(body.next);
      const nowMs = Date.now();
      prunePairingState(nowMs);
      const token = randomToken(24);
      const tokenHash = hashSha256Hex(token);
      const expiresAtMs = nowMs + PAIRING_TOKEN_TTL_MS;
      const pairingId = randomUUID();

      pairingTokens.set(tokenHash, {
        id: pairingId,
        projectId: currentProjectId,
        expiresAt: expiresAtMs,
        usedAt: null,
      });
      pairingStatusById.set(pairingId, {
        id: pairingId,
        projectId: currentProjectId,
        status: "pending",
        expiresAt: expiresAtMs,
        usedAt: null,
        updatedAt: nowMs,
      });

      const pairUrl = new URL(`${publicUrl}/_ok/pair`);
      pairUrl.searchParams.set("token", token);
      pairUrl.searchParams.set("next", next || "/");
      const mobilePairUrl = new URL(`${publicUrl}/_ok/mobile/connect`);
      mobilePairUrl.searchParams.set("token", token);
      const mobileApiBase = `${publicUrl}/_ok/mobile/v1`;

      return c.json({
        success: true,
        project: {
          id: currentProjectId,
          name: currentProjectName,
        },
        pairingId,
        pairUrl: pairUrl.toString(),
        mobilePairUrl: mobilePairUrl.toString(),
        mobileApiBase,
        gatewayApiBase: mobileApiBase,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresIn: Math.floor(PAIRING_TOKEN_TTL_MS / 1000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare pairing URL.";
      return c.json({ error: { code: "ngrok_start_failed", message } }, 500);
    }
  });

  app.get("/api/ngrok/pairing/status/:pairingId", (c) => {
    const pairingId = c.req.param("pairingId")?.trim();
    if (!pairingId) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "pairingId is required.",
          },
        },
        400,
      );
    }

    const nowMs = Date.now();
    prunePairingState(nowMs);
    const pairing = pairingStatusById.get(pairingId);
    if (!pairing || pairing.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "pair_not_found",
            message: "Pairing session not found.",
          },
        },
        404,
      );
    }

    return c.json({
      success: true,
      pairing: {
        id: pairing.id,
        status: pairing.status,
        expiresAt: new Date(pairing.expiresAt).toISOString(),
        usedAt: pairing.usedAt ? new Date(pairing.usedAt).toISOString() : null,
      },
    });
  });

  app.post("/api/ngrok/pairing/exchange", async (c) => {
    const limited = applyPairingRateLimit(c);
    if (limited) return limited;

    const body = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
    const token = body.token?.trim();
    if (!token) {
      return c.json({ error: { code: "invalid_payload", message: "token is required." } }, 400);
    }

    const consumeResult = takePairingToken(token, currentProjectId, getClientIp(c));
    if (!consumeResult.ok) {
      return c.json(
        { error: { code: "pair_invalid", message: "Invalid or expired pairing token." } },
        400,
      );
    }

    const issuedSession = issueGatewaySession({
      userId: `paired:${consumeResult.sessionId}`,
      projectId: currentProjectId,
    });

    return c.json({
      success: true,
      sessionJwt: issuedSession.sessionJwt,
      expiresIn: issuedSession.expiresIn,
      expiresAt: issuedSession.expiresAt,
      replayed: consumeResult.replayed,
      project: {
        id: currentProjectId,
        name: currentProjectName,
      },
    });
  });

  app.get("/_ok/health", (c) => c.json({ ok: true, service: "openkit-gateway" }));

  app.get("/_ok/mobile/connect", (c) => {
    const reqUrl = new URL(c.req.url);
    const token = c.req.query("token")?.trim();
    if (!token) {
      return c.json(
        { error: { code: "pair_invalid", message: "Missing token for mobile connect." } },
        400,
      );
    }

    const origin = normalizeNgrokUrl(reqUrl.origin);
    if (!origin) {
      return c.json(
        {
          error: {
            code: "pair_invalid",
            message: "Mobile connect requires a valid HTTPS origin.",
          },
        },
        400,
      );
    }

    const deepLink = new URL(`${mobileDeepLinkScheme}://connect`);
    deepLink.searchParams.set("origin", origin);
    deepLink.searchParams.set("token", token);
    const deepLinkUrl = deepLink.toString();
    const escapedDeepLinkUrl = escapeHtml(deepLinkUrl);

    return c.html(
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>OpenKit Mobile Connect</title>
    <style>
      :root { color-scheme: dark; }
      body {
        margin: 0;
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        background: #0a0f18;
        color: #dbe7ff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .card {
        width: 100%;
        max-width: 420px;
        border: 1px solid #2c3a4f;
        border-radius: 14px;
        background: #101825;
        padding: 18px;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 17px;
      }
      p {
        margin: 0;
        line-height: 1.45;
        color: #b7c8e8;
        font-size: 14px;
      }
      .actions {
        margin-top: 14px;
        display: flex;
        gap: 8px;
      }
      .button {
        display: inline-block;
        border-radius: 10px;
        padding: 10px 12px;
        font-weight: 600;
        font-size: 13px;
        text-decoration: none;
        border: 1px solid #3b6ab4;
        color: #d9e9ff;
        background: #1a3761;
      }
      .hint {
        margin-top: 10px;
        font-size: 12px;
        color: #8da6cf;
      }
    </style>
  </head>
  <body>
    <main class="card">
      <h1>Opening OpenKit Mobile...</h1>
      <p>If the app does not open automatically, tap the button below.</p>
      <div class="actions">
        <a id="open-app" class="button" href="${escapedDeepLinkUrl}">Open App</a>
      </div>
      <p class="hint">Deep link: ${escapedDeepLinkUrl}</p>
    </main>
    <script>
      const deepLink = ${JSON.stringify(deepLinkUrl)};
      const anchor = document.getElementById("open-app");
      if (anchor) anchor.setAttribute("href", deepLink);
      window.setTimeout(() => {
        window.location.href = deepLink;
      }, 50);
    </script>
  </body>
</html>`,
      200,
    );
  });

  app.get("/_ok/pair", (c) => {
    const reqUrl = new URL(c.req.url);
    const limited = applyPairingRateLimit(c);
    if (limited) return limited;

    const token = c.req.query("token")?.trim();
    const next = sanitizeNextPath(c.req.query("next"));
    if (!token) {
      return c.json(
        { error: { code: "pair_invalid", message: "Invalid or expired pairing token." } },
        400,
      );
    }

    const consumeResult = takePairingToken(token, currentProjectId, getClientIp(c));
    if (!consumeResult.ok) {
      return c.json(
        { error: { code: "pair_invalid", message: "Invalid or expired pairing token." } },
        400,
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const localSession = createSignedToken(
      {
        typ: "ok",
        userId: `paired:${consumeResult.sessionId}`,
        projectId: currentProjectId,
        iat: nowSec,
        exp: nowSec + LOCAL_SESSION_TTL_SEC,
      },
      signingSecret,
    );

    setCookie(c, LOCAL_SESSION_COOKIE, localSession, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      secure: isSecureRequest(reqUrl),
      maxAge: LOCAL_SESSION_TTL_SEC,
    });

    return c.redirect(next || "/", 302);
  });

  app.get("/_ok/me", (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }

    return c.json({
      user: {
        id: session.userId,
        email: session.email ?? null,
      },
      projectId: session.projectId,
    });
  });

  app.post("/_ok/refresh", (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }

    if (session.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "project_forbidden",
            message: "Session does not allow access to this project.",
          },
        },
        403,
      );
    }

    const issuedSession = issueGatewaySession({
      userId: session.userId,
      email: session.email,
      projectId: session.projectId,
    });

    return c.json({
      success: true,
      sessionJwt: issuedSession.sessionJwt,
      expiresIn: issuedSession.expiresIn,
      expiresAt: issuedSession.expiresAt,
      project: {
        id: currentProjectId,
        name: currentProjectName,
      },
    });
  });

  app.get("/_ok/mobile/v1/context", (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }
    if (session.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "project_forbidden",
            message: "Session does not allow access to this project.",
          },
        },
        403,
      );
    }

    return c.json({
      success: true,
      project: {
        id: currentProjectId,
        name: currentProjectName,
      },
      scopes: MOBILE_AGENT_SCOPES,
    });
  });

  app.get("/_ok/mobile/v1/worktrees", (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }
    if (session.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "project_forbidden",
            message: "Session does not allow access to this project.",
          },
        },
        403,
      );
    }

    const worktrees = manager.getWorktrees().map((worktree) => ({
      id: worktree.id,
      branch: worktree.branch,
      status: worktree.status,
      jiraStatus: worktree.jiraStatus ?? null,
      linearStatus: worktree.linearStatus ?? null,
      localIssueStatus: worktree.localIssueStatus ?? null,
      hasActivePorts: worktree.ports.length > 0,
    }));

    return c.json({ success: true, worktrees });
  });

  app.get("/_ok/mobile/v1/agent-sessions", (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }
    if (session.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "project_forbidden",
            message: "Session does not allow access to this project.",
          },
        },
        403,
      );
    }

    const worktreeId = c.req.query("worktreeId")?.trim();
    if (!worktreeId) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "worktreeId is required.",
          },
        },
        400,
      );
    }

    const worktree = manager.getWorktrees().find((entry) => entry.id === worktreeId);
    if (!worktree) {
      return c.json(
        {
          error: {
            code: "worktree_not_found",
            message: "Worktree not found.",
          },
        },
        404,
      );
    }

    const sessions = MOBILE_AGENT_SCOPES.map((scope) => {
      const sessionId = terminalManager.getSessionIdForScope(worktree.id, scope);
      return {
        scope,
        sessionId,
        active: Boolean(sessionId),
      };
    });

    return c.json({
      success: true,
      worktree: {
        id: worktree.id,
        branch: worktree.branch,
      },
      sessions,
    });
  });

  app.post("/_ok/mobile/v1/agent-sessions/connect", async (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }
    if (session.projectId !== currentProjectId) {
      return c.json(
        {
          error: {
            code: "project_forbidden",
            message: "Session does not allow access to this project.",
          },
        },
        403,
      );
    }

    const body = await c.req
      .json<Record<string, unknown>>()
      .catch(() => ({}) as Record<string, unknown>);

    const allowedBodyKeys = new Set([
      "worktreeId",
      "scope",
      "startIfMissing",
      "prompt",
      "skipPermissions",
      "cols",
      "rows",
    ]);
    const unknownKeys = Object.keys(body).filter((key) => !allowedBodyKeys.has(key));
    if (unknownKeys.length > 0) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: `Unknown field(s): ${unknownKeys.join(", ")}.`,
          },
        },
        400,
      );
    }

    const worktreeId = typeof body.worktreeId === "string" ? body.worktreeId.trim() : "";
    if (!worktreeId) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "worktreeId is required.",
          },
        },
        400,
      );
    }

    if (!isMobileAgentScope(body.scope)) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: 'scope must be one of "claude", "codex", "gemini", or "opencode".',
          },
        },
        400,
      );
    }

    if (typeof body.startIfMissing !== "boolean" && body.startIfMissing !== undefined) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "startIfMissing must be a boolean when provided.",
          },
        },
        400,
      );
    }

    if (typeof body.skipPermissions !== "boolean" && body.skipPermissions !== undefined) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "skipPermissions must be a boolean when provided.",
          },
        },
        400,
      );
    }

    if (typeof body.prompt !== "string" && body.prompt !== undefined) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "prompt must be a string when provided.",
          },
        },
        400,
      );
    }

    if (typeof body.cols !== "number" && body.cols !== undefined) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "cols must be a number when provided.",
          },
        },
        400,
      );
    }

    if (typeof body.rows !== "number" && body.rows !== undefined) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: "rows must be a number when provided.",
          },
        },
        400,
      );
    }

    const worktree = manager.getWorktrees().find((entry) => entry.id === worktreeId);
    if (!worktree) {
      return c.json(
        {
          error: {
            code: "worktree_not_found",
            message: "Worktree not found.",
          },
        },
        404,
      );
    }

    const existingSessionId = terminalManager.getSessionIdForScope(worktree.id, body.scope);
    if (existingSessionId) {
      return c.json({
        success: true,
        sessionId: existingSessionId,
        created: false,
      });
    }

    if (body.startIfMissing !== true) {
      return c.json(
        {
          error: {
            code: "session_not_found",
            message: "No active session for this worktree and scope.",
          },
        },
        404,
      );
    }

    const cols = normalizeTerminalDimension(body.cols, 120, 40, 320);
    const rows = normalizeTerminalDimension(body.rows, 30, 10, 120);

    let prompt: string | null;
    try {
      prompt = normalizePrompt(body.prompt);
    } catch (error) {
      return c.json(
        {
          error: {
            code: "invalid_payload",
            message: error instanceof Error ? error.message : "Invalid prompt.",
          },
        },
        400,
      );
    }

    const startupCommand = buildAgentStartupCommand(body.scope, {
      prompt,
      skipPermissions: body.skipPermissions === true,
    });

    try {
      const sessionId = terminalManager.createSession(
        worktree.id,
        worktree.path,
        cols,
        rows,
        startupCommand,
        body.scope,
      );

      return c.json({
        success: true,
        sessionId,
        created: true,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create agent session.";
      return c.json(
        {
          error: {
            code: "session_create_failed",
            message,
          },
        },
        500,
      );
    }
  });

  app.get(
    "/_ok/mobile/v1/agent-sessions/:sessionId/ws",
    upgradeWebSocket((c) => {
      const authSession =
        parseGatewayAuth(c) ??
        (() => {
          const queryToken = c.req.query("accessToken")?.trim();
          if (!queryToken) return null;
          return parseSignedToken(queryToken, signingSecret);
        })();
      const sessionId = c.req.param("sessionId");
      const requestPath = new URL(c.req.url).pathname;

      if (!authSession || !sessionId) {
        console.warn("[ngrok-mobile-ws] unauthenticated", {
          path: requestPath,
          hasSessionId: Boolean(sessionId),
          hasAuthSession: Boolean(authSession),
          hasAccessToken: Boolean(c.req.query("accessToken")),
        });
        return {
          onOpen(_evt, ws) {
            ws.close(1008, "unauthenticated");
          },
        };
      }

      if (authSession.projectId !== currentProjectId) {
        console.warn("[ngrok-mobile-ws] project-forbidden", {
          path: requestPath,
          sessionId,
          tokenProjectId: authSession.projectId,
          currentProjectId,
        });
        return {
          onOpen(_evt, ws) {
            ws.close(1008, "project-forbidden");
          },
        };
      }

      const metadata = terminalManager.getSessionMetadata(sessionId);
      if (!metadata) {
        console.warn("[ngrok-mobile-ws] session-not-found", {
          path: requestPath,
          sessionId,
        });
        return {
          onOpen(_evt, ws) {
            ws.close(1008, "session-not-found");
          },
        };
      }

      if (!isMobileAgentScope(metadata.scope)) {
        console.warn("[ngrok-mobile-ws] scope-forbidden", {
          path: requestPath,
          sessionId,
          scope: metadata.scope,
        });
        return {
          onOpen(_evt, ws) {
            ws.close(1008, "scope-forbidden");
          },
        };
      }

      const worktreeExists = manager
        .getWorktrees()
        .some((entry) => entry.id === metadata.worktreeId);
      if (!worktreeExists) {
        console.warn("[ngrok-mobile-ws] worktree-missing-session-not-found", {
          path: requestPath,
          sessionId,
          worktreeId: metadata.worktreeId,
        });
        return {
          onOpen(_evt, ws) {
            ws.close(1008, "session-not-found");
          },
        };
      }

      return {
        onOpen(_evt, ws) {
          const rawWs = ws.raw as WebSocket;
          const attached = terminalManager.attachWebSocket(sessionId, rawWs);
          if (!attached) {
            console.warn("[ngrok-mobile-ws] attach-failed-session-not-found", {
              path: requestPath,
              sessionId,
            });
            ws.close(1008, "session-not-found");
            return;
          }
          console.info("[ngrok-mobile-ws] attached", {
            path: requestPath,
            sessionId,
            worktreeId: metadata.worktreeId,
            scope: metadata.scope,
          });
          rawWs.on("close", (code, reasonBuffer) => {
            const reasonText =
              typeof reasonBuffer === "string"
                ? reasonBuffer
                : reasonBuffer instanceof Buffer
                  ? reasonBuffer.toString("utf-8")
                  : "";
            console.info("[ngrok-mobile-ws] closed", {
              path: requestPath,
              sessionId,
              code,
              reason: reasonText,
            });
          });
          rawWs.on("error", (error) => {
            console.warn("[ngrok-mobile-ws] socket-error", {
              path: requestPath,
              sessionId,
              message: error instanceof Error ? error.message : String(error),
            });
          });
        },
      };
    }),
  );

  app.post("/_ok/logout", (c) => {
    deleteCookie(c, LOCAL_SESSION_COOKIE, { path: "/" });
    return c.json({ success: true });
  });
}
