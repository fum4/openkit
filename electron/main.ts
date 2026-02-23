import { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, shell, Tray } from "electron";
import path from "path";
import { fileURLToPath } from "url";
import { ProjectManager, type Project } from "./project-manager.js";
import { NotificationManager } from "./notification-manager.js";
import {
  preferencesManager,
  type AppPreferences,
  type SetupPreference,
} from "./preferences-manager.js";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

// Set app name (shows in dock, menu bar, etc.)
app.setName("OpenKit");

// Custom protocol for opening projects
const PROTOCOL = "OpenKit";

// Single main window and project manager
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
const projectManager = new ProjectManager();
const notificationManager = new NotificationManager(() => mainWindow, projectManager);

function getUiPath(): string {
  // In prod: dist/electron/ -> look for dist/ui/index.html
  return path.join(currentDir, "..", "ui", "index.html");
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
    icon: path.join(currentDir, "..", "assets", "icon.png"),
    webPreferences: {
      preload: path.join(currentDir, "preload.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  };

  mainWindow = new BrowserWindow(windowConfig);

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
