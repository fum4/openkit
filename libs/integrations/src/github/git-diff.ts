/**
 * Git diff operations for the diff viewer tab.
 *
 * Provides functions to list changed files and retrieve file content
 * for displaying diffs in the frontend Monaco DiffEditor.
 */
import { execFile as execFileCb } from "child_process";
import { readFile } from "fs/promises";
import { join, resolve, relative } from "path";

import { resolveCommandPath, withAugmentedPathEnv } from "@openkit/shared/command-path";
import type { DiffFileInfo } from "@openkit/shared/worktree-types";

import { log } from "./logger";

/** Maximum file size (1MB) — files larger than this return empty content. */
const MAX_FILE_SIZE = 1_048_576;

/**
 * Validate that a file path is safe: relative, no `..` traversal,
 * and resolves within the worktree directory.
 */
function validateFilePath(worktreePath: string, filePath: string): boolean {
  if (!filePath || filePath.startsWith("/") || filePath.includes("..")) return false;
  const resolved = resolve(worktreePath, filePath);
  const rel = relative(worktreePath, resolved);
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
    let path: string;
    let oldPath: string | undefined;

    switch (statusChar) {
      case "M":
        status = "modified";
        path = parts[1];
        break;
      case "A":
        status = "added";
        path = parts[1];
        break;
      case "D":
        status = "deleted";
        path = parts[1];
        break;
      case "R":
        status = "renamed";
        oldPath = parts[1];
        path = parts[2];
        break;
      default:
        status = "modified";
        path = parts[1];
        break;
    }

    const stats = numstatMap.get(path) ?? numstatMap.get(`${oldPath ?? ""}\t${path}`);

    files.push({
      path,
      ...(oldPath ? { oldPath } : {}),
      status,
      linesAdded: stats?.added ?? 0,
      linesRemoved: stats?.removed ?? 0,
      isBinary: stats?.isBinary ?? false,
    });
  }

  return files;
}

/**
 * Count lines in untracked files by reading them directly.
 */
async function countUntrackedLines(
  worktreePath: string,
  filePaths: string[],
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (filePaths.length === 0) return result;

  for (const filePath of filePaths) {
    try {
      const content = await readFile(join(worktreePath, filePath), "utf-8");
      const count = content.split("\n").length;
      result.set(filePath, count);
    } catch {
      result.set(filePath, 0);
    }
  }
  return result;
}

/**
 * Check whether a ref (e.g. HEAD) exists in the repository.
 */
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
  staged?: boolean,
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
    const fullPath = join(worktreePath, filePath);
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
