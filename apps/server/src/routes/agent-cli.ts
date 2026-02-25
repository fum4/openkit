import { execFile as execFileCb } from "child_process";
import { promisify } from "util";
import type { Hono } from "hono";

const execFile = promisify(execFileCb);

type CodingAgent = "claude" | "codex" | "gemini" | "opencode";

interface AgentCliConfig {
  agent: CodingAgent;
  command: string;
  label: string;
  brewPackages: string[];
}

const AGENT_CLI_CONFIGS: Record<CodingAgent, AgentCliConfig> = {
  claude: {
    agent: "claude",
    command: "claude",
    label: "Claude",
    brewPackages: ["claude"],
  },
  codex: {
    agent: "codex",
    command: "codex",
    label: "Codex",
    brewPackages: ["codex", "openai/codex/codex"],
  },
  gemini: {
    agent: "gemini",
    command: "gemini",
    label: "Gemini CLI",
    brewPackages: ["gemini-cli", "google-gemini/gemini-cli/gemini-cli"],
  },
  opencode: {
    agent: "opencode",
    command: "opencode",
    label: "OpenCode",
    brewPackages: ["opencode", "sst/tap/opencode"],
  },
};

function resolveAgentConfig(raw: string): AgentCliConfig | null {
  return raw in AGENT_CLI_CONFIGS ? AGENT_CLI_CONFIGS[raw as CodingAgent] : null;
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFile("which", [command], { timeout: 5_000 });
    return true;
  } catch {
    return false;
  }
}

async function runBrewInstall(formula: string): Promise<{ success: boolean; error?: string }> {
  try {
    await execFile("brew", ["install", formula], { timeout: 10 * 60_000 });
    return { success: true };
  } catch (error) {
    const err = error as { stderr?: string; stdout?: string; message?: string };
    const detail = err.stderr?.trim() || err.stdout?.trim() || err.message || "brew install failed";
    return { success: false, error: detail };
  }
}

export function registerAgentCliRoutes(app: Hono) {
  app.get("/api/agents/:agent/cli/status", async (c) => {
    const config = resolveAgentConfig(c.req.param("agent"));
    if (!config) {
      return c.json({ success: false, error: "Unknown agent" }, 404);
    }

    const installed = await commandExists(config.command);
    return c.json({
      success: true,
      agent: config.agent,
      label: config.label,
      command: config.command,
      installed,
      brewPackage: config.brewPackages[0],
    });
  });

  app.post("/api/agents/:agent/cli/install", async (c) => {
    const config = resolveAgentConfig(c.req.param("agent"));
    if (!config) {
      return c.json({ success: false, error: "Unknown agent" }, 404);
    }

    const brewInstalled = await commandExists("brew");
    if (!brewInstalled) {
      return c.json(
        {
          success: false,
          error: "Homebrew is not installed. Install Homebrew first, then retry.",
        },
        400,
      );
    }

    if (await commandExists(config.command)) {
      return c.json({
        success: true,
        agent: config.agent,
        label: config.label,
        command: config.command,
        brewPackage: config.brewPackages[0],
      });
    }

    let lastInstallError: string | null = null;
    let installedFormula: string | null = null;
    for (const formula of config.brewPackages) {
      const result = await runBrewInstall(formula);
      if (result.success) {
        installedFormula = formula;
        break;
      }
      lastInstallError = result.error ?? `Failed to install ${formula}`;
    }

    const installed = await commandExists(config.command);
    if (!installed) {
      return c.json(
        {
          success: false,
          error:
            lastInstallError ??
            `Installed package but "${config.command}" command is still unavailable in PATH.`,
        },
        400,
      );
    }

    return c.json({
      success: true,
      agent: config.agent,
      label: config.label,
      command: config.command,
      brewPackage: installedFormula ?? config.brewPackages[0],
    });
  });
}
