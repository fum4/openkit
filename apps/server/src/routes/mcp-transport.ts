import type { Hono } from "hono";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import type { WorktreeManager } from "../manager";
import type { NotesManager } from "../notes-manager";
import type { HooksManager } from "../verification-manager";
import type { ActionContext } from "@openkit/agent/actions";
import { createMcpServer } from "../mcp-server-factory";
import { log } from "@openkit/shared/logger";

export function registerMcpTransportRoute(
  app: Hono,
  {
    manager,
    notesManager,
    hooksManager,
  }: { manager: WorktreeManager; notesManager: NotesManager; hooksManager?: HooksManager },
) {
  const activityLog = manager.getActivityLog();
  const ctx: ActionContext = { manager, notesManager, hooksManager, activityLog };
  const mcpServer = createMcpServer(ctx);

  // MCP SDK 1.26+ requires stateless transports to be created per request.
  // We close the previous connection and create a fresh transport for each POST.
  // GET/DELETE return 405 since we use JSON response mode (no SSE needed).
  app.all("/mcp", async (c) => {
    if (c.req.method !== "POST") {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed." },
          id: null,
        }),
        {
          status: 405,
          headers: { Allow: "POST", "Content-Type": "application/json" },
        },
      );
    }

    try {
      // Disconnect previous transport so McpServer.connect() won't throw
      await mcpServer.close();

      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      await mcpServer.connect(transport);
      return await transport.handleRequest(c.req.raw);
    } catch (err) {
      log.error(`MCP transport error: ${err}`);
      return c.json({ error: "MCP transport error" }, 500);
    }
  });
}
