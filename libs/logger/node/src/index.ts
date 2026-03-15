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

  /**
   * Configure the Go logger to POST entries to a server endpoint.
   * All log calls from all Logger instances will be batched and sent
   * to {serverUrl}/api/client-logs periodically.
   */
  static setSink(serverUrl: string, projectName: string): void {
    const bindings = getBindings();
    bindings.LoggerSetSink(serverUrl, projectName);
  }

  /** Flush remaining entries and stop the sink. */
  static closeSink(): void {
    const bindings = getBindings();
    bindings.LoggerCloseSink();
  }

  get(subsystemName: string): Logger {
    const key = subsystemName.toUpperCase();

    if (!this.subsystemCache.has(key)) {
      this.subsystemCache.set(key, new Logger(this.system, key, this.level, this.format));
    }

    return this.subsystemCache.get(key)!;
  }

  info(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerInfo(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(message, ...(ctx ? [ctx] : []));
    }

    this.dispatch("info", message, ctx);
  }

  warn(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerWarn(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.warn(message, ...(ctx ? [ctx] : []));
    }

    this.dispatch("warn", message, ctx);
  }

  error(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerError(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.error(message, ...(ctx ? [ctx] : []));
    }

    this.dispatch("error", message, ctx);
  }

  debug(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerDebug(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.debug(message, ...(ctx ? [ctx] : []));
    }

    this.dispatch("debug", message, ctx);
  }

  success(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerSuccess(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(`● ${message}`, ...(ctx ? [ctx] : []));
    }

    this.dispatch("info", message, ctx);
  }

  plain(message: string, context?: LogContext): void {
    const ctx = normalizeContext(context);
    const bindings = getBindings();
    bindings.LoggerPlain(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(message, ...(ctx ? [ctx] : []));
    }

    this.dispatch("info", message, ctx);
  }

  cleanup(): void {
    const bindings = getBindings();
    bindings.LoggerFree(this.handle);
  }

  private dispatch(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (sinks.length === 0) return;

    let domain: string | undefined;
    let cleanMetadata: Record<string, unknown> | undefined;
    if (context) {
      const { domain: d, ...rest } = context;
      domain = typeof d === "string" ? d : undefined;
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

function normalizeContext(context: LogContext | undefined): Record<string, unknown> | undefined {
  if (!context) return undefined;
  if (!("error" in context) || typeof context.error === "string" || context.error === undefined) {
    return context;
  }
  const { error, ...rest } = context;
  if (error instanceof Error) {
    return { ...rest, error: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  return { ...rest, error: String(error) };
}

export type { LogLevel, LogFormat, LogContext };
