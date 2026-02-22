import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
const STATE_DIR = path.join(os.homedir(), ".openkit");
const PREFERENCES_FILE = path.join(STATE_DIR, "app-preferences.json");
const DEFAULT_PREFERENCES = {
  basePort: 6969,
  setupPreference: "ask",
  sidebarWidth: 300,
  windowBounds: null,
};
function ensureStateDir() {
  if (!existsSync(STATE_DIR)) {
    mkdirSync(STATE_DIR, { recursive: true });
  }
}
export function loadGlobalPreferences() {
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
export function saveGlobalPreferences(prefs) {
  ensureStateDir();
  try {
    writeFileSync(PREFERENCES_FILE, JSON.stringify(prefs, null, 2));
  } catch {
    // Ignore save errors
  }
}
export function updateGlobalPreferences(updates) {
  const current = loadGlobalPreferences();
  saveGlobalPreferences({ ...current, ...updates });
}
//# sourceMappingURL=global-preferences.js.map
