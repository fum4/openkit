import type { LoggerBindings } from "../ts_utils";

declare global {
  // Set by the Go WASM module after initialization.
  // eslint-disable-next-line no-var
  var __openkit_logger: LoggerBindings | undefined;
}

let wasmReady = false;
let wasmReadyPromise: Promise<void> | null = null;

async function loadBindings(): Promise<void> {
  if (wasmReady) return;
  if (wasmReadyPromise) return wasmReadyPromise;

  wasmReadyPromise = (async () => {
    try {
      // wasm_exec.js is built to dist/ by the WASM build target.
      // Vite handles the import; the Go class is added to globalThis by the shim.
      // @ts-ignore — runtime-only dynamic import of a build artifact
      await import("../../../dist/wasm_exec.js");
      const go = new (globalThis as any).Go();

      const wasmUrl = new URL("../../../dist/logger.wasm", import.meta.url).href;
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

/**
 * Initialize the WASM logger module. Call once at app startup.
 * Subsequent calls are no-ops.
 */
export async function initLogger(): Promise<void> {
  await loadBindings();
}

export function getBindings(): LoggerBindings | null {
  return (wasmReady && globalThis.__openkit_logger) || null;
}
