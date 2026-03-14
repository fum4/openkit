import path from "path";
import os from "os";

type LogFn = (id: number, message: string, contextJSON: string) => void;

export interface LoggerBindings {
  LoggerNew: (system: string, subsystem: string, level: string, format: string) => number;
  LoggerInfo: LogFn;
  LoggerWarn: LogFn;
  LoggerError: LogFn;
  LoggerDebug: LogFn;
  LoggerSuccess: LogFn;
  LoggerPlain: LogFn;
  LoggerFree: (id: number) => void;
  available: boolean;
}

let cached: LoggerBindings | null = null;

function loadNative(): LoggerBindings | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi");
    const platform = os.platform();
    const libName = platform === "darwin" ? "liblogger.dylib" : "liblogger.so";
    const libPath = path.join(__dirname, "../..", libName);
    const lib = koffi.load(libPath);

    return {
      LoggerNew: lib.func("LoggerNew", "int", ["string", "string", "string", "string"]),
      LoggerInfo: lib.func("LoggerInfo", "void", ["int", "string", "string"]),
      LoggerWarn: lib.func("LoggerWarn", "void", ["int", "string", "string"]),
      LoggerError: lib.func("LoggerError", "void", ["int", "string", "string"]),
      LoggerDebug: lib.func("LoggerDebug", "void", ["int", "string", "string"]),
      LoggerSuccess: lib.func("LoggerSuccess", "void", ["int", "string", "string"]),
      LoggerPlain: lib.func("LoggerPlain", "void", ["int", "string", "string"]),
      LoggerFree: lib.func("LoggerFree", "void", ["int"]),
      available: true,
    };
  } catch {
    return null;
  }
}

export function getBindings(): LoggerBindings {
  if (cached) return cached;

  const native = loadNative();

  if (native) {
    cached = native;
    return cached;
  }

  // Fallback: console-based implementation when Go library is unavailable
  const noop: LogFn = () => {};
  let nextId = 1;

  cached = {
    LoggerNew: () => nextId++,
    LoggerInfo: noop,
    LoggerWarn: noop,
    LoggerError: noop,
    LoggerDebug: noop,
    LoggerSuccess: noop,
    LoggerPlain: noop,
    LoggerFree: () => {},
    available: false,
  };

  return cached;
}
