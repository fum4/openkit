import { execFileSync } from "child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";
import type { Hono } from "hono";

import { APP_NAME, CONFIG_DIR_NAME } from "../../constants";
import { detectConfig } from "../../shared/detect-config";
import {
  type BranchSource,
  hasCustomBranchNameRule,
  readBranchNameRuleContent,
  wrapWithExportDefault,
} from "../branch-name";
import {
  type CommitMessageSource,
  hasCustomCommitMessageRule,
  readCommitMessageRuleContent,
  wrapWithExportDefault as wrapCommitExportDefault,
} from "../commit-message";
import { isMcpSetupEnabled } from "../feature-flags";
import { enableDefaultProjectSkills } from "../lib/project-skill-bootstrap";
import type { WorktreeManager } from "../manager";

const AGENT_RULE_FILES: Record<string, (dir: string) => string> = {
  "claude-md": (dir) => path.join(dir, "CLAUDE.md"),
  "agents-md": (dir) => path.join(dir, "AGENTS.md"),
};

export function registerConfigRoutes(app: Hono, manager: WorktreeManager) {
  // -- Agent Rules API --

  app.get("/api/agent-rules/:fileId", (c) => {
    const fileId = c.req.param("fileId");
    const resolver = AGENT_RULE_FILES[fileId];
    if (!resolver) return c.json({ error: "Unknown file" }, 404);

    const filePath = resolver(manager.getConfigDir());
    const exists = existsSync(filePath);
    const content = exists ? readFileSync(filePath, "utf-8") : "";
    return c.json({ exists, content });
  });

  app.put("/api/agent-rules/:fileId", async (c) => {
    const fileId = c.req.param("fileId");
    const resolver = AGENT_RULE_FILES[fileId];
    if (!resolver) return c.json({ error: "Unknown file" }, 404);

    try {
      const body = await c.req.json<{ content: string }>();
      const filePath = resolver(manager.getConfigDir());
      const dir = path.dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(filePath, body.content);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save file",
        },
        500,
      );
    }
  });

  app.delete("/api/agent-rules/:fileId", (c) => {
    const fileId = c.req.param("fileId");
    const resolver = AGENT_RULE_FILES[fileId];
    if (!resolver) return c.json({ error: "Unknown file" }, 404);

    const filePath = resolver(manager.getConfigDir());
    if (existsSync(filePath)) unlinkSync(filePath);
    return c.json({ success: true });
  });

  app.get("/api/config", (c) => {
    // Check if config file still exists (user may have deleted .dawg folder)
    const configPath = path.join(manager.getConfigDir(), CONFIG_DIR_NAME, "config.json");
    if (!existsSync(configPath)) {
      return c.json({ config: null, projectName: null });
    }

    const config = manager.getConfig();
    const projectName = manager.getProjectName();
    return c.json({ config, projectName, hasBranchNameRule: true });
  });

  app.get("/api/config/features", (c) => {
    return c.json({
      mcpSetupEnabled: isMcpSetupEnabled(),
    });
  });

  app.patch("/api/config", async (c) => {
    try {
      const body = await c.req.json();
      const result = manager.updateConfig(body);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Invalid request" },
        400,
      );
    }
  });

  app.get("/api/ports", (c) => {
    const portManager = manager.getPortManager();
    return c.json({
      discovered: portManager.getDiscoveredPorts(),
      offsetStep: portManager.getOffsetStep(),
    });
  });

  app.post("/api/discover", async (c) => {
    const portManager = manager.getPortManager();
    const logs: string[] = [];

    const result = await portManager.discoverPorts((message) => {
      logs.push(message);
    });

    return c.json({
      success: result.ports.length > 0,
      ports: result.ports,
      logs,
      error: result.error,
    });
  });

  app.post("/api/detect-env", (c) => {
    const portManager = manager.getPortManager();
    const mapping = portManager.detectEnvMapping(portManager.getProjectDir());
    if (Object.keys(mapping).length > 0) {
      portManager.persistEnvMapping(mapping);
    }

    return c.json({
      success: true,
      envMapping: mapping,
    });
  });

  // Check if .dawg config files need to be committed/pushed
  app.get("/api/config/setup-status", (c) => {
    const projectDir = manager.getConfigDir();
    const configPath = path.join(projectDir, CONFIG_DIR_NAME, "config.json");

    if (!existsSync(configPath)) {
      return c.json({ needsPush: false, files: [] });
    }

    try {
      // Check if file has uncommitted changes (untracked, modified, or staged)
      const statusResult = execFileSync(
        "git",
        [
          "status",
          "--porcelain",
          `${CONFIG_DIR_NAME}/config.json`,
          `${CONFIG_DIR_NAME}/.gitignore`,
        ],
        {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim();

      // If there are any uncommitted changes, needs commit and push
      if (statusResult !== "") {
        return c.json({
          needsPush: true,
          files: [`${CONFIG_DIR_NAME}/config.json`, `${CONFIG_DIR_NAME}/.gitignore`],
        });
      }

      // Files are committed - check if pushed to remote
      // First check if we have an upstream branch
      try {
        execFileSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // No upstream - needs push
        return c.json({
          needsPush: true,
          files: [`${CONFIG_DIR_NAME}/config.json`, `${CONFIG_DIR_NAME}/.gitignore`],
        });
      }

      // Has upstream - check for unpushed commits touching config files
      const unpushedResult = execFileSync(
        "git",
        [
          "log",
          "@{u}..HEAD",
          "--oneline",
          "--",
          `${CONFIG_DIR_NAME}/config.json`,
          `${CONFIG_DIR_NAME}/.gitignore`,
        ],
        {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      ).trim();

      const needsPush = unpushedResult !== "";
      return c.json({
        needsPush,
        files: needsPush ? [".dawg/config.json", ".dawg/.gitignore"] : [],
      });
    } catch {
      return c.json({ needsPush: false, files: [] });
    }
  });

  // Commit and push the .dawg config files
  app.post("/api/config/commit-setup", async (c) => {
    const projectDir = manager.getConfigDir();
    const configPath = path.join(projectDir, CONFIG_DIR_NAME, "config.json");
    const gitignorePath = path.join(projectDir, CONFIG_DIR_NAME, ".gitignore");

    try {
      const body = await c.req.json();
      const message = body.message || `chore: add ${APP_NAME} configuration`;

      // Unstage all currently staged changes first
      try {
        execFileSync("git", ["reset", "HEAD"], {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Ignore errors - may fail if nothing is staged or no commits yet
      }

      // Stage only the config files
      execFileSync("git", ["add", configPath, gitignorePath], {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Check if there are any staged changes
      // git diff --cached --quiet exits with 0 if no changes, 1 if there are changes
      let hasStagedChanges = false;
      try {
        execFileSync("git", ["diff", "--cached", "--quiet"], {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        hasStagedChanges = true;
      }

      if (!hasStagedChanges) {
        // Nothing to commit - files already committed
        return c.json({ success: true, alreadyCommitted: true });
      }

      // Commit
      execFileSync("git", ["commit", "-m", message], {
        cwd: projectDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      });

      // Push
      try {
        execFileSync("git", ["push"], {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Commit succeeded but push failed — still report success
        return c.json({ success: true, pushFailed: true });
      }

      return c.json({ success: true });
    } catch (error) {
      // Extract stderr from execFileSync error for better error messages
      let errorMessage = "Failed to commit";
      if (error && typeof error === "object") {
        const execError = error as { stderr?: Buffer | string; message?: string };
        if (execError.stderr) {
          const stderr =
            typeof execError.stderr === "string" ? execError.stderr : execError.stderr.toString();
          errorMessage = stderr.trim() || execError.message || errorMessage;
        } else if (execError.message) {
          errorMessage = execError.message;
        }
      }
      return c.json({
        success: false,
        error: errorMessage,
      });
    }
  });

  // Get auto-detected config values without creating config
  app.get("/api/config/detect", (c) => {
    const projectDir = manager.getConfigDir();
    try {
      const detected = detectConfig(projectDir);
      return c.json({ success: true, config: detected });
    } catch (error) {
      return c.json({
        success: false,
        error: error instanceof Error ? error.message : "Failed to detect config",
      });
    }
  });

  // Initialize config with provided values (or auto-detected if not provided)
  app.post("/api/config/init", async (c) => {
    const projectDir = manager.getConfigDir();
    const configDirPath = path.join(projectDir, CONFIG_DIR_NAME);
    const configPath = path.join(configDirPath, "config.json");
    const gitignorePath = path.join(configDirPath, ".gitignore");

    try {
      const body = await c.req.json().catch(() => ({}));
      const force = body.force === true;

      // Don't overwrite existing config unless force is set.
      if (existsSync(configPath) && !force) {
        return c.json({ success: false, error: "Config already exists" }, 400);
      }
      const detected = detectConfig(projectDir);

      // Merge provided values with detected values
      const config = {
        startCommand: body.startCommand ?? detected.startCommand,
        installCommand: body.installCommand ?? detected.installCommand,
        baseBranch: body.baseBranch ?? detected.baseBranch,
        projectDir: body.projectDir ?? "",
        autoInstall: body.autoInstall ?? true,
        localIssuePrefix: body.localIssuePrefix ?? "LOCAL",
        localAutoStartClaudeOnNewIssue: body.localAutoStartClaudeOnNewIssue ?? false,
        localAutoStartClaudeSkipPermissions: body.localAutoStartClaudeSkipPermissions ?? true,
        localAutoStartClaudeFocusTerminal: body.localAutoStartClaudeFocusTerminal ?? true,
        envMapping: {},
        ports: {
          discovered: [],
          offsetStep: 1,
        },
      };

      // Create directory if needed
      if (!existsSync(configDirPath)) {
        mkdirSync(configDirPath, { recursive: true });
      }

      // Write config
      writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
      enableDefaultProjectSkills(projectDir);

      // Create .gitignore
      if (!existsSync(gitignorePath)) {
        writeFileSync(
          gitignorePath,
          `# Ignore everything in ${CONFIG_DIR_NAME} by default
*

# Except these files (tracked/shared)
!.gitignore
!config.json
`,
        );
      }

      // Stage the files
      try {
        execFileSync("git", ["add", gitignorePath, configPath], {
          cwd: projectDir,
          encoding: "utf-8",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch {
        // Ignore - user can commit manually
      }

      // Reload the manager's config
      manager.reloadConfig();

      return c.json({ success: true, config });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to initialize config",
        },
        500,
      );
    }
  });

  // Get branch name rule content — optional ?source=jira|linear|local
  app.get("/api/config/branch-name-rule", (c) => {
    const source = c.req.query("source") as BranchSource | undefined;
    const content = readBranchNameRuleContent(manager.getConfigDir(), source);
    const hasOverride = source
      ? hasCustomBranchNameRule(manager.getConfigDir(), source)
      : undefined;
    return c.json({ content, ...(hasOverride !== undefined && { hasOverride }) });
  });

  // Save or delete branch name rule — body: { content, source? }
  app.put("/api/config/branch-name-rule", async (c) => {
    try {
      const body = await c.req.json<{ content?: string | null; source?: BranchSource }>();
      const filename = body.source ? `branch-name.${body.source}.mjs` : "branch-name.mjs";
      const scriptsDir = path.join(manager.getConfigDir(), CONFIG_DIR_NAME, "scripts");
      const rulePath = path.join(scriptsDir, filename);

      if (!body.content?.trim()) {
        // Delete the rule file
        if (existsSync(rulePath)) unlinkSync(rulePath);
        return c.json({ success: true });
      }

      // Ensure scripts directory exists
      if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });

      writeFileSync(rulePath, wrapWithExportDefault(body.content));
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save branch name rule",
        },
        500,
      );
    }
  });

  // Get which per-integration overrides exist
  app.get("/api/config/branch-name-rule/status", (c) => {
    const configDir = manager.getConfigDir();
    return c.json({
      overrides: {
        jira: hasCustomBranchNameRule(configDir, "jira"),
        linear: hasCustomBranchNameRule(configDir, "linear"),
        local: hasCustomBranchNameRule(configDir, "local"),
      },
    });
  });

  // Get commit message rule content — optional ?source=jira|linear|local
  app.get("/api/config/commit-message-rule", (c) => {
    const source = c.req.query("source") as CommitMessageSource | undefined;
    const content = readCommitMessageRuleContent(manager.getConfigDir(), source);
    const hasOverride = source
      ? hasCustomCommitMessageRule(manager.getConfigDir(), source)
      : undefined;
    return c.json({ content, ...(hasOverride !== undefined && { hasOverride }) });
  });

  // Save or delete commit message rule — body: { content, source? }
  app.put("/api/config/commit-message-rule", async (c) => {
    try {
      const body = await c.req.json<{ content?: string | null; source?: CommitMessageSource }>();
      const filename = body.source ? `commit-message.${body.source}.mjs` : "commit-message.mjs";
      const scriptsDir = path.join(manager.getConfigDir(), CONFIG_DIR_NAME, "scripts");
      const rulePath = path.join(scriptsDir, filename);

      if (!body.content?.trim()) {
        if (existsSync(rulePath)) unlinkSync(rulePath);
        return c.json({ success: true });
      }

      if (!existsSync(scriptsDir)) mkdirSync(scriptsDir, { recursive: true });

      writeFileSync(rulePath, wrapCommitExportDefault(body.content));
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to save commit message rule",
        },
        500,
      );
    }
  });

  // Get which per-integration commit message overrides exist
  app.get("/api/config/commit-message-rule/status", (c) => {
    const configDir = manager.getConfigDir();
    return c.json({
      overrides: {
        jira: hasCustomCommitMessageRule(configDir, "jira"),
        linear: hasCustomCommitMessageRule(configDir, "linear"),
        local: hasCustomCommitMessageRule(configDir, "local"),
      },
    });
  });
}
