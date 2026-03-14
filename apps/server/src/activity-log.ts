import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync, statSync } from "fs";
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
  }

  dispose(): void {
    // No-op: kept for interface compatibility
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

    this.pruneIfNeeded();

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
      const content = readFileSync(this.filePath, "utf-8");

      let lines = content.split("\n").filter((line) => line.trim());

      // Time-based pruning (only if retentionDays is set)
      if (this.config.retentionDays !== undefined) {
        const cutoff = Date.now() - this.config.retentionDays * 24 * 60 * 60 * 1000;
        lines = lines.filter((line) => {
          try {
            const event = JSON.parse(line) as ActivityEvent;
            return new Date(event.timestamp).getTime() > cutoff;
          } catch {
            return false;
          }
        });
      } else {
        // Still discard corrupt lines
        lines = lines.filter((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });
      }

      writeFileSync(this.filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));

      // Size-based pruning after time-based
      if (this.config.maxSizeMB !== undefined) {
        this.pruneBySizeSync();
      }
    } catch {
      // Ignore prune errors
    }
  }

  private pruneIfNeeded(): void {
    if (this.config.maxSizeMB === undefined) return;

    try {
      const stat = statSync(this.filePath);
      const limitBytes = this.config.maxSizeMB * 1024 * 1024;
      if (stat.size > limitBytes) {
        this.pruneBySizeSync();
      }
    } catch {
      // Ignore stat errors
    }
  }

  private pruneBySizeSync(): void {
    try {
      if (!existsSync(this.filePath)) return;

      const content = readFileSync(this.filePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());
      const limitBytes = (this.config.maxSizeMB ?? 0) * 1024 * 1024;

      // Keep entries from newest to oldest that fit within the limit
      // Lines are assumed to be in chronological order (oldest first)
      // We keep the newest entries
      let totalBytes = 0;
      const kept: string[] = [];

      for (let i = lines.length - 1; i >= 0; i--) {
        const lineBytes = Buffer.byteLength(lines[i]! + "\n", "utf-8");
        if (totalBytes + lineBytes <= limitBytes) {
          kept.unshift(lines[i]!);
          totalBytes += lineBytes;
        } else {
          break;
        }
      }

      writeFileSync(this.filePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
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

  estimateImpact(proposed: { retentionDays?: number; maxSizeMB?: number }): {
    entriesToRemove: number;
    bytesToRemove: number;
    currentEntries: number;
    currentBytes: number;
  } {
    if (!existsSync(this.filePath)) {
      return { entriesToRemove: 0, bytesToRemove: 0, currentEntries: 0, currentBytes: 0 };
    }

    try {
      const content = readFileSync(this.filePath, "utf-8");
      const lines = content.split("\n").filter((line) => line.trim());

      const currentEntries = lines.length;
      const currentBytes = Buffer.byteLength(content, "utf-8");

      // Simulate pruning with proposed config
      let remaining = lines;

      // Time-based simulation
      if (proposed.retentionDays !== undefined) {
        const cutoff = Date.now() - proposed.retentionDays * 24 * 60 * 60 * 1000;
        remaining = remaining.filter((line) => {
          try {
            const event = JSON.parse(line) as ActivityEvent;
            return new Date(event.timestamp).getTime() > cutoff;
          } catch {
            return false;
          }
        });
      }

      // Size-based simulation
      if (proposed.maxSizeMB !== undefined) {
        const limitBytes = proposed.maxSizeMB * 1024 * 1024;
        let totalBytes = 0;
        const kept: string[] = [];

        for (let i = remaining.length - 1; i >= 0; i--) {
          const lineBytes = Buffer.byteLength(remaining[i]! + "\n", "utf-8");
          if (totalBytes + lineBytes <= limitBytes) {
            kept.unshift(remaining[i]!);
            totalBytes += lineBytes;
          } else {
            break;
          }
        }

        remaining = kept;
      }

      const remainingContent = remaining.join("\n") + (remaining.length > 0 ? "\n" : "");
      const remainingBytes = Buffer.byteLength(remainingContent, "utf-8");

      return {
        entriesToRemove: currentEntries - remaining.length,
        bytesToRemove: currentBytes - remainingBytes,
        currentEntries,
        currentBytes,
      };
    } catch {
      return { entriesToRemove: 0, bytesToRemove: 0, currentEntries: 0, currentBytes: 0 };
    }
  }
}
