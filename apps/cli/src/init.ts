import { execFileSync } from "child_process";
import { createInterface } from "readline";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import path from "path";

import { APP_NAME } from "@openkit/shared/constants";
import { log } from "@openkit/shared/logger";
import { PortManager } from "@openkit/server/port-manager";
import { enableDefaultProjectSkills } from "@openkit/server/lib/project-skill-bootstrap";
import type { PortConfig, WorktreeConfig } from "@openkit/shared/worktree-types";
import {
  detectDefaultBranch,
  detectInstallCommand,
  detectStartCommand,
} from "@openkit/shared/detect-config";
import { findConfigFile, CONFIG_DIR_NAME, CONFIG_FILE_NAME, type ConfigFile } from "./config";

function prompt(rl: ReturnType<typeof createInterface>, question: string): Promise<string> {
  return new Promise((resolve) => {
    rl.question(question, (answer) => resolve(answer.trim()));
  });
}

/**
 * Auto-initialize config without prompts (for Electron spawned servers)
 */
export async function autoInitConfig(projectDir: string): Promise<void> {
  const resolvedProjectDir = path.resolve(projectDir);

  // Check we're in a git repo
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd: resolvedProjectDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    throw new Error("Not inside a git repository");
  }

  const baseBranch = detectDefaultBranch(resolvedProjectDir);
  const startCommand = detectStartCommand(resolvedProjectDir) || "npm run dev";
  const installCommand = detectInstallCommand(resolvedProjectDir) || "npm install";

  const config: ConfigFile = {
    startCommand,
    installCommand,
    baseBranch,
    ports: {
      discovered: [],
      offsetStep: 1,
    },
  };

  const configDirPath = path.join(resolvedProjectDir, CONFIG_DIR_NAME);
  if (!existsSync(configDirPath)) {
    mkdirSync(configDirPath, { recursive: true });
  }
  const configPath = path.join(configDirPath, CONFIG_FILE_NAME);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  enableDefaultProjectSkills(resolvedProjectDir);

  // Create .gitignore
  const gitignorePath = path.join(configDirPath, ".gitignore");
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

  // Stage the files so they're ready to commit (and will be in worktrees once committed)
  try {
    execFileSync("git", ["add", gitignorePath, configPath], {
      cwd: resolvedProjectDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    // Ignore - user can commit manually
  }

  log.success(`Config auto-initialized at ${configPath}`);
  log.info(
    `Note: Commit ${CONFIG_DIR_NAME}/config.json and ${CONFIG_DIR_NAME}/.gitignore so they're available in worktrees.`,
  );
}

export async function runInit() {
  const existingConfig = findConfigFile();
  if (existingConfig) {
    log.warn(`Config already exists at ${existingConfig}`);
    log.plain("Delete it first if you want to re-initialize.");
    process.exit(1);
  }

  // Check we're in a git repo
  try {
    execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch {
    log.error("Not inside a git repository.");
    process.exit(1);
  }

  log.info("Initializing configuration...\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const projectDir =
    (await prompt(rl, `Project directory (absolute or relative to cwd) [.]: `)) || ".";

  const resolvedProjectDir = path.resolve(process.cwd(), projectDir);

  if (!existsSync(resolvedProjectDir)) {
    log.error(`Directory "${resolvedProjectDir}" does not exist.`);
    rl.close();
    process.exit(1);
  }

  const detectedBranch = detectDefaultBranch(resolvedProjectDir);
  const baseBranch =
    (await prompt(rl, `Base branch for new worktrees [${detectedBranch}]: `)) || detectedBranch;

  const detectedStartCommand = detectStartCommand(resolvedProjectDir);
  let startCommand = "";
  while (!startCommand) {
    startCommand =
      (await prompt(
        rl,
        detectedStartCommand
          ? `Dev start command [${detectedStartCommand}]: `
          : "Dev start command: ",
      )) ||
      detectedStartCommand ||
      "";
    if (!startCommand) console.log("  Start command is required.");
  }

  const detectedInstallCommand = detectInstallCommand(resolvedProjectDir);
  let installCommand = "";
  while (!installCommand) {
    installCommand =
      (await prompt(
        rl,
        detectedInstallCommand
          ? `Install dependencies command [${detectedInstallCommand}]: `
          : "Install dependencies command: ",
      )) ||
      detectedInstallCommand ||
      "";
    if (!installCommand) console.log("  Install command is required.");
  }

  rl.close();

  const config: ConfigFile = {
    startCommand,
    installCommand,
    baseBranch,
    ports: {
      discovered: [],
      offsetStep: 1,
    },
  };

  const configDirPath = path.join(resolvedProjectDir, CONFIG_DIR_NAME);
  if (!existsSync(configDirPath)) {
    mkdirSync(configDirPath, { recursive: true });
  }
  const configPath = path.join(configDirPath, CONFIG_FILE_NAME);
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  enableDefaultProjectSkills(resolvedProjectDir);

  // Create .gitignore to protect local/sensitive files
  // Use whitelist approach: ignore everything except config.json and .gitignore
  const gitignorePath = path.join(configDirPath, ".gitignore");
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
    // Stage the files so they're ready to commit
    try {
      execFileSync("git", ["add", gitignorePath, configPath], {
        cwd: resolvedProjectDir,
        stdio: "pipe",
      });
    } catch {
      // Ignore - user can commit manually
    }
  }

  log.success(`\nConfig written to ${configPath}`);

  // Auto-detect env var mappings if ports are already known
  if (config.ports?.discovered && config.ports.discovered.length > 0) {
    const tempConfig: WorktreeConfig = {
      projectDir: projectDir,
      startCommand,
      installCommand,
      baseBranch,
      ports: config.ports as PortConfig,
    };
    const pm = new PortManager(tempConfig, configPath);
    const envMapping = pm.detectEnvMapping(resolvedProjectDir);
    if (Object.keys(envMapping).length > 0) {
      pm.persistEnvMapping(envMapping);
      console.log("\nFound env var mappings:");
      for (const [key, template] of Object.entries(envMapping)) {
        const original = template.replace(/\$\{(\d+)\}/g, (_, p) => p);
        console.log(`  ${key}=${original} → ${template}`);
      }
      console.log("Saved to config.");
    }
  }

  log.plain("");
  log.plain("Next steps:");
  log.plain(
    `  1. Commit ${CONFIG_DIR_NAME}/config.json and ${CONFIG_DIR_NAME}/.gitignore (staged and ready)`,
  );
  log.plain(`  2. Run \`${APP_NAME}\` to start the manager UI`);
  log.plain('  3. Click "Discover Ports" in the UI to auto-detect all ports');
  log.plain("  4. Create worktrees and start them — ports are offset automatically");
  log.plain("");
}
