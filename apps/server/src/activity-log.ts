import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import type {
  ActivityEvent,
  ActivityCategory,
  ActivitySeverity,
  ActivityConfig,
} from "./activity-event";
import { DEFAULT_ACTIVITY_CONFIG } from "./activity-event";

export class ActivityLog {
  private filePath: string;
  private listeners: Set<(event: ActivityEvent) => void> = new Set();
  private config: ActivityConfig;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(configDir: string, config?: Partial<ActivityConfig>) {
    const OpenKitDir = path.join(configDir, CONFIG_DIR_NAME);
    if (!existsSync(OpenKitDir)) {
      mkdirSync(OpenKitDir, { recursive: true });
    }
    this.filePath = path.join(OpenKitDir, "activity.jsonl");
    this.config = {
      ...DEFAULT_ACTIVITY_CONFIG,
      ...config,
      categories: {
        ...DEFAULT_ACTIVITY_CONFIG.categories,
        ...config?.categories,
      },
      disabledEvents: config?.disabledEvents ?? DEFAULT_ACTIVITY_CONFIG.disabledEvents,
      toastEvents: config?.toastEvents ?? DEFAULT_ACTIVITY_CONFIG.toastEvents,
      osNotificationEvents:
        config?.osNotificationEvents ?? DEFAULT_ACTIVITY_CONFIG.osNotificationEvents,
    };

    // Prune on startup
    this.prune();

    // Prune every hour
    this.pruneTimer = setInterval(() => this.prune(), 60 * 60 * 1000);
  }

  dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  subscribe(listener: (event: ActivityEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addEvent(partial: {
    category: ActivityCategory;
    type: string;
    severity: ActivitySeverity;
    title: string;
    detail?: string;
    worktreeId?: string;
    projectName?: string;
    metadata?: Record<string, unknown>;
    groupKey?: string;
  }): ActivityEvent {
    const event: ActivityEvent = {
      id: nanoid(),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    // Check if category is enabled
    if (!this.config.categories[event.category]) {
      return event;
    }
    if (this.config.disabledEvents.includes(event.type)) {
      return event;
    }

    // Persist to disk
    try {
      appendFileSync(this.filePath, JSON.stringify(event) + "\n");
    } catch {
      // Non-critical — event is still emitted to listeners
    }

    // Notify SSE listeners
    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore listener errors
      }
    });

    return event;
  }

  getEvents(filter?: {
    since?: string;
    category?: ActivityCategory;
    limit?: number;
  }): ActivityEvent[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const content = readFileSync(this.filePath, "utf-8");
      let events: ActivityEvent[] = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as ActivityEvent;
          } catch {
            return null;
          }
        })
        .filter((e): e is ActivityEvent => e !== null);

      if (filter?.since) {
        const sinceDate = new Date(filter.since).getTime();
        events = events.filter((e) => new Date(e.timestamp).getTime() > sinceDate);
      }

      if (filter?.category) {
        events = events.filter((e) => e.category === filter.category);
      }

      // Sort newest first
      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (filter?.limit) {
        events = events.slice(0, filter.limit);
      }

      return events;
    } catch {
      return [];
    }
  }

  getRecentEvents(count: number = 50): ActivityEvent[] {
    return this.getEvents({ limit: count });
  }

  prune(): void {
    if (!existsSync(this.filePath)) return;

    try {
      const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
      const content = readFileSync(this.filePath, "utf-8");
      const lines = content.split("\n").filter((line) => {
        if (!line.trim()) return false;
        try {
          const event = JSON.parse(line) as ActivityEvent;
          return new Date(event.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });

      writeFileSync(this.filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    } catch {
      // Ignore prune errors
    }
  }

  updateConfig(config: Partial<ActivityConfig>): void {
    this.config = {
      ...this.config,
      ...config,
      categories: {
        ...this.config.categories,
        ...config.categories,
      },
      disabledEvents: config.disabledEvents ?? this.config.disabledEvents,
      toastEvents: config.toastEvents ?? this.config.toastEvents,
      osNotificationEvents: config.osNotificationEvents ?? this.config.osNotificationEvents,
    };
  }

  getConfig(): ActivityConfig {
    return this.config;
  }

  isToastEvent(eventType: string): boolean {
    return this.config.toastEvents.includes(eventType);
  }

  isOsNotificationEvent(eventType: string): boolean {
    return this.config.osNotificationEvents.includes(eventType);
  }
}
