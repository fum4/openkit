import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";

export type SetupPreference = "auto" | "manual" | "ask";

export interface AppPreferences {
  basePort: number;
  setupPreference: SetupPreference;
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

const DEFAULT_PORT = 6969;

const DEFAULT_PREFERENCES: AppPreferences = {
  basePort: DEFAULT_PORT,
  setupPreference: "ask",
  sidebarWidth: 300,
  windowBounds: null,
};

class PreferencesManager {
  private preferences: AppPreferences;

  constructor() {
    this.ensureStateDir();
    this.preferences = this.load();
  }

  private ensureStateDir() {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  private load(): AppPreferences {
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

  private save() {
    try {
      writeFileSync(PREFERENCES_FILE, JSON.stringify(this.preferences, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  getPreferences(): AppPreferences {
    return { ...this.preferences };
  }

  getBasePort(): number {
    return this.preferences.basePort;
  }

  setBasePort(port: number) {
    this.preferences.basePort = port;
    this.save();
  }

  getSetupPreference(): SetupPreference {
    return this.preferences.setupPreference;
  }

  setSetupPreference(preference: SetupPreference) {
    this.preferences.setupPreference = preference;
    this.save();
  }

  getSidebarWidth(): number {
    return this.preferences.sidebarWidth;
  }

  setSidebarWidth(width: number) {
    this.preferences.sidebarWidth = width;
    this.save();
  }

  getWindowBounds(): AppPreferences["windowBounds"] {
    return this.preferences.windowBounds;
  }

  setWindowBounds(bounds: AppPreferences["windowBounds"]) {
    this.preferences.windowBounds = bounds;
    this.save();
  }

  updatePreferences(updates: Partial<AppPreferences>) {
    this.preferences = { ...this.preferences, ...updates };
    this.save();
  }
}

// Singleton instance
export const preferencesManager = new PreferencesManager();
