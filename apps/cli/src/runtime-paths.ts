import path from "path";
import { fileURLToPath } from "url";

const modulePath = fileURLToPath(import.meta.url);
const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : modulePath;
const invokedDir = path.dirname(invokedPath);

const isDevCli = invokedPath.includes(path.join("apps", "cli", "src"));
const isBuiltCli = invokedPath.includes(path.join("apps", "cli", "dist", "cli"));
const isLegacyBuiltCli = invokedPath.includes(path.join("dist", "cli"));
const projectRoot = isDevCli
  ? path.resolve(invokedDir, "..", "..", "..")
  : isBuiltCli
    ? path.resolve(invokedDir, "..", "..", "..", "..")
    : isLegacyBuiltCli
      ? path.resolve(invokedDir, "..", "..")
      : path.resolve(path.dirname(modulePath), "..", "..");

export function getCliDir(): string {
  return invokedDir;
}

export function getProjectRoot(): string {
  return projectRoot;
}

export function isDevCliRuntime(): boolean {
  return isDevCli;
}
