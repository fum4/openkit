import { getBindings } from "./bindings";
import type { LogLevel, LogFormat, LogContext } from "./types";

export interface LogEntry {
  timestamp: Date;
  system: string;
  subsystem: string;
  level: LogLevel;
  message: string;
  domain?: string;
  metadata?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

const sinks: LogSink[] = [];

export class Logger {
  private handle: number;
  private system: string;
  private subsystem: string;
  private level?: LogLevel;
  private format?: LogFormat;
  private subsystemCache: Map<string, Logger> = new Map();
  private native: boolean;

  constructor(system: string, subsystem?: string, level?: LogLevel, format?: LogFormat) {
    this.system = system;
    this.subsystem = subsystem || "";
    this.level = level;
    this.format = format;

    const bindings = getBindings();
    this.native = bindings.available;

    const envLevel = level || (process.env.LOG_LEVEL as LogLevel) || "info";
    const envFormat = format || (process.env.NODE_ENV === "production" ? "prod" : "dev");

    this.handle = bindings.LoggerNew(system, this.subsystem, envLevel, envFormat);
  }

  /**
   * Register a sink that receives every log entry from every Logger instance.
   * Used by the server to pipe logs into OpsLog for the debug UI.
   * Returns an unsubscribe function.
   */
  static addSink(sink: LogSink): () => void {
    sinks.push(sink);
    return () => {
      const idx = sinks.indexOf(sink);
      if (idx >= 0) sinks.splice(idx, 1);
    };
  }

  get(subsystemName: string): Logger {
    const key = subsystemName.toUpperCase();

    if (!this.subsystemCache.has(key)) {
      this.subsystemCache.set(key, new Logger(this.system, key, this.level, this.format));
    }

    return this.subsystemCache.get(key)!;
  }

  info(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerInfo(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(message, ...args);
    }

    this.dispatch("info", message, ctx);
  }

  warn(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerWarn(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.warn(message, ...args);
    }

    this.dispatch("warn", message, ctx);
  }

  error(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerError(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.error(message, ...args);
    }

    this.dispatch("error", message, ctx);
  }

  debug(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerDebug(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.debug(message, ...args);
    }

    this.dispatch("debug", message, ctx);
  }

  success(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerSuccess(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(`● ${message}`, ...args);
    }

    this.dispatch("info", message, ctx);
  }

  plain(message: string, ...args: unknown[]): void {
    const ctx = extractContext(args);
    const bindings = getBindings();
    bindings.LoggerPlain(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(message, ...args);
    }

    this.dispatch("info", message, ctx);
  }

  cleanup(): void {
    const bindings = getBindings();
    bindings.LoggerFree(this.handle);
  }

  private dispatch(level: LogLevel, message: string, metadata?: Record<string, unknown>): void {
    if (sinks.length === 0) return;

    let domain: string | undefined;
    let cleanMetadata = metadata;
    if (metadata && typeof metadata.domain === "string") {
      domain = metadata.domain;
      const { domain: _, ...rest } = metadata;
      cleanMetadata = Object.keys(rest).length > 0 ? rest : undefined;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      system: this.system,
      subsystem: this.subsystem,
      level,
      message,
      domain,
      metadata: cleanMetadata,
    };

    for (const sink of sinks) {
      try {
        sink(entry);
      } catch {
        // Sink failures are non-fatal
      }
    }
  }
}

function extractContext(args: unknown[]): Record<string, unknown> | undefined {
  if (args.length === 0) return undefined;
  if (
    args.length === 1 &&
    typeof args[0] === "object" &&
    args[0] !== null &&
    !(args[0] instanceof Error)
  ) {
    return args[0] as Record<string, unknown>;
  }
  if (args.some((a) => a instanceof Error)) {
    return { errors: args.filter((a) => a instanceof Error).map((a) => (a as Error).message) };
  }
  return { args: args.map((a) => String(a)) };
}

export type { LogLevel, LogFormat, LogContext };
