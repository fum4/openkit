import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "fs";
import path from "path";
import { nanoid } from "nanoid";

import { CONFIG_DIR_NAME } from "@openkit/shared/constants";
import type { CommandMonitorEvent } from "./runtime/command-monitor";
import type { FetchMonitorEvent } from "./runtime/fetch-monitor";

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

export interface OpsLogConfig {
  retentionDays?: number; // undefined = unlimited
  maxSizeMB?: number; // undefined = unlimited
}

const DEFAULT_CONFIG: OpsLogConfig = {};

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

function normalizeHttpMethod(value: string | undefined): string {
  if (!value) return "GET";
  const normalized = value.trim().toUpperCase();
  return normalized.length > 0 ? normalized : "GET";
}

export class OpsLog {
  private readonly filePath: string;
  private readonly listeners: Set<(event: OpsLogEvent) => void> = new Set();
  private config: OpsLogConfig;

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
  }

  dispose(): void {}

  updateConfig(config: Partial<OpsLogConfig>): void {
    this.config = { ...this.config, ...config };
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

    this.pruneIfNeeded();

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

  addFetchEvent(event: FetchMonitorEvent, projectName?: string): OpsLogEvent {
    const method = normalizeHttpMethod(event.method);
    const path = normalizeText(event.path, normalizeText(event.url, "/"));
    const statusCode = typeof event.statusCode === "number" ? event.statusCode : undefined;

    const isFailure =
      event.phase === "failure" || (typeof statusCode === "number" && statusCode >= 400);
    const isServerFailure = typeof statusCode === "number" && statusCode >= 500;
    const level: OpsLogLevel =
      event.phase === "failure" || isServerFailure ? "error" : isFailure ? "warning" : "info";
    const status: OpsLogStatus = isFailure ? "failed" : "succeeded";

    const message =
      event.phase === "failure"
        ? `${method} ${path} -> ${event.error ?? "request failed"}`
        : `${method} ${path} -> ${statusCode ?? 0}`;

    return this.addEvent({
      source: "http",
      action: "http.client",
      message,
      level,
      status,
      runId: event.runId,
      projectName,
      metadata: {
        direction: "outbound",
        method,
        url: event.url,
        path,
        ...(typeof statusCode === "number" ? { statusCode } : {}),
        durationMs: event.durationMs,
        source: event.source,
        ...(event.requestContentType ? { requestContentType: event.requestContentType } : {}),
        ...(event.requestPayload ? { requestPayload: event.requestPayload } : {}),
        ...(event.requestPayloadTruncated ? { requestPayloadTruncated: true } : {}),
        ...(event.requestPayloadOmitted ? { requestPayloadOmitted: true } : {}),
        ...(event.requestPayloadError ? { requestPayloadError: event.requestPayloadError } : {}),
        ...(event.requestTransport ? { requestTransport: event.requestTransport } : {}),
        ...(event.responseContentType ? { responseContentType: event.responseContentType } : {}),
        ...(event.responsePayload ? { responsePayload: event.responsePayload } : {}),
        ...(event.responsePayloadTruncated ? { responsePayloadTruncated: true } : {}),
        ...(event.responsePayloadOmitted ? { responsePayloadOmitted: true } : {}),
        ...(event.responsePayloadError ? { responsePayloadError: event.responsePayloadError } : {}),
        ...(event.responseTransport ? { responseTransport: event.responseTransport } : {}),
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
      // Time-based pruning (skip if retentionDays is undefined)
      if (this.config.retentionDays !== undefined) {
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
      }

      // Size-based pruning
      this.pruneBySizeSync();
    } catch {
      // Ignore pruning failures.
    }
  }

  private pruneIfNeeded(): void {
    if (this.config.maxSizeMB === undefined) return;
    if (!existsSync(this.filePath)) return;

    try {
      const stat = statSync(this.filePath);
      const maxBytes = this.config.maxSizeMB * 1024 * 1024;
      if (stat.size > maxBytes) {
        this.pruneBySizeSync();
      }
    } catch {
      // Ignore errors.
    }
  }

  private pruneBySizeSync(): void {
    if (this.config.maxSizeMB === undefined) return;
    if (!existsSync(this.filePath)) return;

    try {
      const maxBytes = this.config.maxSizeMB * 1024 * 1024;
      const content = readFileSync(this.filePath, "utf-8");
      const lines = content
        .split("\n")
        .filter((line) => line.trim())
        .filter((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });

      // Keep entries from newest to oldest until we're within the size limit.
      // Lines are stored oldest-first, so we iterate from the end.
      const kept: string[] = [];
      let totalBytes = 0;

      for (let i = lines.length - 1; i >= 0; i--) {
        const lineBytes = Buffer.byteLength(lines[i] + "\n", "utf-8");
        if (totalBytes + lineBytes > maxBytes) break;
        kept.unshift(lines[i]);
        totalBytes += lineBytes;
      }

      writeFileSync(this.filePath, kept.join("\n") + (kept.length > 0 ? "\n" : ""));
    } catch {
      // Ignore pruning failures.
    }
  }

  estimateImpact(proposed: Partial<OpsLogConfig>): {
    entriesToRemove: number;
    bytesToRemove: number;
    currentEntries: number;
    currentBytes: number;
  } {
    const zero = { entriesToRemove: 0, bytesToRemove: 0, currentEntries: 0, currentBytes: 0 };

    if (!existsSync(this.filePath)) return zero;

    try {
      const content = readFileSync(this.filePath, "utf-8");
      const allLines = content
        .split("\n")
        .filter((line) => line.trim())
        .filter((line) => {
          try {
            JSON.parse(line);
            return true;
          } catch {
            return false;
          }
        });

      const currentEntries = allLines.length;
      const currentBytes = Buffer.byteLength(
        allLines.join("\n") + (allLines.length > 0 ? "\n" : ""),
        "utf-8",
      );

      // Simulate time-based pruning with proposed config
      const mergedConfig: OpsLogConfig = { ...this.config, ...proposed };
      let surviving = allLines;

      if (mergedConfig.retentionDays !== undefined) {
        const cutoff = Date.now() - mergedConfig.retentionDays * 24 * 60 * 60 * 1000;
        surviving = surviving.filter((line) => {
          try {
            const parsed = JSON.parse(line) as OpsLogEvent;
            return new Date(parsed.timestamp).getTime() > cutoff;
          } catch {
            return false;
          }
        });
      }

      // Simulate size-based pruning with proposed config
      if (mergedConfig.maxSizeMB !== undefined) {
        const maxBytes = mergedConfig.maxSizeMB * 1024 * 1024;
        const kept: string[] = [];
        let totalBytes = 0;

        for (let i = surviving.length - 1; i >= 0; i--) {
          const lineBytes = Buffer.byteLength(surviving[i] + "\n", "utf-8");
          if (totalBytes + lineBytes > maxBytes) break;
          kept.unshift(surviving[i]);
          totalBytes += lineBytes;
        }

        surviving = kept;
      }

      const survivingBytes = Buffer.byteLength(
        surviving.join("\n") + (surviving.length > 0 ? "\n" : ""),
        "utf-8",
      );

      return {
        entriesToRemove: currentEntries - surviving.length,
        bytesToRemove: currentBytes - survivingBytes,
        currentEntries,
        currentBytes,
      };
    } catch {
      return zero;
    }
  }
}
