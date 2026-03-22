/**
 * Functions for fetching PR file lists and file content from GitHub's API via the `gh` CLI.
 * Supports fetching diff metadata and base64-decoded file content for merged PRs.
 */
import { execFile as execFileCb } from "child_process";

import { resolveCommandPath, withAugmentedPathEnv } from "@openkit/shared/command-path";
import type {
  DiffFileContentResponse,
  DiffFileInfo,
  PrDiffListResponse,
} from "@openkit/shared/worktree-types";

import { log } from "./logger";

/**
 * Run a gh CLI command via the raw callback form of execFile to ensure
 * stdout is always a string, matching the same mock-safe pattern used in git-diff.ts.
 */
function execGh(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFileCb(
      resolveCommandPath("gh"),
      args,
      { env: withAugmentedPathEnv(process.env), encoding: "utf-8" },
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

function mapGitHubStatus(status: string): "modified" | "added" | "deleted" | "renamed" {
  switch (status) {
    case "added":
      return "added";
    case "removed":
      return "deleted";
    case "renamed":
      return "renamed";
    case "copied":
      return "added";
    case "modified":
    case "changed":
    default:
      return "modified";
  }
}

interface GitHubPRFile {
  filename: string;
  previous_filename?: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch?: string;
}

interface GitHubContentsResponse {
  content: string;
  encoding: string;
}

/**
 * Fetches the list of files changed in a merged PR, including diff metadata.
 */
export async function getPrDiffFiles(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<Omit<PrDiffListResponse, "localHeadSha">> {
  log.info("Fetching PR diff files", {
    domain: "diff",
    owner,
    repo,
    prNumber,
  });

  try {
    // Fetch PR metadata to get base SHA and merge commit SHA
    const { stdout: metaOut } = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}`,
      "--jq",
      "{base_sha: .base.sha, base_ref: .base.ref, merge_commit_sha: .merge_commit_sha, head_sha: .head.sha}",
    ]);

    const meta = JSON.parse(metaOut.trim()) as {
      base_sha: string;
      base_ref: string;
      merge_commit_sha: string | null;
      head_sha: string;
    };

    if (!meta.merge_commit_sha) {
      log.error("PR has no merge_commit_sha — not yet merged", {
        domain: "diff",
        owner,
        repo,
        prNumber,
      });
      return {
        success: false,
        files: [],
        baseBranch: meta.base_ref ?? "",
        baseSha: meta.base_sha ?? "",
        mergeSha: "",
        headSha: meta.head_sha ?? "",
        error: "PR has not been merged yet",
      };
    }

    // Fetch PR files list
    const { stdout: filesOut } = await execGh([
      "api",
      `repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=100`,
    ]);

    const ghFiles = JSON.parse(filesOut.trim()) as GitHubPRFile[];

    const files: DiffFileInfo[] = ghFiles.map((f) => {
      const isBinary = !("patch" in f) && f.changes === 0;
      const mapped: DiffFileInfo = {
        path: f.filename,
        status: mapGitHubStatus(f.status),
        linesAdded: isBinary ? 0 : f.additions,
        linesRemoved: isBinary ? 0 : f.deletions,
        isBinary,
      };
      if (f.previous_filename) {
        mapped.oldPath = f.previous_filename;
      }
      return mapped;
    });

    log.info("Fetched PR diff files successfully", {
      domain: "diff",
      owner,
      repo,
      prNumber,
      fileCount: files.length,
    });

    return {
      success: true,
      files,
      baseBranch: meta.base_ref,
      baseSha: meta.base_sha,
      mergeSha: meta.merge_commit_sha,
      headSha: meta.head_sha,
    };
  } catch (err) {
    log.error("Failed to fetch PR diff files", {
      domain: "diff",
      owner,
      repo,
      prNumber,
      error: err instanceof Error ? err.message : String(err),
    });
    return {
      success: false,
      files: [],
      baseBranch: "",
      baseSha: "",
      mergeSha: "",
      headSha: "",
      error: err instanceof Error ? err.message : "Failed to fetch PR diff files",
    };
  }
}

/**
 * Fetches the old and new content of a file from a PR, decoding base64 from GitHub's contents API.
 */
export async function getPrFileContent(
  owner: string,
  repo: string,
  filePath: string,
  status: DiffFileInfo["status"],
  baseSha: string,
  mergeSha: string,
  oldPath?: string,
): Promise<DiffFileContentResponse> {
  log.info("Fetching PR file content", {
    domain: "diff",
    owner,
    repo,
    filePath,
    status,
  });

  let oldContent = "";
  let newContent = "";

  // For non-added files, fetch old content at baseSha
  if (status !== "added") {
    const fetchPath = status === "renamed" && oldPath ? oldPath : filePath;
    try {
      const { stdout } = await execGh([
        "api",
        `repos/${owner}/${repo}/contents/${fetchPath}?ref=${baseSha}`,
      ]);
      const response = JSON.parse(stdout.trim()) as GitHubContentsResponse;
      oldContent = Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf-8");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes("403") ||
        errMsg.toLowerCase().includes("too large") ||
        errMsg.includes("1 MB")
      ) {
        log.warn("File too large to fetch old content", {
          domain: "diff",
          owner,
          repo,
          filePath: fetchPath,
          baseSha,
        });
        return {
          success: true,
          oldContent: "",
          newContent: "",
          error: "File too large to display",
        };
      }
      log.error("Failed to fetch old file content", {
        domain: "diff",
        owner,
        repo,
        filePath: fetchPath,
        baseSha,
        error: errMsg,
      });
    }
  }

  // For non-deleted files, fetch new content at mergeSha
  if (status !== "deleted") {
    try {
      const { stdout } = await execGh([
        "api",
        `repos/${owner}/${repo}/contents/${filePath}?ref=${mergeSha}`,
      ]);
      const response = JSON.parse(stdout.trim()) as GitHubContentsResponse;
      newContent = Buffer.from(response.content.replace(/\n/g, ""), "base64").toString("utf-8");
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (
        errMsg.includes("403") ||
        errMsg.toLowerCase().includes("too large") ||
        errMsg.includes("1 MB")
      ) {
        log.warn("File too large to fetch new content", {
          domain: "diff",
          owner,
          repo,
          filePath,
          mergeSha,
        });
        return {
          success: true,
          oldContent: "",
          newContent: "",
          error: "File too large to display",
        };
      }
      log.error("Failed to fetch new file content", {
        domain: "diff",
        owner,
        repo,
        filePath,
        mergeSha,
        error: errMsg,
      });
    }
  }

  log.info("Fetched PR file content successfully", {
    domain: "diff",
    owner,
    repo,
    filePath,
    status,
  });

  return { success: true, oldContent, newContent };
}
