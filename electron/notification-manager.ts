import http from "http";
import { BrowserWindow, Notification } from "electron";
import type { ProjectManager } from "./project-manager.js";

interface ActivityEvent {
  id: string;
  timestamp: string;
  category: string;
  type: string;
  severity: string;
  title: string;
  detail?: string;
  worktreeId?: string;
  projectName?: string;
  metadata?: Record<string, unknown>;
}

interface ProjectNotificationPolicy {
  desktopEvents: Set<string>;
  fetchedAt: number;
}

interface ConfigResponse {
  config?: {
    activity?: {
      disabledEvents?: unknown;
      osNotificationEvents?: unknown;
    };
  };
}

const DEBOUNCE_MS = 10_000; // Max 1 notification per 10s per project
const RECONNECT_MS = 5_000;
const CONFIG_CACHE_TTL_MS = 5_000;
const DEFAULT_DESKTOP_EVENTS = new Set<string>(["agent_awaiting_input"]);

export class NotificationManager {
  private lastNotificationTime: Map<string, number> = new Map();
  private connections: Map<number, http.ClientRequest> = new Map();
  private reconnectTimers: Map<number, ReturnType<typeof setTimeout>> = new Map();
  private notificationPolicies: Map<number, ProjectNotificationPolicy> = new Map();
  private policyFetches: Map<number, Promise<ProjectNotificationPolicy>> = new Map();

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    private projectManager: ProjectManager,
  ) {}

  /**
   * Start listening to SSE activity streams for all open projects.
   * Call this after projects are loaded or when a project is added/removed.
   */
  syncProjectStreams(): void {
    const projects = this.projectManager.getProjects();
    const activePorts = new Set<number>();

    for (const project of projects) {
      if (project.status !== "running") continue;

      activePorts.add(project.port);

      // Already connected
      if (this.connections.has(project.port)) continue;

      this.connectToProject(project.port, project.name);
    }

    // Clean up disconnected projects
    for (const [port, req] of this.connections) {
      if (!activePorts.has(port)) {
        req.destroy();
        this.connections.delete(port);
        this.notificationPolicies.delete(port);
        this.policyFetches.delete(port);
        const timer = this.reconnectTimers.get(port);
        if (timer) {
          clearTimeout(timer);
          this.reconnectTimers.delete(port);
        }
      }
    }
  }

  private connectToProject(port: number, projectName: string): void {
    void this.refreshNotificationPolicy(port);

    const req = http.get(`http://localhost:${port}/api/events`, (res) => {
      let buffer = "";

      res.on("data", (chunk: Buffer) => {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        // Keep the last incomplete line in the buffer
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === "activity") {
                void this.handleActivityEvent(data.event as ActivityEvent, projectName, port);
              }
            } catch {
              // Ignore parse errors
            }
          }
        }
      });

      res.on("end", () => {
        this.connections.delete(port);
        this.scheduleReconnect(port, projectName);
      });
    });

    req.on("error", () => {
      this.connections.delete(port);
      this.scheduleReconnect(port, projectName);
    });

    this.connections.set(port, req);
  }

  private scheduleReconnect(port: number, projectName: string): void {
    // Only reconnect if project is still running
    const projects = this.projectManager.getProjects();
    const project = projects.find((p) => p.port === port);
    if (!project || project.status !== "running") return;

    const timer = setTimeout(() => {
      this.reconnectTimers.delete(port);
      this.connectToProject(port, projectName);
    }, RECONNECT_MS);

    this.reconnectTimers.set(port, timer);
  }

  private async handleActivityEvent(
    event: ActivityEvent,
    projectName: string,
    port: number,
  ): Promise<void> {
    const desktopEvents = await this.getDesktopEvents(port);
    if (!desktopEvents.has(event.type)) return;
    if (event.type === "agent_awaiting_input" && !this.isAgentAttentionEvent(event)) return;

    const mainWindow = this.getMainWindow();
    if (!mainWindow || mainWindow.isFocused()) return;

    // Debounce per project
    const now = Date.now();
    const lastTime = this.lastNotificationTime.get(projectName) ?? 0;
    if (now - lastTime < DEBOUNCE_MS) return;
    this.lastNotificationTime.set(projectName, now);

    // Fire native notification
    const notification = new Notification({
      title: `dawg - ${projectName}`,
      body: event.title,
      silent: false,
    });

    notification.on("click", () => {
      mainWindow?.show();
      mainWindow?.focus();
    });

    notification.show();
  }

  private toEventTypeSet(value: unknown): Set<string> {
    if (!Array.isArray(value)) return new Set();
    const set = new Set<string>();
    for (const item of value) {
      if (typeof item !== "string") continue;
      const normalized = item.trim();
      if (!normalized) continue;
      set.add(normalized);
    }
    return set;
  }

  private defaultPolicy(): ProjectNotificationPolicy {
    return {
      desktopEvents: new Set(DEFAULT_DESKTOP_EVENTS),
      fetchedAt: Date.now(),
    };
  }

  private async fetchNotificationPolicy(port: number): Promise<ProjectNotificationPolicy> {
    const fallback = this.defaultPolicy();

    try {
      const response = await fetch(`http://localhost:${port}/api/config`);
      if (!response.ok) return fallback;

      const body = (await response.json()) as ConfigResponse;
      const activity = body.config?.activity;
      if (!activity) return fallback;

      const disabledEvents = this.toEventTypeSet(activity.disabledEvents);
      const configuredDesktopEvents =
        activity.osNotificationEvents === undefined
          ? new Set(DEFAULT_DESKTOP_EVENTS)
          : this.toEventTypeSet(activity.osNotificationEvents);
      const desktopEvents = new Set(
        [...configuredDesktopEvents].filter((eventType) => !disabledEvents.has(eventType)),
      );

      return {
        desktopEvents,
        fetchedAt: Date.now(),
      };
    } catch {
      return fallback;
    }
  }

  private async refreshNotificationPolicy(port: number): Promise<ProjectNotificationPolicy> {
    const pending = this.policyFetches.get(port);
    if (pending) return pending;

    const fetchPromise = this.fetchNotificationPolicy(port)
      .then((policy) => {
        this.notificationPolicies.set(port, policy);
        return policy;
      })
      .finally(() => {
        this.policyFetches.delete(port);
      });

    this.policyFetches.set(port, fetchPromise);
    return fetchPromise;
  }

  private async getDesktopEvents(port: number): Promise<Set<string>> {
    const cached = this.notificationPolicies.get(port);
    const now = Date.now();
    if (cached && now - cached.fetchedAt < CONFIG_CACHE_TTL_MS) {
      return cached.desktopEvents;
    }

    const policy = await this.refreshNotificationPolicy(port);
    return policy.desktopEvents;
  }

  private isAgentAttentionEvent(event: ActivityEvent): boolean {
    if (event.category !== "agent") return false;

    const requiresUserAction = event.metadata?.requiresUserAction === true;
    const awaitingUserInput = event.metadata?.awaitingUserInput === true;
    if (event.type === "agent_awaiting_input") {
      return requiresUserAction || awaitingUserInput;
    }
    return requiresUserAction || awaitingUserInput;
  }

  dispose(): void {
    for (const req of this.connections.values()) {
      req.destroy();
    }
    this.connections.clear();

    for (const timer of this.reconnectTimers.values()) {
      clearTimeout(timer);
    }
    this.reconnectTimers.clear();
    this.notificationPolicies.clear();
    this.policyFetches.clear();
  }
}
