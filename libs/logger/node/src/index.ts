import { getBindings } from "./bindings";
import { Logger as BaseLogger } from "../../ts_utils";

const resolve = () => getBindings();

/**
 * Node.js logger backed by Go shared library (koffi FFI).
 * Thin wrapper that binds the native resolver and adds env-aware defaults.
 */
export class Logger extends BaseLogger {
  constructor(system: string, subsystem?: string, level?: string, format?: string) {
    const envLevel = level || process.env.LOG_LEVEL || "info";
    const envFormat = format || (process.env.NODE_ENV === "production" ? "prod" : "dev");
    super(resolve, system, subsystem, envLevel, envFormat);
  }

  override get(subsystemName: string): Logger {
    return super.get(subsystemName) as Logger;
  }

  /** Configure the Go logger to POST entries to a server endpoint. */
  static setSink(serverUrl: string, projectName: string): void {
    const bindings = resolve();
    if (bindings) bindings.LoggerSetSink(serverUrl, projectName);
  }

  /** Flush remaining entries and stop the sink. */
  static closeSink(): void {
    const bindings = resolve();
    if (bindings) bindings.LoggerCloseSink();
  }
}

export type { LogLevel, LogContext } from "../../ts_utils";
export type LogFormat = "dev" | "prod";
