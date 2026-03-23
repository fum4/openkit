import { execFileSync } from "child_process";
import { existsSync, readFileSync, statSync } from "fs";
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
