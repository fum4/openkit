# MCP Integration

## What is MCP?

[Model Context Protocol](https://modelcontextprotocol.io/) (MCP) is an open standard for connecting AI agents to external tools and data sources. It defines a JSON-RPC-based protocol that allows agents (like Claude Code, Cursor, or any MCP-compatible client) to discover and invoke tools exposed by a server.

## OpenKit's Own MCP Server (Removed)

OpenKit previously exposed its worktree management surface as an MCP server via the `openkit mcp` CLI command and the `/mcp` HTTP transport endpoint. This has been removed from the codebase.

**What was removed:**

- The `openkit mcp` CLI command (stdio proxy and standalone modes)
- The `/mcp` Streamable HTTP transport endpoint
- The `/api/mcp/status`, `/api/mcp/setup`, `/api/mcp/remove` setup routes
- The `/api/config/features` endpoint (only returned `mcpSetupEnabled`)
- The `OPENKIT_ENABLE_MCP_SETUP` environment variable
- The `@modelcontextprotocol/sdk` dependency
- MCP tool definitions (`libs/agents/src/actions.ts`) and MCP server factory (`apps/server/src/mcp-server-factory.ts`)

**What replaced it:**

Agent integration is now handled through the **skills API** and the `work-on-task` skill deployed to per-agent project skill directories. See [Skills Management](./AGENTS.md#skills-management) in the Agents doc for details.

## Third-Party MCP Server Management (Active)

OpenKit still maintains a central registry for managing third-party MCP servers and deploying them to supported agents. This functionality is fully active.

For documentation on:

- **MCP server registry** (`~/.openkit/mcp-servers.json`)
- **Per-project environment variable overrides** (`.openkit/mcp-env.json`)
- **Deployment to agents** (Claude Code, Cursor, Gemini CLI, VS Code, Codex)
- **Scanning and discovery**
- **API endpoints** (`/api/mcp-servers/*`, `/api/mcp-env/*`)

See [MCP Server Management](./AGENTS.md#mcp-server-management) and the [API Reference](./API.md#mcp-servers-registry) sections.
