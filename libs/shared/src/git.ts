import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

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

    const gitContent = readFileSync(dotGitPath, "utf-8").trim();
    const gitDirMatch = gitContent.match(/^gitdir: (.+)$/);

    // For worktrees, .git is a file with "gitdir: <path>" pointing to the git dir.
    // For the root repo, .git is a directory — read HEAD directly from it.
    const headRefPath = gitDirMatch
      ? path.join(gitDirMatch[1], "HEAD")
      : path.join(dotGitPath, "HEAD");

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
