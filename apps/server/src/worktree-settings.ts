/**
 * Reads and writes per-worktree settings stored in `.openkit/worktree-settings.json`.
 * Supports loading, patching, and deleting override settings for individual worktrees.
 */
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import path from "path";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import type { WorktreeSettings } from "@openkit/shared/worktree-types";

import { log } from "./logger";

const WORKTREE_SETTINGS_FILE_NAME = "worktree-settings.json";

function getWorktreeSettingsPath(configDir: string): string {
  return path.join(configDir, CONFIG_DIR_NAME, WORKTREE_SETTINGS_FILE_NAME);
}

function readSettingsFile(filePath: string): Record<string, WorktreeSettings> | null {
  if (!existsSync(filePath)) return null;

  try {
    const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, WorktreeSettings>;
  } catch (err) {
    log.warn("Failed to parse worktree settings, ignoring file", {
      domain: "config",
      path: filePath,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export function loadWorktreeSettings(configDir: string, worktreeId: string): WorktreeSettings {
  const filePath = getWorktreeSettingsPath(configDir);
  const all = readSettingsFile(filePath);
  if (!all) return {};

  const entry = all[worktreeId];
  if (!entry || typeof entry !== "object") return {};

  return entry;
}

export function updateWorktreeSettings(
  configDir: string,
  worktreeId: string,
  patch: Record<string, unknown>,
): void {
  const filePath = getWorktreeSettingsPath(configDir);
  const all = readSettingsFile(filePath) ?? {};
  const entry: Record<string, unknown> = { ...all[worktreeId] };

  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "boolean") {
      entry[key] = value;
    } else if (value === null || value === undefined) {
      delete entry[key];
    }
  }

  if (Object.keys(entry).length === 0) {
    delete all[worktreeId];
  } else {
    all[worktreeId] = entry as WorktreeSettings;
  }

  if (Object.keys(all).length === 0) {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
    return;
  }

  const configDirPath = path.join(configDir, CONFIG_DIR_NAME);
  mkdirSync(configDirPath, { recursive: true });
  writeFileSync(filePath, JSON.stringify(all, null, 2) + "\n");
}

export function deleteWorktreeSettings(configDir: string, worktreeId: string): void {
  const filePath = getWorktreeSettingsPath(configDir);
  const all = readSettingsFile(filePath);
  if (!all || !(worktreeId in all)) return;

  delete all[worktreeId];

  if (Object.keys(all).length === 0) {
    unlinkSync(filePath);
    return;
  }

  writeFileSync(filePath, JSON.stringify(all, null, 2) + "\n");
}
