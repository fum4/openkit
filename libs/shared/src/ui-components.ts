import { existsSync, lstatSync } from "fs";
import os from "os";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";

export function getOpenKitStateDir(): string {
  return path.join(os.homedir(), CONFIG_DIR_NAME);
}

export function getComponentsDir(): string {
  return path.join(getOpenKitStateDir(), "components");
}

export function getDownloadedWebUiCurrentPath(): string {
  return path.join(getComponentsDir(), "web", "current");
}

export function getBundledWebUiPath(projectRoot: string): string {
  return path.join(projectRoot, "apps", "web-app", "dist");
}

function getLegacyBundledWebUiPath(projectRoot: string): string {
  return path.join(projectRoot, "dist", "ui");
}

function hasIndexHtml(dir: string): boolean {
  return existsSync(path.join(dir, "index.html"));
}

function isDir(pathname: string): boolean {
  try {
    return lstatSync(pathname).isDirectory();
  } catch {
    return false;
  }
}

export function resolveAvailableWebUiPath(projectRoot: string): string | null {
  const bundledPaths = [getBundledWebUiPath(projectRoot), getLegacyBundledWebUiPath(projectRoot)];
  for (const bundledPath of bundledPaths) {
    if (isDir(bundledPath) && hasIndexHtml(bundledPath)) {
      return bundledPath;
    }
  }

  const downloaded = getDownloadedWebUiCurrentPath();
  if (isDir(downloaded) && hasIndexHtml(downloaded)) {
    return downloaded;
  }

  return null;
}
