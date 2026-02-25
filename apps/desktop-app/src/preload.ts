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
});
