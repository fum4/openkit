import { execFile as execFileCb } from "child_process";
import { promisify } from "util";

import type { GitHubConfig, GitStatusInfo, PRInfo } from "./types";

const execFile = promisify(execFileCb);

export async function checkGhInstalled(): Promise<boolean> {
  try {
    await execFile("which", ["gh"]);
    return true;
  } catch {
    return false;
  }
}

export async function checkGhAuth(): Promise<boolean> {
  try {
    await execFile("gh", ["auth", "status"]);
    return true;
  } catch {
    return false;
  }
}

export async function logoutGh(): Promise<{ success: boolean; error?: string }> {
  // First get the current username to specify in logout
  const username = await getGhUsername();
  if (!username) {
    return { success: false, error: "No user currently logged in" };
  }

  try {
    // Specify both hostname and user to avoid interactive prompt
    await execFile("gh", ["auth", "logout", "-h", "github.com", "-u", username]);
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to logout",
    };
  }
}

export async function getGhUsername(): Promise<string | null> {
  try {
    const { stdout } = await execFile("gh", ["api", "user", "--jq", ".login"], {
      encoding: "utf-8",
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function getGhUserInfo(): Promise<{ name: string | null; email: string | null }> {
  try {
    // Get user info including name
    const { stdout: userInfo } = await execFile(
      "gh",
      ["api", "user", "--jq", "{name: .name, login: .login}"],
      { encoding: "utf-8" },
    );
    const user = JSON.parse(userInfo);

    // Get primary email (requires user:email scope, which gh auth login grants by default)
    let email: string | null = null;
    try {
      const { stdout: emails } = await execFile(
        "gh",
        ["api", "user/emails", "--jq", ".[] | select(.primary) | .email"],
        { encoding: "utf-8" },
      );
      email = emails.trim() || null;
    } catch {
      // Email might not be accessible, fall back to noreply
      email = user.login ? `${user.login}@users.noreply.github.com` : null;
    }

    return {
      name: user.name || user.login || null,
      email,
    };
  } catch {
    return { name: null, email: null };
  }
}

export async function configureGitUser(cwd: string): Promise<void> {
  const userInfo = await getGhUserInfo();

  if (userInfo.email) {
    try {
      await execFile("git", ["config", "user.email", userInfo.email], { cwd, encoding: "utf-8" });
    } catch {
      // Ignore errors
    }
  }

  if (userInfo.name) {
    try {
      await execFile("git", ["config", "user.name", userInfo.name], { cwd, encoding: "utf-8" });
    } catch {
      // Ignore errors
    }
  }
}

export async function getRepoInfo(cwd: string): Promise<GitHubConfig | null> {
  try {
    const { stdout } = await execFile(
      "gh",
      ["repo", "view", "--json", "nameWithOwner,defaultBranchRef"],
      { cwd, encoding: "utf-8" },
    );
    const data = JSON.parse(stdout);
    const [owner, repo] = (data.nameWithOwner as string).split("/");
    const defaultBranch = data.defaultBranchRef?.name || "main";
    return { owner, repo, defaultBranch };
  } catch {
    return null;
  }
}

export async function hasGitRemote(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFile("git", ["remote"], { cwd, encoding: "utf-8" });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function hasGitCommits(cwd: string): Promise<boolean> {
  try {
    await execFile("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

export async function createInitialCommit(
  cwd: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Stage all files
    await execFile("git", ["add", "-A"], { cwd, encoding: "utf-8" });

    // Check if there's anything to commit
    const { stdout: status } = await execFile("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });
    if (!status.trim()) {
      return { success: false, error: "No files to commit" };
    }

    // Create the commit
    await execFile("git", ["commit", "-m", "Initial commit"], { cwd, encoding: "utf-8" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create initial commit",
    };
  }
}

export async function createGitHubRepo(
  cwd: string,
  isPrivate: boolean,
): Promise<{ success: boolean; repo?: string; error?: string }> {
  try {
    const visibility = isPrivate ? "--private" : "--public";

    // Check if there are any commits
    let hasCommits = false;
    try {
      await execFile("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf-8" });
      hasCommits = true;
    } catch {
      // No commits yet
    }

    // Create repo - only push if there are commits
    const args = ["repo", "create", "--source", ".", visibility];
    if (hasCommits) {
      args.push("--push");
    }

    const { stdout } = await execFile("gh", args, { cwd, encoding: "utf-8" });

    // stdout contains the repo URL
    const match = stdout.match(/github\.com\/([^/\s]+\/[^/\s]+)/);
    return { success: true, repo: match?.[1] ?? undefined };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "";

    // If repo already exists, try to link to it instead
    if (errorMsg.includes("Name already exists")) {
      try {
        // Get the GitHub username
        const { stdout: username } = await execFile("gh", ["api", "user", "-q", ".login"], {
          encoding: "utf-8",
        });
        const trimmedUsername = username.trim();

        // Get the directory name as repo name
        const path = await import("path");
        const repoName = path.basename(cwd);
        const repoFullName = `${trimmedUsername}/${repoName}`;

        // Add the existing repo as remote
        try {
          await execFile(
            "git",
            ["remote", "add", "origin", `https://github.com/${repoFullName}.git`],
            { cwd, encoding: "utf-8" },
          );
        } catch {
          // Remote might already exist, try to set the URL instead
          await execFile(
            "git",
            ["remote", "set-url", "origin", `https://github.com/${repoFullName}.git`],
            { cwd, encoding: "utf-8" },
          );
        }

        // Push to the existing repo
        await execFile("git", ["push", "-u", "origin", "HEAD"], { cwd, encoding: "utf-8" });

        return { success: true, repo: repoFullName };
      } catch (linkErr) {
        return {
          success: false,
          error: `Repository "${errorMsg.includes("/") ? errorMsg : "with this name"}" already exists. Failed to link: ${linkErr instanceof Error ? linkErr.message : "Unknown error"}`,
        };
      }
    }

    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create repository",
    };
  }
}

export async function findPRForBranch(
  owner: string,
  repo: string,
  branch: string,
): Promise<PRInfo | null> {
  try {
    const { stdout } = await execFile(
      "gh",
      ["api", `repos/${owner}/${repo}/pulls?head=${owner}:${branch}&state=all&per_page=1`],
      { encoding: "utf-8" },
    );
    const prs = JSON.parse(stdout);
    if (!Array.isArray(prs) || prs.length === 0) return null;
    const pr = prs[0];
    return {
      url: pr.html_url,
      number: pr.number,
      state: pr.state === "closed" && pr.merged_at ? "merged" : pr.state,
      isDraft: pr.draft ?? false,
      title: pr.title,
    };
  } catch {
    return null;
  }
}

export async function getGitStatus(
  worktreePath: string,
  baseBranch?: string,
): Promise<GitStatusInfo> {
  let hasUncommitted = false;
  let ahead = 0;
  let behind = 0;
  let noUpstream = false;
  let aheadOfBase = 0;

  try {
    const { stdout } = await execFile("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    hasUncommitted = stdout.trim().length > 0;
  } catch {
    // Ignore
  }

  try {
    const { stdout } = await execFile(
      "git",
      ["rev-list", "--left-right", "--count", "HEAD...@{upstream}"],
      { cwd: worktreePath, encoding: "utf-8" },
    );
    const parts = stdout.trim().split(/\s+/);
    ahead = parseInt(parts[0], 10) || 0;
    behind = parseInt(parts[1], 10) || 0;
  } catch {
    // No upstream configured — mark as needing push but don't fake commit count
    noUpstream = true;
  }

  // Calculate commits ahead of base branch (for PR eligibility)
  if (baseBranch) {
    try {
      const { stdout } = await execFile(
        "git",
        ["rev-list", "--count", `origin/${baseBranch}..HEAD`],
        { cwd: worktreePath, encoding: "utf-8" },
      );
      aheadOfBase = parseInt(stdout.trim(), 10) || 0;
    } catch {
      // If we can't compare to base, assume there are commits (safer default)
      aheadOfBase = -1;
    }
  }

  return { hasUncommitted, ahead, behind, noUpstream, aheadOfBase };
}

export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFile("git", ["add", "-A"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    await execFile("git", ["commit", "-m", message], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Commit failed",
    };
  }
}

export async function pushBranch(
  worktreePath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFile("git", ["push", "--set-upstream", "origin", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Push failed",
    };
  }
}

export async function createPR(
  worktreePath: string,
  title: string,
  body?: string,
  baseBranch?: string,
): Promise<{ success: boolean; pr?: PRInfo; error?: string }> {
  try {
    const args = ["pr", "create", "--title", title, "--body", body || ""];
    if (baseBranch) args.push("--base", baseBranch);

    const { stdout } = await execFile("gh", args, {
      cwd: worktreePath,
      encoding: "utf-8",
    });

    // gh pr create outputs the PR URL on stdout
    const url = stdout.trim();
    const numberMatch = url.match(/\/pull\/(\d+)/);
    const number = numberMatch ? parseInt(numberMatch[1], 10) : 0;

    return {
      success: true,
      pr: {
        url,
        number,
        state: "OPEN",
        isDraft: false,
        title,
      },
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create PR",
    };
  }
}
