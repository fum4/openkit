export type AgentId = "claude" | "codex" | "cursor" | "gemini" | "vscode";
export type McpScope = "global" | "project";

export interface ScopeConfig {
  config: string;
  configPath: string;
}

export interface AgentConfig {
  id: AgentId;
  name: string;
  docsUrl?: string;
  global?: ScopeConfig;
  project?: ScopeConfig;
}

const MCP_JSON_SNIPPET = `{
  "mcpServers": {
    "openkit": {
      "command": "openkit",
      "args": ["mcp"]
    }
  }
}`;

const MCP_TOML_SNIPPET = `[mcp_servers.openkit]\ncommand = "openkit"\nargs = ["mcp"]`;

const MCP_VSCODE_SNIPPET = `{
  "mcp": {
    "servers": {
      "openkit": {
        "command": "openkit",
        "args": ["mcp"]
      }
    }
  }
}`;

export const AGENT_CONFIGS: AgentConfig[] = [
  {
    id: "claude",
    name: "Claude Code",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code",
    global: { config: MCP_JSON_SNIPPET, configPath: "~/.claude/settings.json" },
    project: { config: MCP_JSON_SNIPPET, configPath: ".mcp.json" },
  },
  {
    id: "codex",
    name: "OpenAI Codex",
    docsUrl: "https://developers.openai.com/codex/mcp/",
    global: { config: MCP_TOML_SNIPPET, configPath: "~/.codex/config.toml" },
    project: { config: MCP_TOML_SNIPPET, configPath: ".codex/config.toml" },
  },
  {
    id: "cursor",
    name: "Cursor",
    docsUrl: "https://docs.cursor.com/context/model-context-protocol",
    global: { config: MCP_JSON_SNIPPET, configPath: "~/.cursor/mcp.json" },
    project: { config: MCP_JSON_SNIPPET, configPath: ".cursor/mcp.json" },
  },
  {
    id: "gemini",
    name: "Gemini CLI",
    docsUrl: "https://geminicli.com/docs/tools/mcp-server/",
    global: { config: MCP_JSON_SNIPPET, configPath: "~/.gemini/settings.json" },
    project: { config: MCP_JSON_SNIPPET, configPath: ".gemini/settings.json" },
  },
  {
    id: "vscode",
    name: "VS Code",
    docsUrl: "https://code.visualstudio.com/docs/copilot/chat/mcp-servers",
    global: {
      config: MCP_VSCODE_SNIPPET,
      configPath: "~/Library/Application Support/Code/User/settings.json",
    },
    project: { config: MCP_VSCODE_SNIPPET, configPath: ".vscode/settings.json" },
  },
];
