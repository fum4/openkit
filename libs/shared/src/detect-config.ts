import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";

export interface DetectedConfig {
  baseBranch: string;
  startCommand: string;
  installCommand: string;
}

export function detectDefaultBranch(projectDir: string): string {
  // Try to detect the default branch from the remote
  try {
    const ref = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      encoding: "utf-8",
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // ref is like "refs/remotes/origin/main" → extract "origin/main"
    const match = ref.match(/^refs\/remotes\/(.+)$/);
    if (match) return match[1];
  } catch {
    // Fallback: check which common branches exist
  }

  for (const branch of ["origin/develop", "origin/main", "origin/master"]) {
    try {
      execFileSync("git", ["rev-parse", "--verify", branch], {
        encoding: "utf-8",
        cwd: projectDir,
        stdio: ["pipe", "pipe", "pipe"],
      });
      return branch;
    } catch {
      // Try next
    }
  }

  return "origin/main";
}

export function detectPackageManager(projectDir: string): string | null {
  if (existsSync(path.join(projectDir, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(path.join(projectDir, "yarn.lock"))) return "yarn";
  if (existsSync(path.join(projectDir, "package-lock.json"))) return "npm";
  if (existsSync(path.join(projectDir, "bun.lockb"))) return "bun";
  return null;
}

export function detectInstallCommand(projectDir: string): string | null {
  const pm = detectPackageManager(projectDir);
  return pm ? `${pm} install` : null;
}

export function detectStartCommand(projectDir: string): string | null {
  const pm = detectPackageManager(projectDir);
  if (!pm) return null;
  // yarn and pnpm can run scripts directly, npm needs "run"
  return pm === "npm" ? "npm run dev" : `${pm} dev`;
}

export function detectConfig(projectDir: string): DetectedConfig {
  return {
    baseBranch: detectDefaultBranch(projectDir),
    startCommand: detectStartCommand(projectDir) || "npm run dev",
    installCommand: detectInstallCommand(projectDir) || "npm install",
  };
}
