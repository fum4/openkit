const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Platform detection
  isElectron: true,

  // Folder picker
  selectFolder: () => ipcRenderer.invoke("select-folder"),

  // Project management
  openProject: (folderPath) => ipcRenderer.invoke("open-project", folderPath),
  closeProject: (projectId) => ipcRenderer.invoke("close-project", projectId),
  getProjects: () => ipcRenderer.invoke("get-projects"),
  getActiveProject: () => ipcRenderer.invoke("get-active-project"),
  switchTab: (projectId) => ipcRenderer.invoke("switch-tab", projectId),

  // Event listeners
  onProjectsChanged: (callback) => {
    const handler = (_event, projects) => callback(projects);
    ipcRenderer.on("projects-changed", handler);
    return () => ipcRenderer.removeListener("projects-changed", handler);
  },

  onActiveProjectChanged: (callback) => {
    const handler = (_event, projectId) => callback(projectId);
    ipcRenderer.on("active-project-changed", handler);
    return () => ipcRenderer.removeListener("active-project-changed", handler);
  },

  // Preferences
  getPreferences: () => ipcRenderer.invoke("get-preferences"),
  getSetupPreference: () => ipcRenderer.invoke("get-setup-preference"),
  setSetupPreference: (preference) => ipcRenderer.invoke("set-setup-preference", preference),
  getSidebarWidth: () => ipcRenderer.invoke("get-sidebar-width"),
  setSidebarWidth: (width) => ipcRenderer.invoke("set-sidebar-width", width),
  updatePreferences: (updates) => ipcRenderer.invoke("update-preferences", updates),
});
