import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import os from "os";
import type { ChildProcess } from "child_process";
import { spawnServer, stopServer, waitForServerReady } from "./server-spawner.js";
import { preferencesManager } from "./preferences-manager.js";

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

  private allocatePort(): number {
    const usedPorts = new Set(Array.from(this.projects.values()).map((p) => p.port));
    let port = preferencesManager.getBasePort() + 1;
    while (usedPorts.has(port)) {
      port++;
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
    const port = this.allocatePort();
    const name = this.getProjectName(normalizedDir);

    const project: ProjectInternal = {
      id,
      projectDir: normalizedDir,
      port,
      name,
      status: "starting",
      serverProcess: null,
    };

    this.projects.set(id, project);
    this.activeProjectId = id;
    this.notifyChange();

    // Spawn server
    try {
      const serverProcess = spawnServer(normalizedDir, port);
      project.serverProcess = serverProcess;

      serverProcess.on("error", (err: Error) => {
        project.status = "error";
        project.error = err.message;
        this.notifyChange();
      });

      serverProcess.on("exit", (code: number | null) => {
        if (project.status !== "stopped") {
          project.status = code === 0 ? "stopped" : "error";
          if (code !== 0) {
            project.error = `Server exited with code ${code}`;
          }
          this.notifyChange();
        }
      });

      // Wait for server to be ready
      const ready = await waitForServerReady(port);
      if (ready) {
        project.status = "running";
      } else {
        project.status = "error";
        project.error = "Server failed to start";
      }
      this.notifyChange();

      this.saveState();
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
