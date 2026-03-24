/**
 * Git utility functions for repository inspection and worktree operations.
 * Provides sync helpers (branch validation, root detection) and async
 * operations (staging, reverting) used by server route handlers.
 */
import { execFile as execFileCb, execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
import { lstat, readFile, unlink } from "node:fs/promises";
import path from "path";
import { promisify } from "util";

import { resolveCommandPath, withAugmentedPathEnv } from "./command-path";
import { log } from "./logger";
import type { DiffFileInfo, GitStatusInfo } from "./worktree-types";

const execFileAsync = promisify(execFileCb);

export function getGitRoot(cwd: string): string {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd,
    }).trim();
  } catch {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf-8",
      cwd: process.cwd(),
    }).trim();
  }
}

export function getWorktreeBranch(worktreePath: string): string | null {
  try {
    const dotGitPath = path.join(worktreePath, ".git");
    if (!existsSync(dotGitPath)) return null;

    let headRefPath: string;
    if (statSync(dotGitPath).isDirectory()) {
      // Root repo — .git is a directory, HEAD is inside it
      headRefPath = path.join(dotGitPath, "HEAD");
    } else {
      // Worktree — .git is a file with "gitdir: <path>" pointing to the git dir
      const gitContent = readFileSync(dotGitPath, "utf-8").trim();
      const gitDirMatch = gitContent.match(/^gitdir: (.+)$/);
      if (!gitDirMatch) return null;
      const gitDir = path.resolve(worktreePath, gitDirMatch[1]);
      headRefPath = path.join(gitDir, "HEAD");
    }

    if (!existsSync(headRefPath)) return null;

    const headRef = readFileSync(headRefPath, "utf-8").trim();
    const branchMatch = headRef.match(/^ref: refs\/heads\/(.+)$/);

    return branchMatch ? branchMatch[1] : headRef.slice(0, 7);
  } catch {
    return null;
  }
}

export function validateBranchName(branch: string): boolean {
  const validBranchRegex = /^[a-zA-Z0-9][a-zA-Z0-9/_.-]*$/;
  return validBranchRegex.test(branch) && !branch.includes("..");
}

// ---------------------------------------------------------------------------
// Async staging / reverting operations
// ---------------------------------------------------------------------------

/** Stage specific files in the working tree. */
export async function stageFiles(cwd: string, paths: string[]): Promise<void> {
  await execFileAsync("git", ["add", "--", ...paths], { cwd, encoding: "utf-8" });
}

/** Unstage specific files (move from index back to working tree). */
export async function unstageFiles(cwd: string, paths: string[]): Promise<void> {
  await execFileAsync("git", ["restore", "--staged", "--", ...paths], { cwd, encoding: "utf-8" });
}

/** Stage all changes in the working tree. */
export async function stageAll(cwd: string): Promise<void> {
  await execFileAsync("git", ["add", "-A"], { cwd, encoding: "utf-8" });
}

/** Unstage all staged changes. */
export async function unstageAll(cwd: string): Promise<void> {
  await execFileAsync("git", ["reset", "HEAD"], { cwd, encoding: "utf-8" });
}

/**
 * Validate that all paths are relative and resolve within cwd.
 * Returns the first invalid path, or null if all paths are valid.
 */
export function validatePathsWithinCwd(cwd: string, paths: string[]): string | null {
  const resolvedCwd = path.resolve(cwd);
  for (const p of paths) {
    const abs = path.resolve(cwd, p);
    const rel = path.relative(resolvedCwd, abs);
    if (rel.startsWith("..") || !abs.startsWith(resolvedCwd)) {
      return p;
    }
  }
  return null;
}

/**
 * Revert (discard) changes for specific files.
 * For staged files: restores from HEAD to both index and working tree.
 * For unstaged files: restores working tree from index (deletes untracked files).
 * Returns partial failure details if some files couldn't be reverted.
 */
export async function revertFiles(
  cwd: string,
  paths: string[],
  staged: boolean,
): Promise<string[]> {
  // Defense-in-depth: validate paths even if the caller already checked
  const invalidPath = validatePathsWithinCwd(cwd, paths);
  if (invalidPath) {
    return [`${invalidPath}: path traversal not allowed`];
  }

  if (staged) {
    // Batch first — works for all files that exist in HEAD
    try {
      await execFileAsync("git", ["checkout", "HEAD", "--", ...paths], { cwd, encoding: "utf-8" });
      return [];
    } catch {
      // Batch failed — process individually. Newly added files (not in HEAD) need git rm -f.
      const errors: string[] = [];
      for (const p of paths) {
        try {
          await execFileAsync("git", ["checkout", "HEAD", "--", p], { cwd, encoding: "utf-8" });
        } catch {
          try {
            await execFileAsync("git", ["rm", "-f", "--", p], { cwd, encoding: "utf-8" });
          } catch (rmErr) {
            errors.push(`${p}: ${rmErr instanceof Error ? rmErr.message : "failed to revert"}`);
          }
        }
      }
      return errors;
    }
  } else {
    // Batch first — works for tracked modified/deleted files
    try {
      await execFileAsync("git", ["checkout", "--", ...paths], { cwd, encoding: "utf-8" });
      return [];
    } catch {
      // Batch failed — process individually. Untracked files need to be deleted.
      const errors: string[] = [];
      for (const p of paths) {
        try {
          await execFileAsync("git", ["checkout", "--", p], { cwd, encoding: "utf-8" });
        } catch {
          try {
            await unlink(path.join(cwd, p));
          } catch (unlinkErr) {
            errors.push(
              `${p}: ${unlinkErr instanceof Error ? unlinkErr.message : "failed to revert"}`,
            );
          }
        }
      }
      return errors;
    }
  }
}

// ---------------------------------------------------------------------------
// Pure git operations (remote, commit, status, push)
// ---------------------------------------------------------------------------

/** Check whether the repository has at least one configured remote. */
export async function hasGitRemote(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("git", ["remote"], { cwd, encoding: "utf-8" });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/** Check whether the repository has at least one commit. */
export async function hasGitCommits(cwd: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["rev-parse", "--verify", "HEAD"], { cwd, encoding: "utf-8" });
    return true;
  } catch {
    return false;
  }
}

/** Stage all files and create an "Initial commit". */
export async function createInitialCommit(
  cwd: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    // Stage all files
    await execFileAsync("git", ["add", "-A"], { cwd, encoding: "utf-8" });

    // Check if there's anything to commit
    const { stdout: status } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
    });
    if (!status.trim()) {
      return { success: false, error: "No files to commit" };
    }

    // Create the commit
    await execFileAsync("git", ["commit", "-m", "Initial commit"], { cwd, encoding: "utf-8" });
    return { success: true };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create initial commit",
    };
  }
}

/** Collect git status information for a worktree (uncommitted, ahead/behind, diff stats). */
export async function getGitStatus(
  worktreePath: string,
  baseBranch?: string,
): Promise<GitStatusInfo> {
  let hasUncommitted = false;
  let ahead = 0;
  let behind = 0;
  let noUpstream = false;
  let aheadOfBase = 0;
  let linesAdded = 0;
  let linesRemoved = 0;

  try {
    const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    hasUncommitted = stdout.trim().length > 0;
  } catch {
    // Ignore
  }

  try {
    const { stdout } = await execFileAsync(
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
      const { stdout } = await execFileAsync(
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

  // Diff stats for uncommitted changes (staged + unstaged vs HEAD)
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--numstat", "HEAD"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    for (const line of stdout.trim().split("\n")) {
      if (!line) continue;
      const [added, removed] = line.split("\t");
      // Binary files show "-" for both columns
      if (added !== "-") linesAdded += parseInt(added, 10) || 0;
      if (removed !== "-") linesRemoved += parseInt(removed, 10) || 0;
    }
  } catch {
    // Ignore — e.g. no commits yet
  }

  // Include untracked files in diff stats (all lines are additions)
  try {
    const { stdout: lsOut } = await execFileAsync(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      { cwd: worktreePath, encoding: "utf-8" },
    );
    const untrackedFiles = lsOut.trim().split("\n").filter(Boolean);
    if (untrackedFiles.length > 0) {
      const { stdout: wcOut } = await execFileAsync("wc", ["-l", ...untrackedFiles], {
        cwd: worktreePath,
        encoding: "utf-8",
      });
      // wc -l outputs "  <count> <filename>" per file; for multiple files the last line is the total
      const lastLine = wcOut.trim().split("\n").pop()!.trim();
      linesAdded += parseInt(lastLine.split(/\s+/)[0], 10) || 0;
    }
  } catch {
    // Ignore — e.g. no untracked files or wc unavailable
  }

  return { hasUncommitted, ahead, behind, noUpstream, aheadOfBase, linesAdded, linesRemoved };
}

/** Stage all changes and commit with the given message. */
export async function commitAll(
  worktreePath: string,
  message: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["add", "-A"], {
      cwd: worktreePath,
      encoding: "utf-8",
    });
    await execFileAsync("git", ["commit", "-m", message], {
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

/** Push the current branch to origin, setting upstream tracking. */
export async function pushBranch(
  worktreePath: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    await execFileAsync("git", ["push", "--set-upstream", "origin", "HEAD"], {
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

// ---------------------------------------------------------------------------
// Stash operations
// ---------------------------------------------------------------------------

/** Check whether the working tree has uncommitted changes (staged, unstaged, or untracked). */
export async function hasUncommittedChanges(cwd: string): Promise<boolean> {
  const { stdout } = await execFileAsync("git", ["status", "--porcelain"], {
    cwd,
    encoding: "utf-8",
  });
  return stdout.trim().length > 0;
}

/**
 * Stash all changes (including untracked files) with a message.
 * Returns the stash ref (commit SHA) on success, or null if nothing was stashed.
 */
export async function stashPush(cwd: string, message: string): Promise<string | null> {
  const { stdout } = await execFileAsync(
    "git",
    ["stash", "push", "--include-untracked", "-m", message],
    { cwd, encoding: "utf-8" },
  );
  if (stdout.includes("No local changes")) {
    return null;
  }
  const { stdout: refOut } = await execFileAsync(
    "git",
    ["stash", "list", "--max-count=1", "--format=%H"],
    { cwd, encoding: "utf-8" },
  );
  return refOut.trim() || null;
}

/**
 * Apply a stash ref to a working tree.
 * Returns `{ applied: true, hasConflicts }` on success (including partial conflicts),
 * or `{ applied: false, error }` on total failure.
 */
export async function stashApply(
  cwd: string,
  stashRef: string,
): Promise<{ applied: true; hasConflicts: boolean } | { applied: false; error: string }> {
  try {
    await execFileAsync("git", ["stash", "apply", stashRef], { cwd, encoding: "utf-8" });
    return { applied: true, hasConflicts: false };
  } catch (err: unknown) {
    // git stash apply exits non-zero on conflicts, but the changes are still applied.
    // Check both message and stderr — Node's execFile puts the command in message
    // but the actual git output (with "CONFLICT") is in stderr.
    const errObj = err as { message?: string; stderr?: string };
    const combined = `${errObj.message ?? ""} ${errObj.stderr ?? ""}`;
    if (combined.includes("CONFLICT") || combined.includes("conflict")) {
      return { applied: true, hasConflicts: true };
    }
    // Use stderr for a more useful error message when available
    const errorDetail =
      typeof errObj.stderr === "string" && errObj.stderr.trim()
        ? errObj.stderr.trim()
        : (errObj.message ?? String(err));
    return { applied: false, error: errorDetail };
  }
}

/** Drop a stash entry by its commit SHA. Looks up the stash index first since `git stash drop` requires `stash@{N}` syntax. */
export async function stashDrop(cwd: string, stashRef: string): Promise<void> {
  // git stash drop requires stash@{N} syntax — look up index from SHA
  const { stdout } = await execFileAsync("git", ["stash", "list", "--format=%H"], {
    cwd,
    encoding: "utf-8",
  });
  const lines = stdout.trim().split("\n").filter(Boolean);
  const index = lines.indexOf(stashRef);
  if (index === -1) {
    throw new Error(`Stash ref ${stashRef} not found in stash list`);
  }
  await execFileAsync("git", ["stash", "drop", `stash@{${index}}`], { cwd, encoding: "utf-8" });
}

// ---------------------------------------------------------------------------
// Diff operations (changed file lists, file content for diff viewer)
// ---------------------------------------------------------------------------

/** Maximum file size (1MB) — files larger than this return empty content. */
const MAX_FILE_SIZE = 1_048_576;

/**
 * Validate that a file path is safe: relative, no `..` traversal,
 * and resolves within the worktree directory.
 */
function validateFilePath(worktreePath: string, filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || filePath.includes("..")) return false;
  const resolved = path.resolve(worktreePath, filePath);
  const rel = path.relative(worktreePath, resolved);
  return !rel.startsWith("..") && !rel.startsWith("/");
}

/**
 * Run a command via execFile with augmented PATH.
 * Uses the callback form directly to ensure stdout is always a string,
 * avoiding issues with promisify losing the encoding option in bundled contexts.
 */
function execCmd(
  cmd: string,
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      resolveCommandPath(cmd),
      args,
      { cwd, env: withAugmentedPathEnv(process.env), encoding: "utf-8", maxBuffer: MAX_FILE_SIZE },
      (error, stdout, stderr) => {
        if (error) {
          reject(error);
        } else {
          resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
        }
      },
    );
  });
}

/**
 * Parse `git diff --numstat --name-status` output into DiffFileInfo entries.
 *
 * We run two git-diff flavours and merge them:
 * - `--numstat` gives us added/removed line counts (binary files show `-`).
 * - `--name-status` gives us the status letter + optional rename path.
 */
function parseNameStatus(nameStatusOutput: string, numstatOutput: string): DiffFileInfo[] {
  const numstatLines = numstatOutput.trim().split("\n").filter(Boolean);
  const statusLines = nameStatusOutput.trim().split("\n").filter(Boolean);

  const numstatMap = new Map<string, { added: number; removed: number; isBinary: boolean }>();
  for (const line of numstatLines) {
    const parts = line.split("\t");
    if (parts.length < 3) continue;
    const [addedStr, removedStr, ...pathParts] = parts;
    const isBinary = addedStr === "-" && removedStr === "-";
    const filePath = pathParts.join("\t");
    const stats = {
      added: isBinary ? 0 : parseInt(addedStr, 10) || 0,
      removed: isBinary ? 0 : parseInt(removedStr, 10) || 0,
      isBinary,
    };
    numstatMap.set(filePath, stats);
    // Renames use {old => new} format in --numstat (e.g. "src/{old.ts => new.ts}").
    // Also store under the expanded new path so the name-status lookup can find it.
    const renameMatch = filePath.match(/^(.*?)\{.*? => (.*?)\}(.*)$/);
    if (renameMatch) {
      numstatMap.set(renameMatch[1] + renameMatch[2] + renameMatch[3], stats);
    }
  }

  const files: DiffFileInfo[] = [];
  for (const line of statusLines) {
    const parts = line.split("\t");
    if (parts.length < 2) continue;
    const statusChar = parts[0].charAt(0);
    let status: DiffFileInfo["status"];
    let filePath: string;
    let oldPath: string | undefined;

    switch (statusChar) {
      case "M":
        status = "modified";
        filePath = parts[1];
        break;
      case "A":
        status = "added";
        filePath = parts[1];
        break;
      case "D":
        status = "deleted";
        filePath = parts[1];
        break;
      case "R":
        status = "renamed";
        oldPath = parts[1];
        filePath = parts[2];
        break;
      default:
        status = "modified";
        filePath = parts[1];
        break;
    }

    const foundStats = numstatMap.get(filePath) ?? numstatMap.get(`${oldPath ?? ""}\t${filePath}`);

    files.push({
      path: filePath,
      ...(oldPath ? { oldPath } : {}),
      status,
      linesAdded: foundStats?.added ?? 0,
      linesRemoved: foundStats?.removed ?? 0,
      isBinary: foundStats?.isBinary ?? false,
    });
  }

  return files;
}

/** Count lines in untracked files by reading them directly. */
async function countUntrackedLines(
  worktreePath: string,
  filePaths: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (filePaths.length === 0) return result;

  for (const filePath of filePaths) {
    try {
      const fullPath = path.join(worktreePath, filePath);
      const stat = await lstat(fullPath);
      if (stat.isSymbolicLink()) {
        result.set(filePath, 0);
        continue;
      }
      const content = await readFile(fullPath, "utf-8");
      const count = content.split("\n").length;
      result.set(filePath, count);
    } catch {
      result.set(filePath, 0);
    }
  }
  return result;
}

/** Check whether a ref (e.g. HEAD) exists in the repository. */
async function hasRef(worktreePath: string, ref: string): Promise<boolean> {
  try {
    await execCmd("git", ["rev-parse", "--verify", ref], worktreePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize baseBranch — strip `origin/` prefix if already present,
 * so callers can safely prepend `origin/` without double-prefixing.
 */
function normalizeBaseBranch(baseBranch: string): string {
  return baseBranch.startsWith("origin/") ? baseBranch.slice("origin/".length) : baseBranch;
}

/**
 * List all changed files in a worktree.
 *
 * Returns uncommitted changes (working directory + staged vs HEAD) by default.
 * When `includeCommitted` is true, also includes committed changes since the
 * branch diverged from `origin/<baseBranch>`.
 */
export async function getChangedFiles(
  worktreePath: string,
  baseBranch: string,
  includeCommitted: boolean,
): Promise<{ files: DiffFileInfo[]; error?: string }> {
  log.info("getChangedFiles started", {
    domain: "diff",
    worktreePath,
    baseBranch,
    includeCommitted,
  });

  const headExists = await hasRef(worktreePath, "HEAD");
  if (!headExists) {
    log.warn("No commits yet — returning empty file list", { domain: "diff", worktreePath });
    return { files: [] };
  }

  const filesByPath = new Map<string, DiffFileInfo>();
  const errors: string[] = [];

  if (!includeCommitted) {
    // 1a. Staged changes (index vs HEAD)
    try {
      const [nameStatusResult, numstatResult] = await Promise.all([
        execCmd("git", ["diff", "--name-status", "--cached"], worktreePath),
        execCmd("git", ["diff", "--numstat", "--cached"], worktreePath),
      ]);
      const staged = parseNameStatus(nameStatusResult.stdout, numstatResult.stdout);
      for (const file of staged) {
        file.staged = true;
        filesByPath.set(`staged:${file.path}`, file);
      }
    } catch (err) {
      log.warn("Failed to get staged changes", { domain: "diff", error: err, worktreePath });
      errors.push(`staged: ${err instanceof Error ? err.message : String(err)}`);
    }

    // 1b. Unstaged changes (working tree vs index)
    try {
      const [nameStatusResult, numstatResult] = await Promise.all([
        execCmd("git", ["diff", "--name-status"], worktreePath),
        execCmd("git", ["diff", "--numstat"], worktreePath),
      ]);
      const unstaged = parseNameStatus(nameStatusResult.stdout, numstatResult.stdout);
      for (const file of unstaged) {
        file.staged = false;
        filesByPath.set(`unstaged:${file.path}`, file);
      }
    } catch (err) {
      log.warn("Failed to get unstaged changes", { domain: "diff", error: err, worktreePath });
      errors.push(`unstaged: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else {
    // When includeCommitted is true, diff the working tree against origin/baseBranch
    // (a single consistent base for both committed and uncommitted changes).
    const baseRef = `origin/${normalizeBaseBranch(baseBranch)}`;
    const useBaseRef = await hasRef(worktreePath, baseRef);
    const effectiveRef = useBaseRef ? baseRef : "HEAD";

    // 1. Tracked changes (working tree vs effectiveRef)
    try {
      const [nameStatusResult, numstatResult] = await Promise.all([
        execCmd("git", ["diff", "--name-status", effectiveRef], worktreePath),
        execCmd("git", ["diff", "--numstat", effectiveRef], worktreePath),
      ]);

      const tracked = parseNameStatus(nameStatusResult.stdout, numstatResult.stdout);
      for (const file of tracked) {
        filesByPath.set(file.path, file);
      }
    } catch (err) {
      log.warn("Failed to get tracked changes", { domain: "diff", error: err, worktreePath });
      errors.push(`tracked: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 2. Untracked files
  try {
    const { stdout } = await execCmd(
      "git",
      ["ls-files", "--others", "--exclude-standard"],
      worktreePath,
    );
    const untrackedPaths = stdout.trim().split("\n").filter(Boolean);
    if (untrackedPaths.length > 0) {
      const lineCounts = await countUntrackedLines(worktreePath, untrackedPaths);
      for (const filePath of untrackedPaths) {
        const mapKey = includeCommitted ? filePath : `unstaged:${filePath}`;
        if (!filesByPath.has(mapKey)) {
          filesByPath.set(mapKey, {
            path: filePath,
            status: "untracked",
            linesAdded: lineCounts.get(filePath) ?? 0,
            linesRemoved: 0,
            isBinary: false,
            ...(includeCommitted ? {} : { staged: false }),
          });
        }
      }
    }
  } catch (err) {
    log.warn("Failed to list untracked files", { domain: "diff", error: err, worktreePath });
    errors.push(`untracked: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Sort: staged files first (when in staging mode), then by status, then alphabetically
  const statusOrder: Record<DiffFileInfo["status"], number> = {
    modified: 0,
    added: 1,
    deleted: 2,
    renamed: 3,
    untracked: 4,
  };
  const files = [...filesByPath.values()].sort((a, b) => {
    // Staged files first when in staging mode
    if (a.staged !== undefined && b.staged !== undefined && a.staged !== b.staged) {
      return a.staged ? -1 : 1;
    }
    const orderDiff = statusOrder[a.status] - statusOrder[b.status];
    if (orderDiff !== 0) return orderDiff;
    return a.path.localeCompare(b.path);
  });

  log.info("getChangedFiles completed", {
    domain: "diff",
    fileCount: files.length,
    errors: errors.length > 0 ? errors : undefined,
  });

  return { files, error: errors.length > 0 ? errors.join("; ") : undefined };
}

/**
 * Retrieve original and modified content for a single file.
 *
 * The `ref` used for the "original" side is HEAD for uncommitted changes,
 * or `origin/<baseBranch>` when `includeCommitted` is true.
 */
export async function getFileContent(
  worktreePath: string,
  filePath: string,
  fileStatus: DiffFileInfo["status"],
  baseBranch: string,
  includeCommitted: boolean,
  oldPath?: string,
): Promise<{ oldContent: string; newContent: string; error?: string }> {
  log.debug("getFileContent started", {
    domain: "diff",
    filePath,
    fileStatus,
    includeCommitted,
  });

  if (!validateFilePath(worktreePath, filePath)) {
    return { oldContent: "", newContent: "", error: "Invalid file path" };
  }
  if (oldPath && !validateFilePath(worktreePath, oldPath)) {
    return { oldContent: "", newContent: "", error: "Invalid old file path" };
  }

  // Use base branch ref when showing committed changes; fall back to HEAD if it doesn't exist
  let ref = "HEAD";
  if (includeCommitted) {
    const baseRef = `origin/${normalizeBaseBranch(baseBranch)}`;
    if (await hasRef(worktreePath, baseRef)) {
      ref = baseRef;
    }
  }

  try {
    let oldContent = "";
    let newContent = "";

    switch (fileStatus) {
      case "modified": {
        const [old, current] = await Promise.all([
          gitShow(worktreePath, ref, filePath),
          readWorkingCopy(worktreePath, filePath),
        ]);
        oldContent = old;
        newContent = current;
        break;
      }
      case "added":
      case "untracked": {
        newContent = await readWorkingCopy(worktreePath, filePath);
        break;
      }
      case "deleted": {
        oldContent = await gitShow(worktreePath, ref, filePath);
        break;
      }
      case "renamed": {
        const [old, current] = await Promise.all([
          gitShow(worktreePath, ref, oldPath ?? filePath),
          readWorkingCopy(worktreePath, filePath),
        ]);
        oldContent = old;
        newContent = current;
        break;
      }
    }

    return { oldContent, newContent };
  } catch (err) {
    log.error("getFileContent failed", { domain: "diff", filePath, error: err });
    return {
      oldContent: "",
      newContent: "",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Retrieve file content from a git ref (e.g. HEAD, origin/main).
 * Returns empty string for files that don't exist at the given ref
 * (e.g. newly added files). Propagates other errors.
 */
async function gitShow(worktreePath: string, ref: string, filePath: string): Promise<string> {
  try {
    const { stdout } = await execCmd("git", ["show", `${ref}:${filePath}`], worktreePath);
    return stdout;
  } catch (err) {
    // "does not exist" / "exists on disk, but not in" are expected for new/deleted files
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("does not exist") || msg.includes("exists on disk")) {
      return "";
    }
    log.warn("gitShow failed", { domain: "diff", ref, filePath, error: err });
    return "";
  }
}

/**
 * Read the working copy of a file from disk, capped at MAX_FILE_SIZE.
 * Returns empty string for files that no longer exist on disk (deleted files).
 * Propagates other errors.
 */
async function readWorkingCopy(worktreePath: string, filePath: string): Promise<string> {
  try {
    const fullPath = path.join(worktreePath, filePath);
    const stat = await lstat(fullPath);
    if (stat.isSymbolicLink()) {
      log.warn("Skipping symlink in readWorkingCopy", { domain: "diff", filePath });
      return "";
    }
    const content = await readFile(fullPath, "utf-8");
    if (content.length > MAX_FILE_SIZE) {
      log.warn("File exceeds size limit, returning empty content", {
        domain: "diff",
        filePath,
        size: content.length,
        limit: MAX_FILE_SIZE,
      });
      return "";
    }
    return content;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return ""; // Deleted file — expected
    }
    log.warn("readWorkingCopy failed", { domain: "diff", filePath, error: err });
    return "";
  }
}
