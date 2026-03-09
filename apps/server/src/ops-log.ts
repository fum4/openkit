import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import type { CommandMonitorEvent } from "./runtime/command-monitor";

export type OpsLogLevel = "debug" | "info" | "warning" | "error";
export type OpsLogStatus = "started" | "succeeded" | "failed" | "info";

export interface OpsCommandPayload {
  command: string;
  args: string[];
  cwd?: string;
  pid?: number | null;
  exitCode?: number | null;
  signal?: string | null;
  durationMs?: number;
  stdout?: string;
  stderr?: string;
}

export interface OpsLogEvent {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  message: string;
  level: OpsLogLevel;
  status: OpsLogStatus;
  runId?: string;
  worktreeId?: string;
  projectName?: string;
  command?: OpsCommandPayload;
  metadata?: Record<string, unknown>;
}

interface OpsLogConfig {
  retentionDays: number;
}

const DEFAULT_CONFIG: OpsLogConfig = {
  retentionDays: 7,
};

function toLogLevel(severity: "error" | "warning" | "info"): OpsLogLevel {
  if (severity === "error") return "error";
  if (severity === "warning") return "warning";
  return "info";
}

function normalizeText(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : fallback;
}

export class OpsLog {
  private readonly filePath: string;
  private readonly listeners: Set<(event: OpsLogEvent) => void> = new Set();
  private readonly config: OpsLogConfig;
  private pruneTimer: ReturnType<typeof setInterval> | null = null;

  constructor(configDir: string, config?: Partial<OpsLogConfig>) {
    const openkitDir = path.join(configDir, CONFIG_DIR_NAME);
    if (!existsSync(openkitDir)) {
      mkdirSync(openkitDir, { recursive: true });
    }

    this.filePath = path.join(openkitDir, "ops-log.jsonl");
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
    };

    this.prune();
    this.pruneTimer = setInterval(() => this.prune(), 60 * 60 * 1000);
  }

  dispose(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
  }

  subscribe(listener: (event: OpsLogEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  addEvent(partial: Omit<OpsLogEvent, "id" | "timestamp">): OpsLogEvent {
    const event: OpsLogEvent = {
      id: nanoid(),
      timestamp: new Date().toISOString(),
      ...partial,
    };

    try {
      appendFileSync(this.filePath, JSON.stringify(event) + "\n");
    } catch {
      // Non-critical: event still streams to listeners.
    }

    this.listeners.forEach((listener) => {
      try {
        listener(event);
      } catch {
        // Ignore listener errors.
      }
    });

    return event;
  }

  addCommandEvent(event: CommandMonitorEvent, projectName?: string): OpsLogEvent {
    const isStart = event.phase === "start";
    const isFailure = event.phase === "failure";

    const status: OpsLogStatus = isStart ? "started" : isFailure ? "failed" : "succeeded";
    const level: OpsLogLevel = isStart ? "info" : isFailure ? "error" : "info";

    const commandText = [event.command, ...event.args].join(" ");
    const message = isStart
      ? `Started: ${commandText}`
      : isFailure
        ? `Failed: ${commandText}${event.error ? ` (${event.error})` : ""}`
        : `Succeeded: ${commandText}`;

    return this.addEvent({
      source: normalizeText(event.source, "command"),
      action: "command.exec",
      message,
      level,
      status,
      runId: event.runId,
      projectName,
      command: {
        command: event.command,
        args: event.args,
        cwd: event.cwd,
        pid: event.pid ?? null,
        exitCode: event.exitCode ?? null,
        signal: event.signal ?? null,
        durationMs: event.durationMs,
        stdout: event.stdout,
        stderr: event.stderr,
      },
      metadata: {
        phase: event.phase,
        ...(event.error ? { error: event.error } : {}),
      },
    });
  }

  addNotificationEvent(
    message: string,
    level: "error" | "warning" | "info",
    metadata?: Record<string, unknown>,
  ): OpsLogEvent {
    return this.addEvent({
      source: "notification",
      action: "notification.emit",
      message,
      level: toLogLevel(level),
      status: level === "error" ? "failed" : "info",
      metadata,
    });
  }

  getEvents(filter?: {
    since?: string;
    level?: OpsLogLevel;
    status?: OpsLogStatus;
    source?: string;
    search?: string;
    limit?: number;
  }): OpsLogEvent[] {
    if (!existsSync(this.filePath)) return [];

    try {
      const content = readFileSync(this.filePath, "utf-8");
      let events: OpsLogEvent[] = content
        .split("\n")
        .filter((line) => line.trim())
        .map((line) => {
          try {
            return JSON.parse(line) as OpsLogEvent;
          } catch {
            return null;
          }
        })
        .filter((entry): entry is OpsLogEvent => entry !== null);

      if (filter?.since) {
        const sinceMs = new Date(filter.since).getTime();
        events = events.filter((entry) => new Date(entry.timestamp).getTime() > sinceMs);
      }

      if (filter?.level) {
        events = events.filter((entry) => entry.level === filter.level);
      }

      if (filter?.status) {
        events = events.filter((entry) => entry.status === filter.status);
      }

      if (filter?.source) {
        const sourceFilter = filter.source.trim();
        if (sourceFilter.length > 0) {
          events = events.filter((entry) => entry.source.includes(sourceFilter));
        }
      }

      if (filter?.search) {
        const query = filter.search.trim().toLowerCase();
        if (query.length > 0) {
          events = events.filter((entry) => {
            const haystack = [
              entry.message,
              entry.source,
              entry.action,
              entry.command?.command,
              entry.command?.args.join(" "),
              entry.command?.cwd,
              entry.worktreeId,
              entry.projectName,
            ]
              .filter((value): value is string => typeof value === "string" && value.length > 0)
              .join("\n")
              .toLowerCase();
            return haystack.includes(query);
          });
        }
      }

      events.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

      if (filter?.limit && Number.isFinite(filter.limit)) {
        const limit = Math.max(1, Math.min(filter.limit, 5000));
        events = events.slice(0, limit);
      }

      return events;
    } catch {
      return [];
    }
  }

  getRecentEvents(count = 200): OpsLogEvent[] {
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
          const parsed = JSON.parse(line) as OpsLogEvent;
          return new Date(parsed.timestamp).getTime() > cutoff;
        } catch {
          return false;
        }
      });

      writeFileSync(this.filePath, lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    } catch {
      // Ignore pruning failures.
    }
  }
}
