import path from "path";
import os from "os";

import type { LoggerBindings } from "../ts_utils";

let cached: LoggerBindings | null = null;

function loadBindings(): LoggerBindings | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const koffi = require("koffi");
    const platform = os.platform();
    const libName = platform === "darwin" ? "liblogger.dylib" : "liblogger.so";
    const libPath = path.join(__dirname, "../../../dist", libName);
    const lib = koffi.load(libPath);

    return {
      LoggerNew: lib.func("LoggerNew", "int", ["string", "string", "string", "string"]),
      LoggerInfo: lib.func("LoggerInfo", "void", ["int", "string", "string"]),
      LoggerWarn: lib.func("LoggerWarn", "void", ["int", "string", "string"]),
      LoggerError: lib.func("LoggerError", "void", ["int", "string", "string"]),
      LoggerDebug: lib.func("LoggerDebug", "void", ["int", "string", "string"]),
      LoggerSuccess: lib.func("LoggerSuccess", "void", ["int", "string", "string"]),
      LoggerStarted: lib.func("LoggerStarted", "void", ["int", "string", "string"]),
      LoggerPlain: lib.func("LoggerPlain", "void", ["int", "string", "string"]),
      LoggerFree: lib.func("LoggerFree", "void", ["int"]),
      LoggerSetSink: lib.func("LoggerSetSink", "void", ["string", "string"]),
      LoggerCloseSink: lib.func("LoggerCloseSink", "void", []),
    };
  } catch {
    return null;
  }
}

export function getBindings(): LoggerBindings | null {
  if (cached !== undefined && cached !== null) return cached;

  cached = loadBindings();
  return cached;
}
