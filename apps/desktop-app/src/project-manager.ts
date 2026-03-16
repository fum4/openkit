import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import net from "net";
import path from "path";
import os from "os";
import type { ChildProcess } from "child_process";
import { spawnServer, stopServer, waitForServerReady } from "./server-spawner.js";
import { preferencesManager } from "./preferences-manager.js";
import { symlinkOpsLog } from "./dev-mode.js";
import { log } from "./logger.js";

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      server.close();
      resolve(false);
    }, 5000);
    const server = net.createServer();
    server.once("error", () => {
      clearTimeout(timeout);
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
    server.listen(port);
  });
}

export interface Project {
  id: string;
  projectDir: string;
  port: number;
  name: string;
  status: "starting" | "running" | "stopped" | "error";
  error?: string;
}

interface ProjectInternal extends Project {
  serverProcess: ChildProcess | null;
  recentServerErrors: string[];
  moduleResolveError: string | null;
}

interface AppState {
  openProjects: Array<{
    projectDir: string;
    lastOpened: string;
  }>;
  lastActiveProjectDir: string | null;
}

const STATE_DIR = path.join(os.homedir(), ".openkit");
const STATE_FILE = path.join(STATE_DIR, "app-state.json");
const LOCK_FILE = path.join(STATE_DIR, "electron.lock");

export class ProjectManager {
  private projects = new Map<string, ProjectInternal>();
  private activeProjectId: string | null = null;
  private onChangeCallbacks: Array<() => void> = [];

  constructor() {
    this.ensureStateDir();
    this.createLockFile();
  }

  private ensureStateDir() {
    if (!existsSync(STATE_DIR)) {
      mkdirSync(STATE_DIR, { recursive: true });
    }
  }

  private createLockFile() {
    writeFileSync(LOCK_FILE, JSON.stringify({ pid: process.pid }));
  }

  removeLockFile() {
    try {
      if (existsSync(LOCK_FILE)) {
        const fs = require("fs");
        fs.unlinkSync(LOCK_FILE);
      }
    } catch {
      // Ignore
    }
  }

  private generateId(projectDir: string): string {
    // Simple hash of the path
    let hash = 0;
    for (let i = 0; i < projectDir.length; i++) {
      const char = projectDir.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
  }

  private getProjectName(projectDir: string): string {
    // Try to get name from package.json
    const pkgPath = path.join(projectDir, "package.json");
    if (existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.name) return pkg.name;
      } catch {
        // Fall through
      }
    }
    // Fall back to directory name
    return path.basename(projectDir);
  }

  private async allocatePort(): Promise<number> {
    const usedPorts = new Set(Array.from(this.projects.values()).map((p) => p.port));
    let port = preferencesManager.getBasePort() + 1;
    // Skip ports claimed by other projects AND ports that are actually in use on
    // the system (e.g. leftover server processes from a previous session).
    while ((usedPorts.has(port) || !(await isPortFree(port))) && port <= 65535) {
      port++;
    }
    if (port > 65535) {
      throw new Error("No available port found");
    }
    return port;
  }

  private notifyChange() {
    for (const callback of this.onChangeCallbacks) {
      callback();
    }
  }

  onChange(callback: () => void) {
    this.onChangeCallbacks.push(callback);
    return () => {
      const idx = this.onChangeCallbacks.indexOf(callback);
      if (idx !== -1) this.onChangeCallbacks.splice(idx, 1);
    };
  }

  async openProject(
    projectDir: string,
  ): Promise<{ success: boolean; project?: Project; error?: string }> {
    // Normalize path
    const normalizedDir = path.resolve(projectDir);

    // Check if already open
    for (const [id, project] of this.projects) {
      if (project.projectDir === normalizedDir) {
        this.activeProjectId = id;
        this.notifyChange();
        return { success: true, project: this.toPublicProject(project) };
      }
    }

    // Check if it's at least a git repository
    const gitDir = path.join(normalizedDir, ".git");
    if (!existsSync(gitDir)) {
      return { success: false, error: "Not a git repository" };
    }

    const id = this.generateId(normalizedDir);
    const port = await this.allocatePort();
    const name = this.getProjectName(normalizedDir);

    const project: ProjectInternal = {
      id,
      projectDir: normalizedDir,
      port,
      name,
      status: "starting",
      serverProcess: null,
      recentServerErrors: [],
      moduleResolveError: null,
    };

    this.projects.set(id, project);
    this.activeProjectId = id;
    this.notifyChange();

    // Spawn server
    try {
      const serverProcess = spawnServer(normalizedDir, port);
      project.serverProcess = serverProcess;
      const pushServerError = (line: string) => {
        const trimmed = line.trim();
        if (!trimmed) return;
        if (
          trimmed.includes("Cannot find package") ||
          trimmed.includes("Cannot find module") ||
          trimmed.includes("ERR_MODULE_NOT_FOUND")
        ) {
          project.moduleResolveError = trimmed;
        }
        project.recentServerErrors.push(trimmed);
        if (project.recentServerErrors.length > 20) {
          project.recentServerErrors = project.recentServerErrors.slice(-20);
        }
      };

      // Listen for the server's actual port in case findAvailablePort() had to
      // pick a different one (e.g. a leftover server still holds the requested port).
      serverProcess.stdout?.on("data", (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          const portMatch = line.match(/^__OPENKIT_PORT__=(\d+)$/);
          if (portMatch) {
            const actualPort = parseInt(portMatch[1], 10);
            if (actualPort !== project.port) {
              log.debug(`Port corrected: requested ${project.port}, actual ${actualPort}`, {
                domain: "port-allocation",
              });
              project.port = actualPort;
              this.notifyChange();
            }
          }
        }
      });

      serverProcess.stderr?.on("data", (data: Buffer) => {
        const text = data.toString();
        for (const line of text.split("\n")) {
          pushServerError(line);
        }
      });

      serverProcess.on("error", (err: Error) => {
        project.status = "error";
        project.error = err.message;
        this.notifyChange();
      });

      serverProcess.on("exit", (code: number | null) => {
        if (project.status !== "stopped") {
          project.status = code === 0 ? "stopped" : "error";
          if (code !== 0) {
            const detail = project.recentServerErrors.join(" | ");
            const reason = project.moduleResolveError
              ? `${project.moduleResolveError} | ${detail}`
              : detail;
            project.error = reason
              ? `Server exited with code ${code}: ${reason}`
              : `Server exited with code ${code}`;
          }
          this.notifyChange();
        }
      });

      // Pass a getter so waitForServerReady re-reads the port on each poll
      // iteration — project.port may be updated by the stdout listener above.
      const ready = await waitForServerReady(() => project.port);
      if (ready) {
        project.status = "running";
      } else {
        if (project.status !== "error") {
          project.status = "error";
          const detail = project.recentServerErrors.join(" | ");
          project.error = project.moduleResolveError
            ? `Server failed to start: ${project.moduleResolveError}${detail ? ` | ${detail}` : ""}`
            : detail
              ? `Server failed to start: ${detail}`
              : "Server failed to start";
        }
      }
      this.notifyChange();

      this.saveState();
      this.trySymlinkOpsLog(project);
      return { success: true, project: this.toPublicProject(project) };
    } catch (err) {
      project.status = "error";
      project.error = err instanceof Error ? err.message : "Failed to start server";
      this.notifyChange();
      return { success: false, error: project.error };
    }
  }

  async closeProject(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (!project) return;

    project.status = "stopped";

    if (project.serverProcess) {
      await stopServer(project.serverProcess);
      project.serverProcess = null;
    }

    this.projects.delete(id);

    if (this.activeProjectId === id) {
      // Switch to another project if available
      const remaining = Array.from(this.projects.keys());
      this.activeProjectId = remaining.length > 0 ? remaining[0] : null;
    }

    this.notifyChange();
    this.saveState();
  }

  async closeAllProjects(): Promise<void> {
    // Save state BEFORE closing so we remember what was open
    this.saveState();

    const ids = Array.from(this.projects.keys());
    for (const id of ids) {
      await this.closeProjectWithoutSave(id);
    }
  }

  private async closeProjectWithoutSave(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (!project) return;

    project.status = "stopped";

    if (project.serverProcess) {
      await stopServer(project.serverProcess);
      project.serverProcess = null;
    }

    this.projects.delete(id);

    if (this.activeProjectId === id) {
      const remaining = Array.from(this.projects.keys());
      this.activeProjectId = remaining.length > 0 ? remaining[0] : null;
    }

    this.notifyChange();
  }

  setActiveProject(id: string): boolean {
    if (!this.projects.has(id)) return false;
    this.activeProjectId = id;
    this.notifyChange();
    return true;
  }

  getActiveProjectId(): string | null {
    return this.activeProjectId;
  }

  getActiveProject(): Project | null {
    if (!this.activeProjectId) return null;
    const project = this.projects.get(this.activeProjectId);
    return project ? this.toPublicProject(project) : null;
  }

  getProjects(): Project[] {
    return Array.from(this.projects.values()).map((p) => this.toPublicProject(p));
  }

  getProject(id: string): Project | null {
    const project = this.projects.get(id);
    return project ? this.toPublicProject(project) : null;
  }

  private trySymlinkOpsLog(project: ProjectInternal) {
    if (!preferencesManager.isDevMode()) return;

    const repoPath = preferencesManager.getDevModeRepoPath();
    if (!repoPath) return;

    try {
      symlinkOpsLog(project.projectDir, project.name, repoPath);
    } catch {
      // Dev-mode symlink is best-effort — don't block project opening
    }
  }

  private toPublicProject(project: ProjectInternal): Project {
    return {
      id: project.id,
      projectDir: project.projectDir,
      port: project.port,
      name: project.name,
      status: project.status,
      error: project.error,
    };
  }

  private saveState() {
    const state: AppState = {
      openProjects: Array.from(this.projects.values()).map((p) => ({
        projectDir: p.projectDir,
        lastOpened: new Date().toISOString(),
      })),
      lastActiveProjectDir: this.activeProjectId
        ? (this.projects.get(this.activeProjectId)?.projectDir ?? null)
        : null,
    };

    try {
      writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch {
      // Ignore save errors
    }
  }

  loadState(): AppState | null {
    try {
      if (existsSync(STATE_FILE)) {
        return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
      }
    } catch {
      // Ignore
    }
    return null;
  }

  async restoreProjects(): Promise<void> {
    const state = this.loadState();
    if (!state || state.openProjects.length === 0) return;

    await Promise.all(
      state.openProjects
        .filter(({ projectDir }) => existsSync(projectDir))
        .map(({ projectDir }) => this.openProject(projectDir)),
    );

    // Restore active project
    if (state.lastActiveProjectDir) {
      for (const [id, project] of this.projects) {
        if (project.projectDir === state.lastActiveProjectDir) {
          this.activeProjectId = id;
          this.notifyChange();
          break;
        }
      }
    }
  }
}
