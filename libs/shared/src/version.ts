import { existsSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const FALLBACK_VERSION = "0.0.0";

function readVersionFrom(filePath: string): string | null {
  if (!existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : null;
  } catch {
    return null;
  }
}

function resolveAppVersion(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(dir, "../package.json"),
    path.resolve(dir, "../../package.json"),
  ];

  for (const candidate of candidates) {
    const version = readVersionFrom(candidate);
    if (version) return version;
  }

  return process.env.npm_package_version ?? FALLBACK_VERSION;
}

export const APP_VERSION = resolveAppVersion();
