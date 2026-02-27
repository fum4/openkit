import { execFile, spawn } from "child_process";

import type { Hono } from "hono";

import { checkGhInstalled, configureGitUser } from "@openkit/integrations/github/gh-client";
import type { WorktreeManager } from "../manager";

function runExecFile(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function formatGitHubInstallError(error: unknown): string {
  const detail = error instanceof Error ? error.message : "Failed to install gh";
  if (/spawn brew ENOENT/i.test(detail)) {
    return `Could not install GitHub CLI automatically because Homebrew was not found. Install Homebrew and try again (${detail})`;
  }
  return `Could not install GitHub CLI automatically (${detail})`;
}

function startGhAuthLogin(manager: WorktreeManager): Promise<{ code: string; url: string }> {
  return new Promise((resolve, reject) => {
    // Include 'user' scope to allow fetching the user's email for git config
    const child = spawn(
      "gh",
      ["auth", "login", "--web", "-h", "github.com", "-p", "https", "-s", "user"],
      {
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let output = "";

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
    });

    // Wait briefly for gh to print the code and URL, then parse and open browser
    setTimeout(() => {
      const codeMatch = output.match(/one-time code:\s*(\S+)/);
      const urlMatch = output.match(/(https:\/\/github\.com\/login\/device\S*)/);
      if (urlMatch) {
        execFile("open", [urlMatch[1]]);
        resolve({
          code: codeMatch?.[1] ?? "",
          url: urlMatch[1],
        });
      } else {
        reject(new Error("Could not start GitHub login flow"));
        child.kill();
      }
    }, 2000);

    child.stdin.write("\n");
    child.stdin.end();

    child.on("close", async (exitCode) => {
      if (exitCode === 0) {
        // Configure gh as the git credential helper so git uses the same account
        try {
          await runExecFile("gh", ["auth", "setup-git"]);
        } catch {
          // Ignore errors - not critical
        }
        // Update local git user.name and user.email to match the GitHub account
        try {
          await configureGitUser(manager.getGitRoot());
        } catch {
          // Ignore errors - not critical
        }
        await manager.initGitHub();
      }
    });
  });
}

export function registerGitHubRoutes(app: Hono, manager: WorktreeManager) {
  app.post("/api/github/install", async (c) => {
    try {
      const ghAlreadyInstalled = await checkGhInstalled();
      if (!ghAlreadyInstalled) {
        await runExecFile("brew", ["install", "gh"]);
      }
      await manager.initGitHub();
    } catch (error) {
      return c.json({ success: false, error: formatGitHubInstallError(error) }, 400);
    }
    try {
      const { code } = await startGhAuthLogin(manager);
      return c.json({ success: true, code });
    } catch {
      return c.json({ success: true, code: null });
    }
  });

  app.post("/api/github/login", async (c) => {
    try {
      const { code } = await startGhAuthLogin(manager);
      return c.json({ success: true, code });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to start login" },
        400,
      );
    }
  });

  app.post("/api/github/logout", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    const result = await ghManager.logout();
    return c.json(result, result.success ? 200 : 400);
  });

  app.get("/api/github/status", (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager) {
      return c.json({
        installed: false,
        authenticated: false,
        repo: null,
        hasRemote: false,
        hasCommits: false,
      });
    }
    return c.json(ghManager.getStatus());
  });

  app.post("/api/github/initial-commit", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    const result = await ghManager.createInitialCommit();
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/github/create-repo", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    if (!ghManager.getStatus().authenticated) {
      return c.json({ success: false, error: "Not authenticated with GitHub" }, 400);
    }
    try {
      const body = await c.req.json<{ private?: boolean }>();
      const result = await ghManager.createRepo(body.private ?? true);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to create repository",
        },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/commit", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager?.isAvailable()) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ message: string }>();
      if (!body.message) {
        return c.json({ success: false, error: "Commit message is required" }, 400);
      }
      const worktrees = manager.getWorktrees();
      const wt = worktrees.find((w) => w.id === id);
      if (!wt) {
        return c.json({ success: false, error: `Worktree "${id}" not found` }, 404);
      }
      const result = await ghManager.commitAll(wt.path, id, body.message);
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Commit failed" },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/push", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager?.isAvailable()) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    const id = c.req.param("id");
    const worktrees = manager.getWorktrees();
    const wt = worktrees.find((w) => w.id === id);
    if (!wt) {
      return c.json({ success: false, error: `Worktree "${id}" not found` }, 404);
    }
    const result = await ghManager.pushBranch(wt.path, id);
    return c.json(result, result.success ? 200 : 400);
  });

  app.post("/api/worktrees/:id/create-pr", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager?.isAvailable()) {
      return c.json({ success: false, error: "GitHub integration not available" }, 400);
    }
    try {
      const id = c.req.param("id");
      const body = await c.req.json<{ title: string; body?: string }>();
      if (!body.title) {
        return c.json({ success: false, error: "PR title is required" }, 400);
      }
      const worktrees = manager.getWorktrees();
      const wt = worktrees.find((w) => w.id === id);
      if (!wt) {
        return c.json({ success: false, error: `Worktree "${id}" not found` }, 404);
      }
      const result = await ghManager.createPR(wt.path, id, body.title, body.body);
      return c.json(result, result.success ? 201 : 400);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to create PR" },
        400,
      );
    }
  });
}
