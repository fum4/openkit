import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  unlinkSync,
} from "fs";
import path from "path";
import os from "os";

/**
 * Try to auto-detect the openkit repository path.
 * @param appPath - hint path from the running app (e.g. devWorkspaceRoot)
 */
export function detectOpenkitRepoPath(appPath?: string): string | null {
  const expectedName = readPackageName(appPath);
  if (!expectedName) return null;

  const candidates = buildCandidates(appPath);

  for (const candidate of candidates) {
    if (readPackageName(candidate) === expectedName) {
      return candidate;
    }
  }

  return null;
}

function buildCandidates(appPath?: string): string[] {
  const home = os.homedir();
  const candidates: string[] = [];

  // Best signal: the app's own workspace root (works in dev mode)
  if (appPath) {
    candidates.push(appPath);
  }

  // Walk up from cwd — often the repo root during development
  let dir = process.cwd();
  for (let i = 0; i < 10; i++) {
    candidates.push(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  // Scan common dev parent directories for any subfolder that is the repo
  const devRoots = [
    path.join(home, "_work"),
    path.join(home, "work"),
    path.join(home, "dev"),
    path.join(home, "projects"),
    path.join(home, "src"),
    path.join(home, "code"),
    path.join(home, "repos"),
  ];

  for (const root of devRoots) {
    if (!existsSync(root)) continue;
    try {
      for (const entry of readdirSync(root, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          candidates.push(path.join(root, entry.name));
        }
      }
    } catch {
      // Permission denied or similar — skip
    }
  }

  return candidates;
}

function readPackageName(dir?: string): string | null {
  if (!dir) return null;
  const pkgPath = path.join(dir, "package.json");
  if (!existsSync(pkgPath)) return null;

  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    return typeof pkg.name === "string" ? pkg.name : null;
  } catch {
    return null;
  }
}

/**
 * Validate that a given path is actually the openkit repo.
 * @param repoPath - path to validate
 * @param appPath - the app's workspace root, used to read the expected package name
 */
export function validateOpenkitRepoPath(repoPath: string, appPath?: string): boolean {
  const expectedName = readPackageName(appPath);
  if (!expectedName) return false;
  return readPackageName(repoPath) === expectedName;
}

/**
 * Create a symlink from the openkit repo's `.openkit/ops-log/<projectName>.jsonl`
 * pointing to the project's `.openkit/ops-log.jsonl`.
 */
export function symlinkOpsLog(projectDir: string, projectName: string, repoPath: string): void {
  const opsLogSource = path.join(projectDir, ".openkit", "ops-log.jsonl");
  const opsLogDir = path.join(repoPath, ".openkit", "ops-log");
  const safeName = projectName.replace(/[^a-zA-Z0-9._-]/g, "-");
  const opsLogLink = path.join(opsLogDir, `${safeName}.jsonl`);

  // Ensure the ops-log directory exists in the openkit repo
  if (!existsSync(opsLogDir)) {
    mkdirSync(opsLogDir, { recursive: true });
  }

  // Remove existing symlink if it points somewhere else or is stale
  try {
    if (lstatSync(opsLogLink).isSymbolicLink() || existsSync(opsLogLink)) {
      unlinkSync(opsLogLink);
    }
  } catch {
    // Path doesn't exist — nothing to remove
  }

  // Only create symlink if the source ops-log exists
  if (!existsSync(opsLogSource)) {
    return;
  }

  symlinkSync(opsLogSource, opsLogLink);
}
