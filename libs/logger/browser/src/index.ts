import { Logger as BaseLogger, type LoggerBindings } from "../../ts_utils";

// ── WASM bridge ────────────────────────────────────────────────────────

declare global {
  // Set by the Go WASM module after initialization.
  // eslint-disable-next-line no-var
  var __openkit_logger: LoggerBindings | undefined;
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

const resolve = (): LoggerBindings | null => (wasmReady && globalThis.__openkit_logger) || null;

// ── Public API ─────────────────────────────────────────────────────────

/**
 * Initialize the WASM logger module. Call once at app startup.
 * Subsequent calls are no-ops.
 */
export async function initLogger(): Promise<void> {
  await loadWasm();
}

/**
 * Browser logger backed by Go WASM module.
 * Before initLogger() completes, all log calls are no-ops.
 */
export class Logger extends BaseLogger {
  constructor(system: string, subsystem?: string) {
    super(resolve, system, subsystem, "info", "dev");
  }

  override get(subsystemName: string): Logger {
    return super.get(subsystemName) as Logger;
  }

  static setSink(serverUrl: string, projectName: string): void {
    const bindings = resolve();
    if (bindings) bindings.LoggerSetSink(serverUrl, projectName);
  }

  static closeSink(): void {
    const bindings = resolve();
    if (bindings) bindings.LoggerCloseSink();
  }
}

export type { LogLevel, LogContext } from "../../ts_utils";
