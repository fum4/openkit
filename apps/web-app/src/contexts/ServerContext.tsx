import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

export interface Project {
  id: string;
  projectDir: string;
  port: number;
  name: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

interface ServerContextValue {
  // Current server URL (e.g., "http://localhost:6970")
  serverUrl: string | null;

  // All open projects
  projects: Project[];

  // Active project
  activeProject: Project | null;

  // Project management
  openProject: (folderPath: string) => Promise<{ success: boolean; error?: string }>;
  closeProject: (projectId: string) => Promise<void>;
  switchProject: (projectId: string) => void;

  // Electron detection
  isElectron: boolean;

  // Whether the initial project list is still loading (Electron only)
  projectsLoading: boolean;

  // Folder picker (Electron only)
  selectFolder: () => Promise<string | null>;
}

const ServerContext = createContext<ServerContextValue | null>(null);

export function useServer() {
  const context = useContext(ServerContext);
  if (!context) {
    throw new Error("useServer must be used within a ServerProvider");
  }
  return context;
}

// Hook that returns just the server URL, throws if no active project
export function useServerUrl(): string {
  const { serverUrl } = useServer();
  if (!serverUrl) {
    throw new Error("No active project");
  }
  return serverUrl;
}

// Optional version that returns null instead of throwing
export function useServerUrlOptional(): string | null {
  const { serverUrl } = useServer();
  return serverUrl;
}

interface ServerProviderProps {
  children: ReactNode;
}

export function ServerProvider({ children }: ServerProviderProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  const isElectron = typeof window !== "undefined" && !!window.electronAPI;
  const [projectsLoading, setProjectsLoading] = useState(isElectron);

  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;
  const serverUrl =
    activeProject?.status === "running" ? `http://localhost:${activeProject.port}` : null;

  // Load initial state from Electron
  useEffect(() => {
    if (!window.electronAPI) return;

    const loadProjects = async () => {
      const [loadedProjects, activeId] = await Promise.all([
        window.electronAPI!.getProjects(),
        window.electronAPI!.getActiveProject(),
      ]);
      setProjects(loadedProjects);
      setActiveProjectId(activeId);
      setProjectsLoading(false);
    };

    loadProjects();

    // Subscribe to changes from Electron
    const unsubProjects = window.electronAPI.onProjectsChanged(setProjects);
    const unsubActive = window.electronAPI.onActiveProjectChanged(setActiveProjectId);

    return () => {
      unsubProjects();
      unsubActive();
    };
  }, []);

  const selectFolder = useCallback(async (): Promise<string | null> => {
    if (!window.electronAPI) return null;
    return window.electronAPI.selectFolder();
  }, []);

  const openProject = useCallback(async (folderPath: string) => {
    if (!window.electronAPI) {
      return { success: false, error: "Not running in Electron" };
    }
    return window.electronAPI.openProject(folderPath);
  }, []);

  const closeProject = useCallback(async (projectId: string) => {
    if (!window.electronAPI) return;
    await window.electronAPI.closeProject(projectId);
  }, []);

  const switchProject = useCallback((projectId: string) => {
    if (!window.electronAPI) {
      setActiveProjectId(projectId);
      return;
    }
    window.electronAPI.switchTab(projectId);
  }, []);

  return (
    <ServerContext.Provider
      value={{
        serverUrl,
        projects,
        activeProject,
        openProject,
        closeProject,
        switchProject,
        isElectron,
        projectsLoading,
        selectFolder,
      }}
    >
      {children}
    </ServerContext.Provider>
  );
}
