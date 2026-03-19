/**
 * PATH resolution for child processes.
 *
 * Problem: packaged Electron apps inherit a minimal PATH (/usr/bin:/bin:/usr/sbin:/sbin)
 * that doesn't include Homebrew, nvm, fnm, volta, ~/.local/bin, or any other
 * user-configured tool directories. Commands like `pnpm`, `npm`, `node`, etc.
 * fail with exit code 127 ("command not found").
 *
 * Solution: on first use, we spawn the user's login shell to read their full PATH
 * (which includes everything from .zshrc/.bash_profile). The result is cached for
 * the lifetime of the process. If a child process still exits with code 127, callers
 * should call `invalidateShellPath()` to force re-resolution — the user may have
 * installed the missing tool since the last resolution.
 *
 * Usage:
 *   - `withAugmentedPathEnv()` — returns a copy of process.env with the full PATH.
 *     Use this for spawn/execFile `env` options.
 *   - `resolveCommandPath(cmd)` — resolves a bare command name to its absolute path.
 *     Use for execFile where you want early failure if the command doesn't exist.
 *   - `invalidateShellPath()` — resets the cache. Call on exit code 127 before retrying.
 */

import { execFileSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import path from "path";

/**
 * Fallback bin paths used when shell PATH resolution fails.
 * Covers Homebrew (Apple Silicon + Intel), MacPorts, pip/pipx, and system defaults.
 */
const EXTRA_BIN_PATHS = [
  path.join(homedir(), ".local", "bin"),
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/opt/local/bin",
];

/** Cached result from spawning the user's login shell to read $PATH. */
let resolvedShellPath: string | undefined;
let shellPathResolved = false;

function resolveShellPath(): string | undefined {
  if (shellPathResolved) return resolvedShellPath;
  shellPathResolved = true;

  try {
    const shell = process.env.SHELL || "/bin/zsh";
    const result = execFileSync(shell, ["-ilc", "echo -n $PATH"], {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();

    if (result && result.includes("/")) {
      resolvedShellPath = result;
    }
  } catch {
    // Shell resolution failed — fall back to EXTRA_BIN_PATHS only
  }

  return resolvedShellPath;
}

/**
 * Reset the cached shell PATH so the next call to `augmentPath()` /
 * `withAugmentedPathEnv()` re-spawns the user's login shell.
 *
 * Call this after a child process exits with code 127 ("command not found") —
 * the user may have installed the missing tool since the last resolution.
 */
export function invalidateShellPath(): void {
  shellPathResolved = false;
  resolvedShellPath = undefined;
}

export function augmentPath(envPath: string | undefined): string {
  const shellPath = resolveShellPath();

  // Start with the provided PATH
  const parts = (envPath ?? "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set(parts);

  // Merge shell PATH entries (if resolved) — these represent the user's actual
  // environment (nvm, fnm, volta, pyenv, cargo, etc.)
  if (shellPath) {
    for (const entry of shellPath.split(":")) {
      const trimmed = entry.trim();
      if (trimmed && !seen.has(trimmed)) {
        parts.push(trimmed);
        seen.add(trimmed);
      }
    }
  }

  // Always ensure the hardcoded fallbacks are present
  for (const candidate of EXTRA_BIN_PATHS) {
    if (!seen.has(candidate)) {
      parts.push(candidate);
      seen.add(candidate);
    }
  }

  return parts.join(":");
}

export function resolveCommandPath(command: string): string {
  if (command.includes(path.sep)) {
    return command;
  }
  const searchPath = augmentPath(process.env.PATH);
  for (const dir of searchPath.split(":")) {
    const candidate = path.join(dir, command);
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return command;
}

export function isCommandOnPath(command: string): boolean {
  if (command.includes(path.sep)) {
    return existsSync(command);
  }
  return resolveCommandPath(command) !== command;
}

export function withAugmentedPathEnv(env: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: augmentPath(env.PATH),
  };
}
