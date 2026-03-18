/**
 * Server Bridge for Vertical Tests
 *
 * Creates a real Hono server backed by a real WorktreeManager
 * pointing at a temp directory. An MSW handler forwards all
 * /api/* requests to the Hono app via app.fetch().
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";

import { http, type HttpHandler } from "msw";

import { WorktreeManager } from "@openkit/server/manager";
import { createWorktreeServer } from "@openkit/server/index";
import type { WorktreeConfig } from "@openkit/server/types";

// ─── Server bridge factory ────────────────────────────────────

export interface ServerBridge {
  app: { fetch: (req: Request) => Response | Promise<Response> };
  manager: WorktreeManager;
  tempDir: string;
  cleanup: () => void;
}

const DEFAULT_TEST_CONFIG: WorktreeConfig = {
  projectDir: "",
  startCommand: "echo test",
  installCommand: "echo install",
  baseBranch: "main",
  ports: { discovered: [3000], offsetStep: 1 },
};

export function createServerBridge(configOverrides?: Partial<WorktreeConfig>): ServerBridge {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "openkit-test-"));
  const openkitDir = path.join(tempDir, ".openkit");
  mkdirSync(openkitDir, { recursive: true });
  mkdirSync(path.join(openkitDir, "worktrees"), { recursive: true });

  const config: WorktreeConfig = { ...DEFAULT_TEST_CONFIG, ...configOverrides };

  // Write config file so WorktreeManager can find its config dir
  const configFilePath = path.join(openkitDir, "config.json");
  writeFileSync(configFilePath, JSON.stringify(config, null, 2));

  const manager = new WorktreeManager(config, configFilePath);
  const { app } = createWorktreeServer(manager);

  const cleanup = () => {
    try {
      // Dispose activity/ops log timers
      manager.getActivityLog().dispose();
      manager.getOpsLog().dispose();
    } catch {
      // Ignore disposal errors
    }
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  };

  return { app, manager, tempDir, cleanup };
}

// ─── MSW bridge handler ───────────────────────────────────────

export function createBridgeHandler(app: {
  fetch: (req: Request) => Response | Promise<Response>;
}): HttpHandler {
  return http.all("/api/*", async ({ request }) => {
    const url = new URL(request.url);
    const honoUrl = `http://localhost${url.pathname}${url.search}`;

    // Clone the request for Hono with rewritten URL
    const init: RequestInit = {
      method: request.method,
      headers: request.headers,
    };

    // Only include body for methods that support it
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
      // @ts-expect-error -- duplex is needed for streaming body but not in all TS DOM typings
      init.duplex = "half";
    }

    const honoRequest = new Request(honoUrl, init);
    const response = await app.fetch(honoRequest);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
}
