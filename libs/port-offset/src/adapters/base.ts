import { existsSync, readFileSync } from "fs";
import path from "path";

import { log } from "../logger";
import type { FrameworkDetectionResult, FrameworkId } from "../types";

export abstract class FrameworkAdapter {
  abstract readonly id: FrameworkId;

  /** Check if this adapter applies to the project. Return null if not. */
  abstract detect(projectDir: string): FrameworkDetectionResult | null;

  /** Extra args to append to start command for direct port injection. */
  getStartCommandPortArgs(_startCommand: string, _offsetPort: number): string[] {
    return [];
  }

  /**
   * Reads package.json and returns merged dependencies + devDependencies.
   * Returns null if package.json is missing or malformed.
   */
  protected readProjectDeps(projectDir: string): Record<string, string> | null {
    const pkgPath = path.join(projectDir, "package.json");
    if (!existsSync(pkgPath)) return null;

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      return { ...pkg.dependencies, ...pkg.devDependencies };
    } catch (err) {
      log.debug("Failed to parse package.json for framework detection", {
        domain: "framework-detect",
        projectDir,
        pkgPath,
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  /**
   * Returns --port args for Metro-based frameworks.
   * npm needs `-- --port`; yarn/pnpm/bun/npx use `--port` directly.
   * Returns empty if the command already contains --port.
   */
  protected getMetroPortArgs(startCommand: string, offsetPort: number): string[] {
    const trimmed = startCommand.trim();
    if (trimmed.includes("--port")) return [];

    if (trimmed.startsWith("npm ") && !trimmed.startsWith("npx ")) {
      return ["--", "--port", String(offsetPort)];
    }
    return ["--port", String(offsetPort)];
  }
}
