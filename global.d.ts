/// <reference types="vite/client" />
// Global type declarations

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly DEV: boolean;
  readonly PROD: boolean;
  readonly SSR: boolean;
  readonly [key: string]: string | boolean | undefined;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ElectronProject {
  id: string;
  projectDir: string;
  port: number;
  name: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

type SetupPreference = "auto" | "manual" | "ask";

interface AppPreferences {
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

interface ElectronAPI {
  selectFolder: () => Promise<string | null>;
  openProject: (
    folderPath: string,
  ) => Promise<{ success: boolean; error?: string; project?: ElectronProject }>;
  closeProject: (projectId: string) => Promise<void>;
  getProjects: () => Promise<ElectronProject[]>;
  getActiveProject: () => Promise<string | null>;
  switchTab: (projectId: string) => Promise<boolean>;
  onProjectsChanged: (callback: (projects: ElectronProject[]) => void) => () => void;
  onActiveProjectChanged: (callback: (projectId: string | null) => void) => () => void;

  // Preferences
  getPreferences: () => Promise<AppPreferences>;
  getSetupPreference: () => Promise<SetupPreference>;
  setSetupPreference: (preference: SetupPreference) => Promise<void>;
  getSidebarWidth: () => Promise<number>;
  setSidebarWidth: (width: number) => Promise<void>;
  updatePreferences: (updates: Partial<AppPreferences>) => Promise<void>;
}

interface Window {
  electronAPI?: ElectronAPI;
}

declare module "*.svg" {
  const src: string;
  export default src;
}

declare module "*.svg?raw" {
  const src: string;
  export default src;
}

declare module "*.png" {
  const src: string;
  export default src;
}
