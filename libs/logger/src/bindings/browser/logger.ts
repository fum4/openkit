import { getBindings, initLogger } from "./bindings";
import { Logger as BaseLogger } from "../ts_utils";

export { initLogger };

/**
 * Browser logger backed by Go WASM module.
 * Before initLogger() completes, all log calls are no-ops.
 */
export class Logger extends BaseLogger {
  constructor(system: string, subsystem?: string) {
    super(getBindings, system, subsystem, "info", "dev");
  }

  override get(subsystemName: string): Logger {
    return super.get(subsystemName) as Logger;
  }

  static setSink(serverUrl: string, projectName: string): void {
    const bindings = getBindings();
    if (bindings) bindings.LoggerSetSink(serverUrl, projectName);
  }

  static closeSink(): void {
    const bindings = getBindings();
    if (bindings) bindings.LoggerCloseSink();
  }
}

export type { LogLevel, LogContext } from "../ts_utils";
