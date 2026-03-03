import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import electronUpdater from "electron-updater";
import type { AppUpdater } from "electron-updater";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ProjectManager, type Project } from "./project-manager.js";
import { NotificationManager } from "./notification-manager.js";
import {
  preferencesManager,
  type AppPreferences,
  type SetupPreference,
} from "./preferences-manager.js";

const { autoUpdater } = electronUpdater as { autoUpdater: AppUpdater };

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveWorkspaceRoot(dir: string): string {
  if (
    dir.includes(path.join("apps", "desktop-app", "src")) ||
    dir.includes(path.join("apps", "desktop-app", "dist"))
  ) {
    return path.resolve(dir, "..", "..", "..");
  }
  // Legacy fallback for older dist/electron layout.
  return path.resolve(dir, "..", "..");
}

const workspaceRoot = resolveWorkspaceRoot(currentDir);

// Set app name (shows in dock, menu bar, etc.)
app.setName("OpenKit");

// Custom protocol for opening projects
const PROTOCOL = "OpenKit";

// Single main window and project manager
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const projectManager = new ProjectManager();
const notificationManager = new NotificationManager(() => mainWindow, projectManager);

type AppUpdateStatus = "idle" | "checking" | "available" | "downloading" | "downloaded" | "error";
interface AppUpdateState {
  status: AppUpdateStatus;
  version: string | null;
  progress: number | null;
  autoDownloadEnabled: boolean;
  error: string | null;
}

let appUpdateState: AppUpdateState = {
  status: "idle",
  version: null,
  progress: null,
  autoDownloadEnabled: preferencesManager.getPreferences().autoDownloadUpdates,
  error: null,
};

function emitAppUpdateState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send("app-update-state", appUpdateState);
}

function setAppUpdateState(updates: Partial<AppUpdateState>) {
  appUpdateState = { ...appUpdateState, ...updates };
  emitAppUpdateState();
}

function getUiPath(): string {
  const appLocalUi = path.join(workspaceRoot, "apps", "web-app", "dist", "index.html");
  if (existsSync(appLocalUi)) {
    return appLocalUi;
  }

  // Legacy fallback for older root dist/ui layout.
  return path.join(workspaceRoot, "dist", "ui", "index.html");
}

function createMainWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  // Get saved window bounds or use defaults
  const savedBounds = preferencesManager.getWindowBounds();
  const windowConfig = {
    width: savedBounds?.width ?? 1200,
    height: savedBounds?.height ?? 900,
    x: savedBounds?.x,
    y: savedBounds?.y,
    minWidth: 800,
    minHeight: 700,
    backgroundColor: "#0a0c10",
    title: "OpenKit",
    titleBarStyle: "hiddenInset" as const,
    trafficLightPosition: { x: 12, y: 12 },
    icon: path.join(workspaceRoot, "apps", "desktop-app", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  mainWindow = new BrowserWindow(windowConfig);
  mainWindow.webContents.on("did-finish-load", () => {
    emitAppUpdateState();
  });

  // Load the main UI - from dev server in dev mode, from file in prod
  if (process.env.UI_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.UI_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(getUiPath());
  }

  // Save window bounds when resized or moved
  const saveBounds = () => {
    if (mainWindow && !mainWindow.isMaximized() && !mainWindow.isMinimized()) {
      const bounds = mainWindow.getBounds();
      preferencesManager.setWindowBounds(bounds);
    }
  };

  mainWindow.on("resize", saveBounds);
  mainWindow.on("move", saveBounds);

  mainWindow.on("close", (event) => {
    if (tray) {
      // Hide to tray instead of closing
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // Prevent accidental hard reload shortcuts in production because they can
  // disrupt long-running terminal sessions and in-flight UI state.
  const isDevMode = !app.isPackaged || Boolean(process.env.UI_DEV_SERVER_URL);
  if (!isDevMode) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      const isReloadChord = (input.meta || input.control) && input.key.toLowerCase() === "r";
      const isF5 = input.key === "F5";
      if (isReloadChord || isF5) {
        event.preventDefault();
      }
    });
  }

  return mainWindow;
}

function notifyProjectsChanged() {
  const projects = projectManager.getProjects();
  const activeId = projectManager.getActiveProjectId();

  mainWindow?.webContents.send("projects-changed", projects);
  mainWindow?.webContents.send("active-project-changed", activeId);
  updateTrayMenu();
  notificationManager.syncProjectStreams();
}

// IPC Handlers
function setupIpcHandlers() {
  ipcMain.handle("select-folder", async () => {
    if (!mainWindow) return null;

    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ["openDirectory"],
      title: "Select Project Directory",
    });

    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("open-project", async (_, folderPath: string) => {
    const result = await projectManager.openProject(folderPath);

    if (result.success) {
      notifyProjectsChanged();
    }

    return result;
  });

  ipcMain.handle("close-project", async (_, projectId: string) => {
    await projectManager.closeProject(projectId);
    notifyProjectsChanged();
  });

  ipcMain.handle("get-projects", () => {
    return projectManager.getProjects();
  });

  ipcMain.handle("get-active-project", () => {
    return projectManager.getActiveProjectId();
  });

  ipcMain.handle("switch-tab", (_, projectId: string) => {
    projectManager.setActiveProject(projectId);
    notifyProjectsChanged();
    return true;
  });

  // Preferences handlers
  ipcMain.handle("get-preferences", () => {
    return preferencesManager.getPreferences();
  });

  ipcMain.handle("get-setup-preference", () => {
    return preferencesManager.getSetupPreference();
  });

  ipcMain.handle("set-setup-preference", (_, preference: SetupPreference) => {
    preferencesManager.setSetupPreference(preference);
  });

  ipcMain.handle("get-sidebar-width", () => {
    return preferencesManager.getSidebarWidth();
  });

  ipcMain.handle("set-sidebar-width", (_, width: number) => {
    preferencesManager.setSidebarWidth(width);
  });

  ipcMain.handle("update-preferences", (_, updates: Partial<AppPreferences>) => {
    preferencesManager.updatePreferences(updates);
    if (typeof updates.autoDownloadUpdates === "boolean") {
      appUpdateState = {
        ...appUpdateState,
        autoDownloadEnabled: updates.autoDownloadUpdates,
      };
      if (app.isPackaged) {
        autoUpdater.autoDownload = updates.autoDownloadUpdates;
        if (updates.autoDownloadUpdates && appUpdateState.status === "available") {
          setAppUpdateState({ status: "downloading", progress: 0, error: null });
          void autoUpdater.downloadUpdate().catch((error: unknown) => {
            setAppUpdateState({
              status: "error",
              error: error instanceof Error ? error.message : "Failed to download update",
            });
          });
        } else {
          emitAppUpdateState();
        }
      } else {
        emitAppUpdateState();
      }
    }
  });

  ipcMain.handle("get-app-update-state", () => {
    return appUpdateState;
  });

  ipcMain.handle("check-app-updates", async () => {
    if (!app.isPackaged) return appUpdateState;
    await autoUpdater.checkForUpdates();
    return appUpdateState;
  });

  ipcMain.handle("download-app-update", async () => {
    if (!app.isPackaged) return appUpdateState;
    if (appUpdateState.status !== "available") return appUpdateState;
    setAppUpdateState({ status: "downloading", progress: 0, error: null });
    await autoUpdater.downloadUpdate();
    return appUpdateState;
  });

  ipcMain.handle("install-app-update", async () => {
    if (!app.isPackaged) return false;
    if (appUpdateState.status !== "downloaded") return false;
    setImmediate(() => autoUpdater.quitAndInstall());
    return true;
  });
}

// Project manager change listener
projectManager.onChange(() => {
  notifyProjectsChanged();
});

function updateTrayMenu() {
  if (!tray) return;

  const projects = projectManager.getProjects();
  const projectItems: Electron.MenuItemConstructorOptions[] = projects.map((project: Project) => ({
    label: project.name,
    click: () => {
      projectManager.setActiveProject(project.id);
      notifyProjectsChanged();
      mainWindow?.show();
      mainWindow?.focus();
    },
  }));

  const contextMenu = Menu.buildFromTemplate([
    ...(projectItems.length > 0 ? [...projectItems, { type: "separator" as const }] : []),
    {
      label: "Open Project...",
      click: async () => {
        createMainWindow();
        mainWindow?.show();
      },
    },
    { type: "separator" },
    {
      label: "Quit",
      click: async () => {
        tray = null;
        await projectManager.closeAllProjects();
        projectManager.removeLockFile();
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

function createTray() {
  const icon = nativeImage.createFromBuffer(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAABAAAAAPCAYAAADtc08vAAAAiklEQVQoz2NgGAUkAEYGBob/DAwM/6E0MZiJgYHhPwMDwwIGBoYCBgYGBWIMAGkGaVxAjAuwuQCbN4gCjAwMDAsYGBgKQBwGBgYFBgYGRmI0I7sAm2aQy0B8dBcQDECuB7mMGE3IAYjNyIYBNaMAmS8oYCRgUGBgYEiANHIxMBAbgBwwkABGAQAAJ1cwK/7gzBkAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  icon.setTemplateImage(true);

  tray = new Tray(icon);
  tray.setToolTip("OpenKit - Worktree Manager");

  tray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        mainWindow.focus();
      } else {
        mainWindow.show();
      }
    } else {
      createMainWindow();
    }
  });

  updateTrayMenu();
}

function setupAutoUpdater() {
  if (!app.isPackaged) {
    return;
  }

  const { autoDownloadUpdates } = preferencesManager.getPreferences();
  autoUpdater.autoDownload = autoDownloadUpdates;
  autoUpdater.autoInstallOnAppQuit = true;
  setAppUpdateState({
    status: "idle",
    version: null,
    progress: null,
    autoDownloadEnabled: autoDownloadUpdates,
    error: null,
  });

  autoUpdater.on("checking-for-update", () => {
    setAppUpdateState({ status: "checking", error: null });
  });

  autoUpdater.on("update-not-available", () => {
    setAppUpdateState({ status: "idle", version: null, progress: null, error: null });
  });

  autoUpdater.on("update-available", (info) => {
    const shouldAutoDownload = preferencesManager.getPreferences().autoDownloadUpdates;
    setAppUpdateState({
      status: shouldAutoDownload ? "downloading" : "available",
      version: info.version ?? null,
      progress: shouldAutoDownload ? 0 : null,
      autoDownloadEnabled: shouldAutoDownload,
      error: null,
    });

    if (shouldAutoDownload) {
      void autoUpdater.downloadUpdate().catch((error: unknown) => {
        setAppUpdateState({
          status: "error",
          error: error instanceof Error ? error.message : "Failed to download update",
        });
      });
    }
  });

  autoUpdater.on("download-progress", (progressObj) => {
    setAppUpdateState({
      status: "downloading",
      progress: Math.max(0, Math.min(100, progressObj.percent)),
      error: null,
    });
  });

  autoUpdater.on("update-downloaded", (info) => {
    setAppUpdateState({
      status: "downloaded",
      version: info.version ?? appUpdateState.version,
      progress: 100,
      error: null,
    });
  });

  autoUpdater.on("error", (error) => {
    console.error("[auto-updater] update check failed", error);
    setAppUpdateState({
      status: "error",
      error: error.message,
      progress: null,
    });
  });

  autoUpdater.checkForUpdates().catch((error: unknown) => {
    console.error("[auto-updater] initial update check failed", error);
    setAppUpdateState({
      status: "error",
      error: error instanceof Error ? error.message : "Failed to check for updates",
    });
  });

  const periodicCheck = setInterval(
    () => {
      autoUpdater.checkForUpdates().catch((error: unknown) => {
        console.error("[auto-updater] periodic update check failed", error);
        setAppUpdateState({
          status: "error",
          error: error instanceof Error ? error.message : "Failed to check for updates",
        });
      });
    },
    1000 * 60 * 10,
  );
  periodicCheck.unref();
}

function handleProtocolUrl(url: string) {
  try {
    const parsed = new URL(url);

    if (parsed.hostname === "open") {
      // Legacy: open by port (for backwards compatibility)
      const port = parsed.searchParams.get("port");
      if (port) {
        createMainWindow();
        mainWindow?.show();
        mainWindow?.focus();
      }
    }

    if (parsed.hostname === "open-project") {
      // New: open by directory
      const dir = parsed.searchParams.get("dir");
      if (dir) {
        createMainWindow();
        mainWindow?.show();
        mainWindow?.focus();
        // Open the project
        projectManager.openProject(decodeURIComponent(dir)).then((result: { success: boolean }) => {
          if (result.success) {
            notifyProjectsChanged();
          }
        });
      }
    }
  } catch {
    // Ignore malformed URLs
  }
}

// Register as handler for OpenKit:// protocol
if (process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
} else {
  app.setAsDefaultProtocolClient(PROTOCOL);
}

// macOS: handle protocol URLs when app is already running
app.on("open-url", (_event, url) => {
  handleProtocolUrl(url);
});

// Ensure single instance
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const urlArg = argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
    if (urlArg) {
      handleProtocolUrl(urlArg);
    }

    // Focus the window
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createMainWindow();
  createTray();
  setupAutoUpdater();

  // Check if launched with a protocol URL
  const protocolArg = process.argv.find((arg) => arg.startsWith(`${PROTOCOL}://`));
  if (protocolArg) {
    handleProtocolUrl(protocolArg);
  }

  // Open project from --project flag (fire-and-forget, onChange listener updates UI)
  const projectIdx = process.argv.indexOf("--project");
  if (projectIdx !== -1 && process.argv[projectIdx + 1]) {
    projectManager.openProject(process.argv[projectIdx + 1]);
  }

  // Restore previous state in the background (onChange listener updates UI)
  if (projectManager.getProjects().length === 0) {
    projectManager.restoreProjects();
  }

  app.on("activate", () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  // Keep running in tray on macOS
  if (process.platform !== "darwin" && !tray) {
    app.quit();
  }
});

app.on("before-quit", async () => {
  tray = null;
  notificationManager.dispose();
  await projectManager.closeAllProjects();
  projectManager.removeLockFile();
});
