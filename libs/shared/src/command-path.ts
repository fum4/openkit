import { existsSync } from "fs";
import path from "path";

const EXTRA_BIN_PATHS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin",
  "/opt/local/bin",
];

export function augmentPath(envPath: string | undefined): string {
  const parts = (envPath ?? "")
    .split(":")
    .map((part) => part.trim())
    .filter(Boolean);
  const seen = new Set(parts);
  for (const candidate of EXTRA_BIN_PATHS) {
    if (seen.has(candidate)) continue;
    parts.push(candidate);
    seen.add(candidate);
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
