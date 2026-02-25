import type { WorktreeInfo } from "@openkit/shared/worktree-types";

import {
  checkGhAuth,
  checkGhInstalled,
  commitAll,
  createGitHubRepo,
  createInitialCommit,
  createPR,
  findPRForBranch,
  getGhUsername,
  getGitStatus,
  getRepoInfo,
  hasGitCommits,
  hasGitRemote,
  logoutGh,
  pushBranch,
} from "./gh-client";
import type { GitHubConfig, GitStatusInfo, PRInfo } from "./types";

export class GitHubManager {
  private config: GitHubConfig | null = null;

  private gitStatusCache: Map<string, GitStatusInfo> = new Map();

  private prCache: Map<string, PRInfo | null> = new Map();

  private gitStatusInterval: ReturnType<typeof setInterval> | null = null;

  private prInterval: ReturnType<typeof setInterval> | null = null;

  private installed = false;

  private authenticated = false;

  private username: string | null = null;

  private hasRemote = false;

  private hasCommits = false;

  private gitRoot: string | null = null;

  async initialize(gitRoot: string): Promise<void> {
    this.gitRoot = gitRoot;
    this.hasCommits = await hasGitCommits(gitRoot);
    this.hasRemote = await hasGitRemote(gitRoot);

    this.installed = await checkGhInstalled();
    if (!this.installed) return;

    this.authenticated = await checkGhAuth();
    if (!this.authenticated) return;

    this.username = await getGhUsername();
    this.config = await getRepoInfo(gitRoot);
  }

  isAvailable(): boolean {
    return this.installed && this.authenticated && this.config !== null;
  }

  getStatus(): {
    installed: boolean;
    authenticated: boolean;
    username: string | null;
    repo: string | null;
    hasRemote: boolean;
    hasCommits: boolean;
  } {
    return {
      installed: this.installed,
      authenticated: this.authenticated,
      username: this.username,
      repo: this.config ? `${this.config.owner}/${this.config.repo}` : null,
      hasRemote: this.hasRemote,
      hasCommits: this.hasCommits,
    };
  }

  async createRepo(
    isPrivate: boolean,
  ): Promise<{ success: boolean; repo?: string; error?: string }> {
    if (!this.gitRoot) {
      return { success: false, error: "Git root not initialized" };
    }
    const result = await createGitHubRepo(this.gitRoot, isPrivate);
    if (result.success) {
      // Re-initialize to pick up the new repo
      this.hasRemote = true;
      this.config = await getRepoInfo(this.gitRoot);
    }
    return result;
  }

  async logout(): Promise<{ success: boolean; error?: string }> {
    const result = await logoutGh();
    if (result.success) {
      this.authenticated = false;
      this.username = null;
      this.config = null;
      this.stopPolling();
    }
    return result;
  }

  async createInitialCommit(): Promise<{ success: boolean; error?: string }> {
    if (!this.gitRoot) {
      return { success: false, error: "Git root not initialized" };
    }
    const result = await createInitialCommit(this.gitRoot);
    if (result.success) {
      this.hasCommits = true;
    }
    return result;
  }

  getDefaultBranch(): string | null {
    return this.config?.defaultBranch ?? null;
  }

  startPolling(getWorktrees: () => WorktreeInfo[], onUpdate: () => void): void {
    if (!this.isAvailable()) return;

    // Git status polling — every 10s
    const pollGitStatus = async () => {
      const worktrees = getWorktrees();
      let changed = false;
      const baseBranch = this.config?.defaultBranch;
      for (const wt of worktrees) {
        if (wt.status === "creating") continue;
        try {
          const status = await getGitStatus(wt.path, baseBranch);
          const prev = this.gitStatusCache.get(wt.id);
          if (
            !prev ||
            prev.hasUncommitted !== status.hasUncommitted ||
            prev.ahead !== status.ahead ||
            prev.behind !== status.behind ||
            prev.noUpstream !== status.noUpstream ||
            prev.aheadOfBase !== status.aheadOfBase
          ) {
            this.gitStatusCache.set(wt.id, status);
            changed = true;
          }
        } catch {
          // Ignore individual failures
        }
      }
      if (changed) onUpdate();
    };

    // PR polling — every 60s
    const pollPRs = async () => {
      if (!this.config) return;
      const worktrees = getWorktrees();
      let changed = false;
      for (const wt of worktrees) {
        if (wt.status === "creating") continue;
        try {
          const pr = await findPRForBranch(this.config.owner, this.config.repo, wt.branch);
          const prev = this.prCache.get(wt.id);
          const prChanged =
            (!prev && pr) ||
            (prev && !pr) ||
            (prev &&
              pr &&
              (prev.url !== pr.url || prev.state !== pr.state || prev.isDraft !== pr.isDraft));
          if (prChanged) {
            this.prCache.set(wt.id, pr);
            changed = true;
          }
        } catch {
          // Ignore individual failures
        }
      }
      if (changed) onUpdate();
    };

    // Initial polls
    pollGitStatus();
    pollPRs();

    this.gitStatusInterval = setInterval(pollGitStatus, 10_000);
    this.prInterval = setInterval(pollPRs, 60_000);
  }

  stopPolling(): void {
    if (this.gitStatusInterval) {
      clearInterval(this.gitStatusInterval);
      this.gitStatusInterval = null;
    }
    if (this.prInterval) {
      clearInterval(this.prInterval);
      this.prInterval = null;
    }
  }

  getCachedGitStatus(id: string): GitStatusInfo | undefined {
    return this.gitStatusCache.get(id);
  }

  getCachedPR(id: string): PRInfo | null | undefined {
    return this.prCache.get(id);
  }

  async commitAll(
    worktreePath: string,
    id: string,
    message: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await commitAll(worktreePath, message);
    if (result.success) {
      // Refresh git status cache
      try {
        this.gitStatusCache.set(id, await getGitStatus(worktreePath, this.config?.defaultBranch));
      } catch {
        // Ignore
      }
    }
    return result;
  }

  async pushBranch(
    worktreePath: string,
    id: string,
  ): Promise<{ success: boolean; error?: string }> {
    const result = await pushBranch(worktreePath);
    if (result.success) {
      // Refresh both caches
      try {
        this.gitStatusCache.set(id, await getGitStatus(worktreePath, this.config?.defaultBranch));
      } catch {
        // Ignore
      }
      if (this.config) {
        // Find the branch for this worktree path
        try {
          const { execFile: execFileCb } = await import("child_process");
          const { promisify } = await import("util");
          const execFile = promisify(execFileCb);
          const { stdout } = await execFile("git", ["branch", "--show-current"], {
            cwd: worktreePath,
            encoding: "utf-8",
          });
          const branch = stdout.trim();
          if (branch) {
            const pr = await findPRForBranch(this.config.owner, this.config.repo, branch);
            this.prCache.set(id, pr);
          }
        } catch {
          // Ignore
        }
      }
    }
    return result;
  }

  async createPR(
    worktreePath: string,
    id: string,
    title: string,
    body?: string,
  ): Promise<{ success: boolean; pr?: PRInfo; error?: string }> {
    const result = await createPR(worktreePath, title, body, this.config?.defaultBranch);
    if (result.success && result.pr) {
      this.prCache.set(id, result.pr);
    }
    return result;
  }
}
