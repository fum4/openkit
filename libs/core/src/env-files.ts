import { copyFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import { log } from "@openkit/shared/logger";

export function copyEnvFiles(sourceDir: string, targetDir: string, worktreesDir: string): void {
  const copyEnvRecursive = (src: string, dest: string, relPath = "") => {
    try {
      const entries = readdirSync(src, { withFileTypes: true });
      for (const entry of entries) {
        const srcPath = path.join(src, entry.name);
        const destPath = path.join(dest, entry.name);
        const displayPath = relPath ? `${relPath}/${entry.name}` : entry.name;

        if (entry.isDirectory()) {
          if (
            entry.name === "node_modules" ||
            entry.name === ".git" ||
            entry.name === CONFIG_DIR_NAME
          )
            continue;
          if (entry.name === path.basename(worktreesDir)) continue;
          copyEnvRecursive(srcPath, destPath, displayPath);
        } else if (entry.isFile() && entry.name.startsWith(".env")) {
          if (!existsSync(destPath)) {
            const destDir = path.dirname(destPath);
            if (!existsSync(destDir)) {
              mkdirSync(destDir, { recursive: true });
            }
            copyFileSync(srcPath, destPath);
            log.info(`Copied ${displayPath} to worktree`);
          }
        }
      }
    } catch {
      // Directory may not exist or be unreadable
    }
  };

  copyEnvRecursive(sourceDir, targetDir);
}
