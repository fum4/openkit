import type { LogLevel, LogContext } from "./types";

export interface LogEntry {
  timestamp: string;
  system: string;
  subsystem: string;
  level: LogLevel;
  message: string;
  domain?: string;
  metadata?: Record<string, unknown>;
}

export type LogSink = (entry: LogEntry) => void;

// ── WASM bridge ────────────────────────────────────────────────────────

interface WasmLoggerAPI {
  LoggerNew: (system: string, subsystem: string, level: string, format: string) => number;
  LoggerInfo: (id: number, message: string, contextJSON: string) => void;
  LoggerWarn: (id: number, message: string, contextJSON: string) => void;
  LoggerError: (id: number, message: string, contextJSON: string) => void;
  LoggerDebug: (id: number, message: string, contextJSON: string) => void;
  LoggerSuccess: (id: number, message: string, contextJSON: string) => void;
  LoggerPlain: (id: number, message: string, contextJSON: string) => void;
  LoggerFree: (id: number) => void;
  LoggerSetSink: (serverUrl: string, projectName: string) => void;
  LoggerCloseSink: () => void;
}

declare global {
  // Set by the Go WASM module after initialization.
  // eslint-disable-next-line no-var
  var __openkit_logger: WasmLoggerAPI | undefined;
}

let wasmReady = false;
let wasmReadyPromise: Promise<void> | null = null;

async function loadWasm(): Promise<void> {
  if (wasmReady) return;
  if (wasmReadyPromise) return wasmReadyPromise;

  wasmReadyPromise = (async () => {
    try {
      // wasm_exec.js is bundled alongside this module (copied by the WASM build script).
      // Vite handles the import; the Go class is added to globalThis by the shim.
      await import("./wasm_exec.js");
      const go = new (globalThis as any).Go();

      const wasmUrl = new URL("./logger.wasm", import.meta.url).href;
      const result = await WebAssembly.instantiateStreaming(fetch(wasmUrl), go.importObject);
      go.run(result.instance);

      wasmReady = true;
    } catch {
      // WASM loading failed (e.g., missing build artifacts).
      // Logger methods become no-ops.
    }
  })();

  return wasmReadyPromise;
}

function getApi(): WasmLoggerAPI {
  if (!globalThis.__openkit_logger) {
    throw new Error("WASM logger not initialized — call initLogger() first");
  }
  return globalThis.__openkit_logger;
}

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Initialize the WASM logger module. Call once at app startup.
 * Subsequent calls are no-ops.
 */
export async function initLogger(): Promise<void> {
  await loadWasm();
}

export class Logger {
  private handle: number;
  private system: string;
  private subsystem: string;
  private subsystemCache: Map<string, Logger> = new Map();

  constructor(system: string, subsystem?: string) {
    this.system = system;
    this.subsystem = subsystem ?? "";

    if (!wasmReady) {
      // WASM not loaded yet — store a placeholder handle.
      // Calls before init will be no-ops (handle 0 is invalid in Go).
      this.handle = 0;
      return;
    }

    this.handle = getApi().LoggerNew(system, this.subsystem, "info", "dev");
  }

  /** Re-initialize after WASM is loaded (called internally). */
  private ensureHandle(): void {
    if (this.handle !== 0 || !wasmReady) return;
    this.handle = getApi().LoggerNew(this.system, this.subsystem, "info", "dev");
  }

  get(subsystemName: string): Logger {
    const key = subsystemName.toUpperCase();
    if (!this.subsystemCache.has(key)) {
      this.subsystemCache.set(key, new Logger(this.system, key));
    }
    return this.subsystemCache.get(key)!;
  }

  info(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerInfo(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  warn(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerWarn(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  error(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerError(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  debug(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerDebug(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  success(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerSuccess(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  plain(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerPlain(this.handle, message, JSON.stringify(normalizeContext(context) ?? {}));
  }

  cleanup(): void {
    if (this.handle === 0) return;
    getApi().LoggerFree(this.handle);
    this.handle = 0;
  }

  static setSink(serverUrl: string, projectName: string): void {
    if (!wasmReady) return;
    getApi().LoggerSetSink(serverUrl, projectName);
  }

  static closeSink(): void {
    if (!wasmReady) return;
    getApi().LoggerCloseSink();
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

export type { LogLevel, LogContext };
