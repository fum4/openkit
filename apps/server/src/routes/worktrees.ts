import { execFile as execFileCb } from "child_process";
import type { Hono } from "hono";
import { promisify } from "util";

import type { WorktreeManager } from "../manager";
import type { TerminalManager } from "../terminal-manager";
import type { WorktreeCreateRequest, WorktreeRenameRequest } from "../types";

const execFile = promisify(execFileCb);

type OpenProjectTarget =
  | "file-manager"
  | "cursor"
  | "vscode"
  | "zed"
  | "intellij"
  | "webstorm"
  | "terminal"
  | "warp"
  | "ghostty"
  | "neovim";

const OPEN_TARGET_DISPLAY_ORDER: OpenProjectTarget[] = [
  "file-manager",
  "cursor",
  "vscode",
  "zed",
  "intellij",
  "webstorm",
  "terminal",
  "warp",
  "ghostty",
  "neovim",
];

const OPEN_TARGET_SELECTION_PRIORITY: OpenProjectTarget[] = [
  "cursor",
  "vscode",
  "zed",
  "intellij",
  "webstorm",
  "terminal",
  "warp",
  "ghostty",
  "neovim",
  "file-manager",
];

const OPEN_TARGET_SET = new Set<OpenProjectTarget>(OPEN_TARGET_DISPLAY_ORDER);

const LINUX_TERMINAL_COMMANDS = [
  "gnome-terminal",
  "konsole",
  "xfce4-terminal",
  "kitty",
  "alacritty",
  "ghostty",
  "warp-terminal",
  "x-terminal-emulator",
];

function isOpenProjectTarget(value: string): value is OpenProjectTarget {
  return OPEN_TARGET_SET.has(value as OpenProjectTarget);
}

function escapeShellSingleQuoted(value: string): string {
  return value.replace(/'/g, `'\\''`);
}

function escapeAppleScript(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function getOpenTargetLabel(target: OpenProjectTarget): string {
  switch (target) {
    case "file-manager":
      return process.platform === "darwin" ? "Finder" : "File Manager";
    case "cursor":
      return "Cursor";
    case "vscode":
      return "VS Code";
    case "zed":
      return "Zed";
    case "intellij":
      return "IntelliJ IDEA";
    case "webstorm":
      return "WebStorm";
    case "terminal":
      return "Terminal";
    case "warp":
      return "Warp";
    case "ghostty":
      return "Ghostty";
    case "neovim":
      return "NeoVim";
    default:
      return target;
  }
}

async function commandExists(command: string): Promise<boolean> {
  try {
    await execFile("which", [command], {
      encoding: "utf-8",
      timeout: 2_500,
    });
    return true;
  } catch {
    return false;
  }
}

async function macAppExists(appName: string): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  try {
    await execFile("open", ["-Ra", appName], {
      encoding: "utf-8",
      timeout: 2_500,
    });
    return true;
  } catch {
    return false;
  }
}

async function linuxHasTerminalCommand(): Promise<boolean> {
  for (const command of LINUX_TERMINAL_COMMANDS) {
    if (await commandExists(command)) return true;
  }
  return false;
}

interface OpenCommandCandidate {
  cmd: string;
  args: string[];
}

function getLinuxTerminalOpenCandidates(worktreePath: string): OpenCommandCandidate[] {
  const escapedPath = escapeShellSingleQuoted(worktreePath);
  const userShell = process.env.SHELL || "bash";

  return [
    { cmd: "gnome-terminal", args: ["--working-directory", worktreePath] },
    { cmd: "konsole", args: ["--workdir", worktreePath] },
    { cmd: "xfce4-terminal", args: ["--working-directory", worktreePath] },
    { cmd: "kitty", args: ["--directory", worktreePath] },
    { cmd: "alacritty", args: ["--working-directory", worktreePath] },
    { cmd: "ghostty", args: ["--working-directory", worktreePath] },
    { cmd: "warp-terminal", args: ["--working-directory", worktreePath] },
    {
      cmd: "x-terminal-emulator",
      args: ["-e", "bash", "-lc", `cd '${escapedPath}' && exec ${userShell}`],
    },
  ];
}

function getLinuxNeovimOpenCandidates(worktreePath: string): OpenCommandCandidate[] {
  return [
    { cmd: "gnome-terminal", args: ["--working-directory", worktreePath, "--", "nvim", "."] },
    { cmd: "konsole", args: ["--workdir", worktreePath, "-e", "nvim", "."] },
    { cmd: "xfce4-terminal", args: ["--working-directory", worktreePath, "-x", "nvim", "."] },
    { cmd: "kitty", args: ["--directory", worktreePath, "nvim", "."] },
    { cmd: "alacritty", args: ["--working-directory", worktreePath, "-e", "nvim", "."] },
    { cmd: "ghostty", args: ["--working-directory", worktreePath, "-e", "nvim", "."] },
    { cmd: "x-terminal-emulator", args: ["-e", "nvim", worktreePath] },
  ];
}

function getOpenCommandCandidates(
  target: OpenProjectTarget,
  worktreePath: string,
): OpenCommandCandidate[] {
  if (process.platform === "darwin") {
    switch (target) {
      case "file-manager":
        return [{ cmd: "open", args: [worktreePath] }];
      case "cursor":
        return [
          { cmd: "open", args: ["-a", "Cursor", worktreePath] },
          { cmd: "cursor", args: [worktreePath] },
        ];
      case "vscode":
        return [
          { cmd: "open", args: ["-a", "Visual Studio Code", worktreePath] },
          { cmd: "open", args: ["-a", "Code", worktreePath] },
          { cmd: "code", args: [worktreePath] },
        ];
      case "zed":
        return [
          { cmd: "open", args: ["-a", "Zed", worktreePath] },
          { cmd: "zed", args: [worktreePath] },
        ];
      case "intellij":
        return [
          { cmd: "open", args: ["-a", "IntelliJ IDEA", worktreePath] },
          { cmd: "open", args: ["-a", "IntelliJ IDEA CE", worktreePath] },
          { cmd: "idea", args: [worktreePath] },
        ];
      case "webstorm":
        return [
          { cmd: "open", args: ["-a", "WebStorm", worktreePath] },
          { cmd: "webstorm", args: [worktreePath] },
        ];
      case "terminal":
        return [{ cmd: "open", args: ["-a", "Terminal", worktreePath] }];
      case "warp":
        return [
          { cmd: "open", args: ["-a", "Warp", worktreePath] },
          { cmd: "warp", args: [worktreePath] },
        ];
      case "ghostty":
        return [
          { cmd: "open", args: ["-a", "Ghostty", worktreePath] },
          { cmd: "ghostty", args: ["--working-directory", worktreePath] },
        ];
      case "neovim": {
        const shellCommand = `cd '${escapeShellSingleQuoted(worktreePath)}' && nvim .`;
        const script = `tell application "Terminal"
activate
do script "${escapeAppleScript(shellCommand)}"
end tell`;
        return [{ cmd: "osascript", args: ["-e", script] }];
      }
      default:
        return [];
    }
  }

  if (process.platform === "linux") {
    switch (target) {
      case "file-manager":
        return [{ cmd: "xdg-open", args: [worktreePath] }];
      case "cursor":
        return [{ cmd: "cursor", args: [worktreePath] }];
      case "vscode":
        return [
          { cmd: "code", args: [worktreePath] },
          { cmd: "code-insiders", args: [worktreePath] },
        ];
      case "zed":
        return [{ cmd: "zed", args: [worktreePath] }];
      case "intellij":
        return [
          { cmd: "idea", args: [worktreePath] },
          { cmd: "idea.sh", args: [worktreePath] },
        ];
      case "webstorm":
        return [
          { cmd: "webstorm", args: [worktreePath] },
          { cmd: "webstorm.sh", args: [worktreePath] },
        ];
      case "terminal":
        return getLinuxTerminalOpenCandidates(worktreePath);
      case "warp":
        return [
          { cmd: "warp-terminal", args: ["--working-directory", worktreePath] },
          { cmd: "warp", args: [worktreePath] },
        ];
      case "ghostty":
        return [{ cmd: "ghostty", args: ["--working-directory", worktreePath] }];
      case "neovim":
        return getLinuxNeovimOpenCandidates(worktreePath);
      default:
        return [];
    }
  }

  return [];
}

async function isTargetAvailable(target: OpenProjectTarget): Promise<boolean> {
  if (!["darwin", "linux"].includes(process.platform)) return false;

  if (process.platform === "darwin") {
    switch (target) {
      case "file-manager":
        return true;
      case "cursor":
        return (await macAppExists("Cursor")) || (await commandExists("cursor"));
      case "vscode":
        return (
          (await macAppExists("Visual Studio Code")) ||
          (await macAppExists("Code")) ||
          (await commandExists("code"))
        );
      case "zed":
        return (await macAppExists("Zed")) || (await commandExists("zed"));
      case "intellij":
        return (
          (await macAppExists("IntelliJ IDEA")) ||
          (await macAppExists("IntelliJ IDEA CE")) ||
          (await commandExists("idea"))
        );
      case "webstorm":
        return (await macAppExists("WebStorm")) || (await commandExists("webstorm"));
      case "terminal":
        return await macAppExists("Terminal");
      case "warp":
        return (await macAppExists("Warp")) || (await commandExists("warp"));
      case "ghostty":
        return (await macAppExists("Ghostty")) || (await commandExists("ghostty"));
      case "neovim":
        return (await commandExists("nvim")) && (await macAppExists("Terminal"));
      default:
        return false;
    }
  }

  switch (target) {
    case "file-manager":
      return await commandExists("xdg-open");
    case "cursor":
      return await commandExists("cursor");
    case "vscode":
      return (await commandExists("code")) || (await commandExists("code-insiders"));
    case "zed":
      return await commandExists("zed");
    case "intellij":
      return (await commandExists("idea")) || (await commandExists("idea.sh"));
    case "webstorm":
      return (await commandExists("webstorm")) || (await commandExists("webstorm.sh"));
    case "terminal":
      return await linuxHasTerminalCommand();
    case "warp":
      return (await commandExists("warp-terminal")) || (await commandExists("warp"));
    case "ghostty":
      return await commandExists("ghostty");
    case "neovim":
      return (await commandExists("nvim")) && (await linuxHasTerminalCommand());
    default:
      return false;
  }
}

async function getAvailableOpenTargets(): Promise<
  Array<{ target: OpenProjectTarget; label: string }>
> {
  const targets: Array<{ target: OpenProjectTarget; label: string }> = [];

  for (const target of OPEN_TARGET_DISPLAY_ORDER) {
    if (await isTargetAvailable(target)) {
      targets.push({ target, label: getOpenTargetLabel(target) });
    }
  }

  return targets;
}

function getDefaultOpenTarget(
  targets: Array<{ target: OpenProjectTarget; label: string }>,
): OpenProjectTarget | null {
  const targetSet = new Set(targets.map((target) => target.target));
  for (const target of OPEN_TARGET_SELECTION_PRIORITY) {
    if (targetSet.has(target)) return target;
  }
  return null;
}

async function tryOpenProject(
  target: OpenProjectTarget,
  worktreePath: string,
): Promise<{ success: boolean; error?: string }> {
  const candidates = getOpenCommandCandidates(target, worktreePath);
  if (candidates.length === 0) {
    return {
      success: false,
      error: `Opening worktrees is not supported on ${process.platform}`,
    };
  }

  let lastError: string | null = null;

  for (const { cmd, args } of candidates) {
    try {
      await execFile(cmd, args, {
        encoding: "utf-8",
        timeout: 10_000,
      });
      return { success: true };
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  const targetLabel = getOpenTargetLabel(target);
  return {
    success: false,
    error: `Unable to open in ${targetLabel}. Make sure it is installed and available.${lastError ? ` (${lastError})` : ""}`,
  };
}

export function registerWorktreeRoutes(
  app: Hono,
  manager: WorktreeManager,
  terminalManager?: TerminalManager,
) {
  app.get("/api/worktrees", (c) => {
    const worktrees = manager.getWorktrees();
    return c.json({ worktrees });
  });

  app.post("/api/worktrees", async (c) => {
    try {
      const body = await c.req.json<WorktreeCreateRequest>();

      if (!body.branch) {
        return c.json({ success: false, error: "Branch name is required" }, 400);
      }

      const result = await manager.createWorktree(body);
      return c.json(result, result.success ? 201 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/start", async (c) => {
    const id = c.req.param("id");
    const result = await manager.startWorktree(id);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/worktrees/:id/stop", async (c) => {
    const id = c.req.param("id");
    const result = await manager.stopWorktree(id);
    return c.json(result, result.success ? 200 : 400);
  });

  app.get("/api/worktrees/:id/open-targets", async (c) => {
    const id = c.req.param("id");
    const worktree = manager.getWorktrees().find((w) => w.id === id);
    if (!worktree) {
      return c.json({ success: false, error: `Worktree "${id}" not found` }, 404);
    }

    const targets = await getAvailableOpenTargets();
    const configuredTarget = manager.getConfig().openProjectTarget;
    const availableTargets = new Set(targets.map((target) => target.target));
    const selectedTarget =
      configuredTarget && availableTargets.has(configuredTarget)
        ? configuredTarget
        : getDefaultOpenTarget(targets);

    return c.json({
      success: true,
      targets,
      selectedTarget,
    });
  });

  app.post("/api/worktrees/:id/open", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ target?: string }>();
      const requestedTarget = body.target ?? "file-manager";

      if (!isOpenProjectTarget(requestedTarget)) {
        return c.json(
          {
            success: false,
            error:
              "Invalid open target. Expected one of: file-manager, cursor, vscode, zed, intellij, webstorm, terminal, warp, ghostty, neovim.",
          },
          400,
        );
      }

      const worktree = manager.getWorktrees().find((w) => w.id === id);
      if (!worktree) {
        return c.json({ success: false, error: `Worktree "${id}" not found` }, 404);
      }

      manager.updateConfig({ openProjectTarget: requestedTarget });

      const result = await tryOpenProject(requestedTarget, worktree.path);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        },
        400,
      );
    }
  });

  app.patch("/api/worktrees/:id", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<WorktreeRenameRequest>();
      const result = await manager.renameWorktree(id, body);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        },
        400,
      );
    }
  });

  app.delete("/api/worktrees/:id", async (c) => {
    const id = c.req.param("id");
    terminalManager?.destroyAllForWorktree(id);
    const result = await manager.removeWorktree(id);
    return c.json(result, result.success ? 200 : 400);
  });

  app.get("/api/worktrees/:id/logs", (c) => {
    const id = c.req.param("id");
    const logs = manager.getLogs(id);
    return c.json({ logs });
  });

  app.post("/api/worktrees/:id/recover", async (c) => {
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ action: "reuse" | "recreate"; branch?: string }>();

      if (!body.action || !["reuse", "recreate"].includes(body.action)) {
        return c.json(
          { success: false, error: 'Invalid action. Must be "reuse" or "recreate".' },
          400,
        );
      }

      const result = await manager.recoverWorktree(id, body.action, body.branch);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Invalid request",
        },
        400,
      );
    }
  });

  // Link an existing worktree to an existing issue
  app.patch("/api/worktrees/:id/link", async (c) => {
    const id = c.req.param("id");
    try {
      const { source, issueId } = await c.req.json<{
        source: "jira" | "linear" | "local";
        issueId: string;
      }>();
      if (!source || !issueId) {
        return c.json({ success: false, error: "source and issueId are required" }, 400);
      }
      if (!["jira", "linear", "local"].includes(source)) {
        return c.json({ success: false, error: "source must be jira, linear, or local" }, 400);
      }
      const notesManager = manager.getNotesManager();
      notesManager.setLinkedWorktreeId(source, issueId, id);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to link worktree",
        },
        400,
      );
    }
  });

  // Unlink a worktree from its linked issue
  app.delete("/api/worktrees/:id/link", async (c) => {
    const id = c.req.param("id");
    try {
      const notesManager = manager.getNotesManager();
      const linkMap = notesManager.buildWorktreeLinkMap();
      const linked = linkMap.get(id);
      if (!linked) {
        return c.json({ success: false, error: "Worktree is not linked to any issue" }, 400);
      }
      notesManager.setLinkedWorktreeId(linked.source, linked.issueId, null);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to unlink worktree",
        },
        400,
      );
    }
  });
}
