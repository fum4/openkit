import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

import { DEFAULT_PORT } from "../constants";

export interface GlobalPreferences {
  basePort: number;
  setupPreference: "auto" | "manual" | "ask";
  sidebarWidth: number;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  } | null;
}

const STATE_DIR = path.join(os.homedir(), ".openkit");
const PREFERENCES_FILE = path.join(STATE_DIR, "app-preferences.json");

const DEFAULT_PREFERENCES: GlobalPreferences = {
  basePort: DEFAULT_PORT,
  setupPreference: "ask",
  sidebarWidth: 300,
  windowBounds: null,
};

function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}

export function loadGlobalPreferences(): GlobalPreferences {
  try {
    if (existsSync(PREFERENCES_FILE)) {
      const data = JSON.parse(readFileSync(PREFERENCES_FILE, "utf-8"));
      return { ...DEFAULT_PREFERENCES, ...data };
    }
  } catch {
    // Ignore
  }
  return { ...DEFAULT_PREFERENCES };
}

export function saveGlobalPreferences(prefs: GlobalPreferences): void {
  ensureStateDir();
  try {
    writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2));
  } catch {
    // Ignore save errors
  }
}

export function updateGlobalPreferences(updates: Partial<GlobalPreferences>): void {
  const current = loadGlobalPreferences();
  saveGlobalPreferences({ ...current, ...updates });
}
