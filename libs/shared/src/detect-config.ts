import { execFileSync } from "child_process";
import { existsSync, readFileSync } from "fs";
import path from "path";

export interface DetectedConfig {
  baseBranch: string;
  startCommand: string;
  installCommand: string;
}

function localBranchExists(projectDir: string, branch: string): boolean {
  try {
    execFileSync("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], {
      encoding: "utf-8",
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

export function detectDefaultBranch(projectDir: string): string {
  // Prefer the local branch corresponding to origin/HEAD.
  try {
    const ref = execFileSync("git", ["symbolic-ref", "refs/remotes/origin/HEAD"], {
      encoding: "utf-8",
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    // ref is like "refs/remotes/origin/main" → extract local branch "main"
    const match = ref.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match?.[1] && localBranchExists(projectDir, match[1])) return match[1];
  } catch {
    // Fall through to local branch checks.
  }

  // Common local defaults.
  for (const branch of ["develop", "main", "master"]) {
    if (localBranchExists(projectDir, branch)) {
      return branch;
    }
  }

  // Use current local branch if available.
  try {
    const current = execFileSync("git", ["branch", "--show-current"], {
      encoding: "utf-8",
      cwd: projectDir,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (current && localBranchExists(projectDir, current)) return current;
  } catch {
    // Ignore and fall back.
  }

  return "main";
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

function isReactNativeProject(projectDir: string): boolean {
  const pkgPath = path.join(projectDir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    return "react-native" in deps || "expo" in deps;
  } catch (err) {
    // libs/shared has no logger — console.warn is acceptable here
    // eslint-disable-next-line no-console
    console.warn(
      `[detect-config] Failed to read ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return false;
  }
}

export function detectStartCommand(projectDir: string): string | null {
  const pm = detectPackageManager(projectDir);
  if (!pm) return null;

  // React Native / Expo projects use "start" (Metro bundler), not "dev"
  if (isReactNativeProject(projectDir)) {
    return pm === "npm" ? "npm start" : `${pm} start`;
  }

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
