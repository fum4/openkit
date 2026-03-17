/** Shared TypeScript utilities for Node and browser logger bindings. */

// ── Types ─────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = { domain: string; error?: unknown } & Record<string, unknown>;

// ── Bindings interface ────────────────────────────────────────────────

type LogFn = (id: number, message: string, contextJSON: string) => void;

/** Go logger API surface — implemented by koffi (Node) and WASM (browser). */
export interface LoggerBindings {
  LoggerNew: (system: string, subsystem: string, level: string, format: string) => number;
  LoggerInfo: LogFn;
  LoggerWarn: LogFn;
  LoggerError: LogFn;
  LoggerDebug: LogFn;
  LoggerSuccess: LogFn;
  LoggerStarted: LogFn;
  LoggerPlain: LogFn;
  LoggerFree: (id: number) => void;
  LoggerSetSink: (serverUrl: string, projectName: string) => void;
  LoggerCloseSink: () => void;
}

/**
 * Resolves the Go logger bindings. Returns null when bindings are not
 * available (e.g., WASM not loaded yet, native lib missing).
 */
export type BindingsResolver = () => LoggerBindings | null;

// ── Context normalization ─────────────────────────────────────────────

/**
 * Normalize a LogContext before passing to Go as JSON.
 * Converts Error objects to { message, stack } since Go can't inspect JS Error instances.
 */
export function normalizeContext(
  context: LogContext | undefined,
): Record<string, unknown> | undefined {
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

// ── Logger class ──────────────────────────────────────────────────────

export class Logger {
  private handle: number = 0;
  private system: string;
  private subsystem: string;
  private level: string;
  private format: string;
  private resolve: BindingsResolver;
  private subsystemCache: Map<string, Logger> = new Map();

  constructor(
    resolve: BindingsResolver,
    system: string,
    subsystem?: string,
    level?: string,
    format?: string,
  ) {
    this.resolve = resolve;
    this.system = system;
    this.subsystem = subsystem ?? "";
    this.level = level ?? "info";
    this.format = format ?? "dev";

    const bindings = resolve();
    if (bindings) {
      this.handle = bindings.LoggerNew(system, this.subsystem, this.level, this.format);
    }
  }

  /** Ensure we have a valid Go handle (handles lazy initialization, e.g. WASM). */
  private ensureHandle(): LoggerBindings | null {
    const bindings = this.resolve();
    if (!bindings) return null;
    if (this.handle === 0) {
      this.handle = bindings.LoggerNew(this.system, this.subsystem, this.level, this.format);
    }
    return bindings;
  }

  private call(fn: (b: LoggerBindings) => LogFn, message: string, context?: LogContext): void {
    const bindings = this.ensureHandle();
    if (!bindings) return;
    fn(bindings)(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  get(subsystemName: string): Logger {
    const key = subsystemName.toUpperCase();
    if (!this.subsystemCache.has(key)) {
      this.subsystemCache.set(
        key,
        new Logger(this.resolve, this.system, key, this.level, this.format),
      );
    }
    return this.subsystemCache.get(key)!;
  }

  /** Convenience: level info, status info */
  info(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerInfo, message, context);
  }

  /** Convenience: level warn, status info */
  warn(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerWarn, message, context);
  }

  /** Convenience: level error, status failed */
  error(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerError, message, context);
  }

  /** Convenience: level debug, status info */
  debug(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerDebug, message, context);
  }

  /** Convenience: level info, status success (green ● prefix) */
  success(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerSuccess, message, context);
  }

  /** Convenience: level info, status started */
  started(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerStarted, message, context);
  }

  /** Convenience: level info, status info (no prefix) */
  plain(message: string, context?: LogContext): void {
    this.call((b) => b.LoggerPlain, message, context);
  }

  cleanup(): void {
    if (this.handle === 0) return;
    const bindings = this.resolve();
    if (bindings) bindings.LoggerFree(this.handle);
    this.handle = 0;
  }
}
