import { contextBridge, ipcRenderer } from "electron";

export interface Project {
  id: string;
  projectDir: string;
  port: number;
  name: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

export interface OpenProjectResult {
  success: boolean;
  project?: Project;
  error?: string;
}

export interface AppUpdateState {
  status: "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
  version: string | null;
  progress: number | null;
  autoDownloadEnabled: boolean;
  error: string | null;
}

contextBridge.exposeInMainWorld("electronAPI", {
  // Platform detection
  isElectron: true,

  // Folder picker
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke("select-folder"),

  // Project management
  openProject: (folderPath: string): Promise<OpenProjectResult> =>
    ipcRenderer.invoke("open-project", folderPath),

  closeProject: (projectId: string): Promise<void> =>
    ipcRenderer.invoke("close-project", projectId),

  getProjects: (): Promise<Project[]> => ipcRenderer.invoke("get-projects"),

  getActiveProject: (): Promise<string | null> => ipcRenderer.invoke("get-active-project"),

  switchTab: (projectId: string): Promise<boolean> => ipcRenderer.invoke("switch-tab", projectId),

  // Event listeners
  onProjectsChanged: (callback: (projects: Project[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projects: Project[]) => callback(projects);
    ipcRenderer.on("projects-changed", handler);
    return () => ipcRenderer.removeListener("projects-changed", handler);
  },

  onActiveProjectChanged: (callback: (projectId: string | null) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, projectId: string | null) =>
      callback(projectId);
    ipcRenderer.on("active-project-changed", handler);
    return () => ipcRenderer.removeListener("active-project-changed", handler);
  },

  // App updates
  getAppVersion: (): Promise<string> => ipcRenderer.invoke("get-app-version"),
  getAppUpdateState: (): Promise<AppUpdateState> => ipcRenderer.invoke("get-app-update-state"),
  checkAppUpdates: (): Promise<AppUpdateState> => ipcRenderer.invoke("check-app-updates"),
  downloadAppUpdate: (): Promise<AppUpdateState> => ipcRenderer.invoke("download-app-update"),
  installAppUpdate: (): Promise<boolean> => ipcRenderer.invoke("install-app-update"),
  onAppUpdateState: (callback: (state: AppUpdateState) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: AppUpdateState) => callback(state);
    ipcRenderer.on("app-update-state", handler);
    return () => ipcRenderer.removeListener("app-update-state", handler);
  },
});
