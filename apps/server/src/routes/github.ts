import { execFile, spawn } from "child_process";

import type { Hono } from "hono";

import {
  isCommandOnPath,
  resolveCommandPath,
  withAugmentedPathEnv,
} from "@openkit/shared/command-path";
import {
  stageFiles,
  unstageFiles,
  validatePathsWithinCwd,
  stageAll,
  unstageAll,
  getChangedFiles,
  getFileContent,
} from "@openkit/shared/git";
import { configureGitUser, findPRForBranch } from "@openkit/integrations/github/gh-client";
import { getPrDiffFiles, getPrFileContent } from "@openkit/integrations/github/pr-diff";
import type { DiffFileInfo } from "@openkit/shared/worktree-types";

import type { WorktreeManager } from "../manager";
import { log } from "../logger";

const DEVICE_LOGIN_URL = "https://github.com/login/device";

function runExecFile(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(resolveCommandPath(cmd), args, { env: withAugmentedPathEnv() }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function parseGhLoginOutput(output: string): { code: string; url: string } {
  // Trim ANSI escapes to make matching robust across terminals.
  let normalized = output;
  let ansiStart = normalized.indexOf("\x1b[");
  while (ansiStart !== -1) {
    let ansiEnd = ansiStart + 2;
    while (ansiEnd < normalized.length && /[0-9;]/.test(normalized[ansiEnd])) {
      ansiEnd += 1;
    }
    if (normalized[ansiEnd] === "m") {
      ansiEnd += 1;
    }
    normalized = normalized.slice(0, ansiStart) + normalized.slice(ansiEnd);
    ansiStart = normalized.indexOf("\x1b[");
  }
  const codeMatch =
    normalized.match(/one-time code:\s*([A-Z0-9-]+)/i) ??
    normalized.match(/code:\s*([A-Z0-9-]{4,})/i);
  const urlMatch = normalized.match(/https:\/\/github\.com\/login\/device\S*/i);

  const code = codeMatch?.[1] ?? "";
  const url = urlMatch?.[0] ?? (code ? DEVICE_LOGIN_URL : "");
  return { code, url };
}

function startGhAuthLogin(manager: WorktreeManager): Promise<{ code: string; url: string }> {
  return new Promise((resolve, reject) => {
    // Include 'user' scope to allow fetching the user's email for git config
    const ghCommand = resolveCommandPath("gh");
    const child = spawn(
      ghCommand,
      ["auth", "login", "--web", "-h", "github.com", "-p", "https", "-s", "user"],
      {
        env: withAugmentedPathEnv(),
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let output = "";
    let settled = false;

    const resolveOnce = (value: { code: string; url: string }) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const rejectOnce = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    const tryResolveFromOutput = () => {
      const parsed = parseGhLoginOutput(output);
      if (!parsed.code && !parsed.url) return;
      if (parsed.url) {
        execFile(resolveCommandPath("open"), [parsed.url], { env: withAugmentedPathEnv() }, () => {
          // Best effort only.
        });
      }
      resolveOnce(parsed);
    };

    child.stderr.on("data", (data: Buffer) => {
      output += data.toString();
      tryResolveFromOutput();
    });
    child.stdout.on("data", (data: Buffer) => {
      output += data.toString();
      tryResolveFromOutput();
    });

    // If gh takes longer to print login details, don't fail the API call.
    setTimeout(() => {
      tryResolveFromOutput();
      if (!settled) {
        resolveOnce({ code: "", url: "" });
      }
    }, 2500);

    child.stdin.write("\n");
    child.stdin.end();

    child.on("error", (error) => {
      rejectOnce(error instanceof Error ? error : new Error("Could not start GitHub login flow"));
    });

    child.on("close", async (exitCode) => {
      if (exitCode !== 0 && !settled) {
        const trimmed = output.trim();
        rejectOnce(
          new Error(
            trimmed
              ? `Could not start GitHub login flow: ${trimmed}`
              : "Could not start GitHub login flow",
          ),
        );
        return;
      }

      if (!settled) {
        resolveOnce({ code: "", url: "" });
      }

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
  const toResolutionStatus = (code: string): 404 | 409 => {
    return code === "WORKTREE_ID_AMBIGUOUS" ? 409 : 404;
  };

  app.post("/api/github/install", async (c) => {
    try {
      const ghInstalled = await isCommandOnPath("gh");
      if (!ghInstalled) {
        const brewInstalled = await isCommandOnPath("brew");
        if (!brewInstalled) {
          return c.json(
            {
              success: false,
              error:
                "GitHub CLI is not installed and Homebrew is unavailable. Install gh manually.",
            },
            400,
          );
        }
        await runExecFile("brew", ["install", "gh"]);
      }
      await manager.initGitHub();
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to install gh" },
        400,
      );
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
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      const result = await ghManager.commitAll(
        resolved.worktree.path,
        resolved.worktreeId,
        body.message,
      );
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
    const resolved = manager.resolveWorktree(id);
    if (!resolved.success) {
      return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
    }
    const result = await ghManager.pushBranch(resolved.worktree.path, resolved.worktreeId);
    return c.json(result, result.success ? 200 : 400);
  });

  app.get("/api/worktrees/:id/diff", async (c) => {
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      const includeCommitted = c.req.query("includeCommitted") === "true";
      const baseBranch = manager.getConfig().baseBranch;
      const result = await getChangedFiles(resolved.worktree.path, baseBranch, includeCommitted);
      return c.json({
        success: true,
        files: result.files,
        baseBranch,
        error: result.error,
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          error: error instanceof Error ? error.message : "Failed to get diff",
        },
        400,
      );
    }
  });

  app.get("/api/worktrees/:id/diff/file", async (c) => {
    try {
      const id = c.req.param("id");
      const filePath = c.req.query("path");
      const rawStatus = c.req.query("status") ?? "modified";
      const validStatuses = new Set(["modified", "added", "deleted", "renamed", "untracked"]);
      if (!filePath) {
        return c.json(
          { success: false, oldContent: "", newContent: "", error: "path query param is required" },
          400,
        );
      }
      if (!validStatuses.has(rawStatus)) {
        return c.json(
          { success: false, oldContent: "", newContent: "", error: `Invalid status: ${rawStatus}` },
          400,
        );
      }
      const fileStatus = rawStatus as DiffFileInfo["status"];
      const oldPath = c.req.query("oldPath") || undefined;
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json(
          { success: false, oldContent: "", newContent: "", error: resolved.error },
          toResolutionStatus(resolved.code),
        );
      }
      const includeCommitted = c.req.query("includeCommitted") === "true";
      const baseBranch = manager.getConfig().baseBranch;
      const result = await getFileContent(
        resolved.worktree.path,
        filePath,
        fileStatus,
        baseBranch,
        includeCommitted,
        oldPath,
      );
      return c.json({ success: !result.error, ...result });
    } catch (error) {
      return c.json(
        {
          success: false,
          oldContent: "",
          newContent: "",
          error: error instanceof Error ? error.message : "Failed to get file content",
        },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/stage", async (c) => {
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      const body = await c.req.json<{ paths?: string[] }>();
      const paths = body.paths;
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return c.json({ success: false, error: "paths array is required" }, 400);
      }
      const invalidPath = validatePathsWithinCwd(resolved.worktree.path, paths);
      if (invalidPath) {
        return c.json({ success: false, error: `Invalid path: ${invalidPath}` }, 400);
      }
      await stageFiles(resolved.worktree.path, paths);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to stage files" },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/unstage", async (c) => {
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      const body = await c.req.json<{ paths?: string[] }>();
      const paths = body.paths;
      if (!paths || !Array.isArray(paths) || paths.length === 0) {
        return c.json({ success: false, error: "paths array is required" }, 400);
      }
      const invalidPath = validatePathsWithinCwd(resolved.worktree.path, paths);
      if (invalidPath) {
        return c.json({ success: false, error: `Invalid path: ${invalidPath}` }, 400);
      }
      await unstageFiles(resolved.worktree.path, paths);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to unstage files",
        },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/stage-all", async (c) => {
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      await stageAll(resolved.worktree.path);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to stage all files",
        },
        400,
      );
    }
  });

  app.post("/api/worktrees/:id/unstage-all", async (c) => {
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      await unstageAll(resolved.worktree.path);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : "Failed to unstage all files",
        },
        400,
      );
    }
  });

  app.get("/api/worktrees/:id/pr-diff", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager?.isAvailable()) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          baseSha: "",
          mergeSha: "",
          error: "GitHub integration not available",
        },
        400,
      );
    }
    try {
      const id = c.req.param("id");
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json(
          {
            success: false,
            files: [],
            baseBranch: "",
            baseSha: "",
            mergeSha: "",
            error: resolved.error,
          },
          toResolutionStatus(resolved.code),
        );
      }

      // Get PR number from cache, fall back to live fetch
      let pr = ghManager.getCachedPR(resolved.worktreeId);
      if (pr === undefined) {
        const repoConfig = ghManager.getRepoConfig();
        if (repoConfig) {
          pr = await findPRForBranch(repoConfig.owner, repoConfig.repo, resolved.worktree.branch);
        }
      }
      if (!pr) {
        return c.json(
          {
            success: false,
            files: [],
            baseBranch: "",
            baseSha: "",
            mergeSha: "",
            error: "No PR found for this worktree",
          },
          404,
        );
      }

      const repoConfig = ghManager.getRepoConfig();
      if (!repoConfig) {
        return c.json(
          {
            success: false,
            files: [],
            baseBranch: "",
            baseSha: "",
            mergeSha: "",
            error: "Repository config not available",
          },
          400,
        );
      }

      const result = await getPrDiffFiles(repoConfig.owner, repoConfig.repo, pr.number);

      // Get the local HEAD SHA to detect post-merge commits
      let localHeadSha = "";
      try {
        const { stdout } = await new Promise<{ stdout: string }>((resolve, reject) => {
          execFile(
            "git",
            ["rev-parse", "HEAD"],
            { cwd: resolved.worktree.path, encoding: "utf-8" },
            (err, out) => (err ? reject(err) : resolve({ stdout: String(out ?? "") })),
          );
        });
        localHeadSha = stdout.trim();
      } catch (err) {
        log.warn("Failed to read local HEAD SHA for PR diff", {
          domain: "GitHub",
          worktreeId: resolved.worktreeId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      return c.json({ ...result, localHeadSha }, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          files: [],
          baseBranch: "",
          baseSha: "",
          mergeSha: "",
          error: error instanceof Error ? error.message : "Failed to get PR diff",
        },
        400,
      );
    }
  });

  app.get("/api/worktrees/:id/pr-diff/file", async (c) => {
    const ghManager = manager.getGitHubManager();
    if (!ghManager?.isAvailable()) {
      return c.json(
        {
          success: false,
          oldContent: "",
          newContent: "",
          error: "GitHub integration not available",
        },
        400,
      );
    }
    try {
      const id = c.req.param("id");
      const filePath = c.req.query("path");
      const status = c.req.query("status") ?? "modified";
      const validStatuses = new Set(["modified", "added", "deleted", "renamed"]);
      const baseSha = c.req.query("baseSha");
      const mergeSha = c.req.query("mergeSha");
      const oldPath = c.req.query("oldPath") || undefined;

      if (!filePath) {
        return c.json(
          { success: false, oldContent: "", newContent: "", error: "path query param is required" },
          400,
        );
      }
      if (!baseSha || !mergeSha) {
        return c.json(
          {
            success: false,
            oldContent: "",
            newContent: "",
            error: "baseSha and mergeSha query params are required",
          },
          400,
        );
      }
      if (!validStatuses.has(status)) {
        return c.json(
          {
            success: false,
            oldContent: "",
            newContent: "",
            error: `Invalid status: ${status}`,
          },
          400,
        );
      }

      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json(
          { success: false, oldContent: "", newContent: "", error: resolved.error },
          toResolutionStatus(resolved.code),
        );
      }

      const repoConfig = ghManager.getRepoConfig();
      if (!repoConfig) {
        return c.json(
          {
            success: false,
            oldContent: "",
            newContent: "",
            error: "Repository config not available",
          },
          400,
        );
      }

      const result = await getPrFileContent(
        repoConfig.owner,
        repoConfig.repo,
        filePath,
        status as "modified" | "added" | "deleted" | "renamed",
        baseSha,
        mergeSha,
        oldPath,
      );
      return c.json(result, result.success ? 200 : 400);
    } catch (error) {
      return c.json(
        {
          success: false,
          oldContent: "",
          newContent: "",
          error: error instanceof Error ? error.message : "Failed to get PR file content",
        },
        400,
      );
    }
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
      const resolved = manager.resolveWorktree(id);
      if (!resolved.success) {
        return c.json({ success: false, error: resolved.error }, toResolutionStatus(resolved.code));
      }
      const result = await ghManager.createPR(
        resolved.worktree.path,
        resolved.worktreeId,
        body.title,
        body.body,
      );
      return c.json(result, result.success ? 201 : 400);
    } catch (error) {
      return c.json(
        { success: false, error: error instanceof Error ? error.message : "Failed to create PR" },
        400,
      );
    }
  });
}
