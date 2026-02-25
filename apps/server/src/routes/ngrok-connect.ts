import { spawn, type ChildProcess } from "child_process";
import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";

import type { WorktreeManager } from "../manager";

const LOCAL_SESSION_COOKIE = "ok_session";

const LOCAL_SESSION_TTL_SEC = 8 * 60 * 60;
const PAIRING_TOKEN_TTL_MS = 90 * 1000;
const PAIRING_RATE_LIMIT_WINDOW_MS = 60 * 1000;
const PAIRING_RATE_LIMIT_MAX_ATTEMPTS = 12;
const PAIRING_RATE_LIMIT_BLOCK_MS = 5 * 60 * 1000;
const NGROK_START_TIMEOUT_MS = 20 * 1000;
const NGROK_PUBLIC_URL_PATTERN = /https:\/\/[a-zA-Z0-9.-]+\.ngrok(?:-free)?\.(?:app|io)/;

type TunnelStatus = "stopped" | "starting" | "running" | "error";

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

interface PairingAttemptBucket {
  windowStartMs: number;
  attempts: number;
  blockedUntilMs: number;
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

function stripPathPrefix(pathname: string, prefix: string): string {
  if (pathname === prefix) return "/";
  if (!pathname.startsWith(prefix)) return "/";
  const rest = pathname.slice(prefix.length);
  if (!rest) return "/";
  return rest.startsWith("/") ? rest : `/${rest}`;
}

function isGatewayProxyPathAllowed(pathname: string): boolean {
  if (pathname === "/api" || pathname.startsWith("/api/")) return true;
  if (pathname === "/mcp") return true;
  return false;
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

export function registerNgrokConnectRoutes(app: Hono, manager: WorktreeManager) {
  const pairingTokens = new Map<string, PendingPairingToken>();
  const pairingAttempts = new Map<string, PairingAttemptBucket>();
  const signingSecret = process.env.OPENKIT_NGROK_SIGNING_SECRET || randomToken(32);

  const currentProjectId = getProjectId(manager.getConfigDir());
  const currentProjectName = manager.getProjectName() ?? currentProjectId;

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
      if (token.usedAt !== null || token.expiresAt <= nowMs) {
        pairingTokens.delete(tokenHash);
      }
    }
  };

  const takePairingToken = (
    token: string,
    expectedProjectId: string,
  ): { ok: true; sessionId: string } | { ok: false } => {
    const tokenHash = hashSha256Hex(token);
    const nowMs = Date.now();
    prunePairingTokens(nowMs);

    const pending = pairingTokens.get(tokenHash);
    if (!pending) return { ok: false };
    if (pending.usedAt !== null) return { ok: false };
    if (pending.expiresAt <= nowMs) {
      pairingTokens.delete(tokenHash);
      return { ok: false };
    }
    if (pending.projectId !== expectedProjectId) return { ok: false };

    pending.usedAt = nowMs;
    pairingTokens.delete(tokenHash);
    return { ok: true, sessionId: pending.id };
  };

  const applyPairingRateLimit = (c: Context): Response | null => {
    const nowMs = Date.now();
    const ip = getClientIp(c);
    const existing = pairingAttempts.get(ip);

    if (existing?.blockedUntilMs && existing.blockedUntilMs > nowMs) {
      return c.json(
        {
          error: {
            code: "pair_rate_limited",
            message: "Pairing temporarily blocked. Try again shortly.",
          },
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
      return c.json(
        {
          error: {
            code: "pair_rate_limited",
            message: "Pairing temporarily blocked. Try again shortly.",
          },
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

  const proxyGatewayRequest = async (
    c: Context,
    session: SignedTokenPayload,
    projectId: string,
    targetPath: string,
  ): Promise<Response> => {
    if (session.projectId !== projectId) {
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

    if (!isGatewayProxyPathAllowed(targetPath)) {
      return c.json(
        {
          error: {
            code: "route_forbidden",
            message: "Target route is not exposed through the gateway.",
          },
        },
        404,
      );
    }

    const method = c.req.method.toUpperCase();
    const body = method === "GET" || method === "HEAD" ? undefined : await c.req.raw.arrayBuffer();
    const reqUrl = new URL(c.req.url);
    const upstreamUrl = new URL(c.req.url);
    upstreamUrl.pathname = targetPath;
    upstreamUrl.search = reqUrl.search;

    const headers = new Headers(c.req.raw.headers);
    headers.delete("cookie");
    headers.delete("host");
    headers.set("x-openkit-user-id", session.userId);
    headers.set("x-openkit-project-id", projectId);
    if (session.email) headers.set("x-openkit-user-email", session.email);

    const proxiedReq = new Request(upstreamUrl.toString(), {
      method,
      headers,
      body,
      redirect: "manual",
    });

    return app.fetch(proxiedReq, c.env, c.executionCtx);
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
      const token = randomToken(24);
      const tokenHash = hashSha256Hex(token);
      const expiresAtMs = Date.now() + PAIRING_TOKEN_TTL_MS;

      pairingTokens.set(tokenHash, {
        id: randomUUID(),
        projectId: currentProjectId,
        expiresAt: expiresAtMs,
        usedAt: null,
      });

      const pairUrl = new URL(`${publicUrl}/_ok/pair`);
      pairUrl.searchParams.set("token", token);
      pairUrl.searchParams.set("next", next || "/");

      return c.json({
        success: true,
        project: {
          id: currentProjectId,
          name: currentProjectName,
        },
        pairUrl: pairUrl.toString(),
        gatewayApiBase: `${publicUrl}/_ok/p/${encodeURIComponent(currentProjectId)}`,
        expiresAt: new Date(expiresAtMs).toISOString(),
        expiresIn: Math.floor(PAIRING_TOKEN_TTL_MS / 1000),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to prepare pairing URL.";
      return c.json({ error: { code: "ngrok_start_failed", message } }, 500);
    }
  });

  app.post("/api/ngrok/pairing/exchange", async (c) => {
    const limited = applyPairingRateLimit(c);
    if (limited) return limited;

    const body = await c.req.json<{ token?: string }>().catch(() => ({ token: undefined }));
    const token = body.token?.trim();
    if (!token) {
      return c.json({ error: { code: "invalid_payload", message: "token is required." } }, 400);
    }

    const consumeResult = takePairingToken(token, currentProjectId);
    if (!consumeResult.ok) {
      return c.json(
        { error: { code: "pair_invalid", message: "Invalid or expired pairing token." } },
        400,
      );
    }

    const nowSec = Math.floor(Date.now() / 1000);
    const sessionJwt = createSignedToken(
      {
        typ: "ok",
        userId: `paired:${consumeResult.sessionId}`,
        projectId: currentProjectId,
        iat: nowSec,
        exp: nowSec + 15 * 60,
      },
      signingSecret,
    );

    return c.json({
      success: true,
      sessionJwt,
      expiresIn: 15 * 60,
      project: {
        id: currentProjectId,
        name: currentProjectName,
      },
    });
  });

  app.get("/_ok/health", (c) => c.json({ ok: true, service: "openkit-gateway" }));

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

    const consumeResult = takePairingToken(token, currentProjectId);
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

  app.all("/_ok/p/:projectId/*", async (c) => {
    const session = parseGatewayAuth(c);
    if (!session) {
      return c.json(
        { error: { code: "unauthenticated", message: "No active local gateway session." } },
        401,
      );
    }

    const projectId = c.req.param("projectId");
    const gatewayPrefix = `/_ok/p/${projectId}`;
    const targetPath = stripPathPrefix(c.req.path, gatewayPrefix);
    return proxyGatewayRequest(c, session, projectId, targetPath);
  });

  app.post("/_ok/logout", (c) => {
    deleteCookie(c, LOCAL_SESSION_COOKIE, { path: "/" });
    return c.json({ success: true });
  });
}
