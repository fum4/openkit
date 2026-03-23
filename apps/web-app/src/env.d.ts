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
  autoDownloadUpdates: boolean;
  devMode: boolean;
  devModeRepoPath: string;
  sidebarWidth: number;
  windowBounds: {
    x?: number;
    y?: number;
    width: number;
    height: number;
  } | null;
}

interface AppUpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  version: string | null;
  progress: number | null;
  autoDownloadEnabled: boolean;
  error: string | null;
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

  getPreferences: () => Promise<AppPreferences>;
  getSetupPreference: () => Promise<SetupPreference>;
  setSetupPreference: (preference: SetupPreference) => Promise<void>;
  getSidebarWidth: () => Promise<number>;
  setSidebarWidth: (width: number) => Promise<void>;
  updatePreferences: (updates: Partial<AppPreferences>) => Promise<void>;
  detectOpenkitRepo: () => Promise<string | null>;
  selectDevRepoFolder: () => Promise<string | null>;

  // System-level agent discovery
  getInstalledAgents: () => Promise<string[]>;

  getAppVersion: () => Promise<string>;
  getAppUpdateState: () => Promise<AppUpdateState>;
  checkAppUpdates: () => Promise<AppUpdateState>;
  downloadAppUpdate: () => Promise<AppUpdateState>;
  installAppUpdate: () => Promise<boolean>;
  onAppUpdateState: (callback: (state: AppUpdateState) => void) => () => void;
}

interface Window {
  electronAPI?: ElectronAPI;
}
