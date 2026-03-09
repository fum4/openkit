import type {
  ChildProcess,
  ExecException,
  ExecFileException,
  ExecFileSyncOptionsWithBufferEncoding,
  ExecFileSyncOptionsWithStringEncoding,
  SpawnOptions,
  StdioOptions,
} from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import { createRequire, syncBuiltinESMExports } from "module";

const MAX_CAPTURE_LENGTH = 4000;
const SENSITIVE_FLAG_PATTERN =
  /(^|[-_])(token|password|passwd|secret|apikey|api-key|auth|authorization|cookie)([-_]|$)/i;

type ExecFileOptions =
  | (ExecFileSyncOptionsWithStringEncoding & { env?: NodeJS.ProcessEnv })
  | (ExecFileSyncOptionsWithBufferEncoding & { env?: NodeJS.ProcessEnv })
  | ({
      encoding?: BufferEncoding | "buffer" | null;
      env?: NodeJS.ProcessEnv;
      cwd?: string;
    } & Record<string, unknown>);

export interface CommandMonitorEvent {
  runId: string;
  phase: "start" | "success" | "failure";
  timestamp: string;
  source: string;
  command: string;
  args: string[];
  cwd?: string;
  pid?: number;
  durationMs?: number;
  exitCode?: number | null;
  signal?: string | null;
  stdout?: string;
  stderr?: string;
  error?: string;
}

type CommandMonitorSink = (event: CommandMonitorEvent) => void;

let installed = false;
let sink: CommandMonitorSink | null = null;

function emit(event: CommandMonitorEvent): void {
  if (!sink) return;
  try {
    sink(event);
  } catch {
    // Never let sink failures impact process execution.
  }
}

function truncate(value: string): string {
  if (value.length <= MAX_CAPTURE_LENGTH) return value;
  return `${value.slice(0, MAX_CAPTURE_LENGTH)}... [truncated]`;
}

function toStringOutput(value: unknown): string | undefined {
  if (typeof value === "string") return truncate(value);
  if (Buffer.isBuffer(value)) return truncate(value.toString("utf-8"));
  if (value === undefined || value === null) return undefined;
  return truncate(String(value));
}

function isSensitiveFlag(flag: string): boolean {
  if (!flag.startsWith("-")) return false;
  const normalized = flag.replace(/^--?/, "").toLowerCase();
  return SENSITIVE_FLAG_PATTERN.test(normalized);
}

function redactArg(arg: string): string {
  const eqIndex = arg.indexOf("=");
  if (eqIndex > 0) {
    const key = arg.slice(0, eqIndex);
    if (isSensitiveFlag(key)) {
      return `${key}=***`;
    }
  }
  return arg;
}

function sanitizeArgs(args: readonly string[]): string[] {
  const sanitized: string[] = [];
  let redactNext = false;

  for (const rawArg of args) {
    const arg = String(rawArg);
    if (redactNext) {
      sanitized.push("***");
      redactNext = false;
      continue;
    }

    const redactedEqArg = redactArg(arg);
    sanitized.push(redactedEqArg);

    if (redactedEqArg === arg && isSensitiveFlag(arg)) {
      redactNext = true;
    }
  }

  return sanitized;
}

function stackSource(): string {
  const stack = new Error().stack;
  if (!stack) return "unknown";

  const lines = stack
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  for (const line of lines) {
    if (
      line.includes("runtime/command-monitor") ||
      line.includes("node:internal") ||
      line.includes("internal/modules")
    ) {
      continue;
    }

    const match = line.match(/\(?([^()\s]+):(\d+):(\d+)\)?$/);
    const file = match?.[1];
    const lineNo = match?.[2];
    if (!file) continue;
    if (file.startsWith("node:")) continue;

    const relative = file.startsWith(process.cwd())
      ? path.relative(process.cwd(), file)
      : file.replace(/^file:\/\//, "");

    return lineNo ? `${relative}:${lineNo}` : relative;
  }

  return "unknown";
}

function timestamp(): string {
  return new Date().toISOString();
}

function parseExecFileArgs(
  argsOrOptions: unknown,
  optionsOrCallback: unknown,
  callbackArg: unknown,
): {
  args: string[];
  options: ExecFileOptions | undefined;
  callback:
    | ((error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => void)
    | undefined;
} {
  let args: string[] = [];
  let options: ExecFileOptions | undefined;
  let callback:
    | ((error: ExecFileException | null, stdout: string | Buffer, stderr: string | Buffer) => void)
    | undefined;

  if (Array.isArray(argsOrOptions)) {
    args = argsOrOptions.map((arg) => String(arg));
  } else if (typeof argsOrOptions === "function") {
    callback = argsOrOptions as typeof callback;
  } else if (argsOrOptions && typeof argsOrOptions === "object") {
    options = argsOrOptions as ExecFileOptions;
  }

  if (typeof optionsOrCallback === "function") {
    callback = optionsOrCallback as typeof callback;
  } else if (optionsOrCallback && typeof optionsOrCallback === "object") {
    options = optionsOrCallback as ExecFileOptions;
  }

  if (typeof callbackArg === "function") {
    callback = callbackArg as typeof callback;
  }

  return { args, options, callback };
}

function parseSpawnArgs(
  argsOrOptions: unknown,
  optionsArg: unknown,
): { args: string[]; options: SpawnOptions } {
  if (Array.isArray(argsOrOptions)) {
    return {
      args: argsOrOptions.map((arg) => String(arg)),
      options: (optionsArg ?? {}) as SpawnOptions,
    };
  }

  return {
    args: [],
    options: (argsOrOptions ?? {}) as SpawnOptions,
  };
}

function maybeTapStream(
  stream: NodeJS.ReadableStream | null,
  onChunk: (chunk: string) => void,
): void {
  if (!stream || typeof stream.on !== "function") return;
  stream.on("data", (chunk) => {
    const value = toStringOutput(chunk);
    if (!value) return;
    onChunk(value);
  });
}

function hasPipedOutput(stdio: StdioOptions | undefined, index: 1 | 2): boolean {
  if (!stdio) return true;

  if (typeof stdio === "string") {
    if (stdio === "ignore" || stdio === "inherit") return false;
    return true;
  }

  if (!Array.isArray(stdio)) return true;
  const entry = stdio[index];
  if (entry === "ignore" || entry === "inherit") return false;
  return true;
}

export function setCommandMonitorSink(nextSink: CommandMonitorSink | null): void {
  sink = nextSink;
}

export function installCommandMonitor(): void {
  if (installed) return;

  const require = createRequire(import.meta.url);
  const childProcess = require("child_process") as typeof import("child_process");

  const originalExecFile = childProcess.execFile;
  const originalExecFileSync = childProcess.execFileSync;
  const originalSpawn = childProcess.spawn;

  childProcess.execFile = ((
    file: string,
    argsOrOptions?: unknown,
    optionsOrCallback?: unknown,
    callbackArg?: unknown,
  ): ChildProcess => {
    const { args, options, callback } = parseExecFileArgs(
      argsOrOptions,
      optionsOrCallback,
      callbackArg,
    );

    const runId = randomUUID();
    const startedAt = Date.now();
    const source = stackSource();
    const command = String(file);
    const sanitizedArgs = sanitizeArgs(args);

    emit({
      runId,
      phase: "start",
      timestamp: timestamp(),
      source,
      command,
      args: sanitizedArgs,
      cwd: typeof options?.cwd === "string" ? options.cwd : process.cwd(),
    });

    const wrappedCallback = (
      error: ExecFileException | null,
      stdout: string | Buffer,
      stderr: string | Buffer,
    ) => {
      const eventBase = {
        runId,
        timestamp: timestamp(),
        source,
        command,
        args: sanitizedArgs,
        cwd: typeof options?.cwd === "string" ? options.cwd : process.cwd(),
        durationMs: Date.now() - startedAt,
        stdout: toStringOutput(stdout),
        stderr: toStringOutput(stderr),
        exitCode:
          typeof error?.code === "number"
            ? error.code
            : typeof (error as ExecException | null)?.code === "string"
              ? Number((error as ExecException).code)
              : null,
        signal: error?.signal ?? null,
      };

      if (error) {
        emit({
          ...eventBase,
          phase: "failure",
          error: error.message,
        });
      } else {
        emit({
          ...eventBase,
          phase: "success",
        });
      }

      if (callback) {
        callback(error, stdout, stderr);
      }
    };

    return originalExecFile.call(childProcess, file, args, options ?? {}, wrappedCallback);
  }) as typeof childProcess.execFile;

  childProcess.execFileSync = ((
    file: string,
    args: ReadonlyArray<string> = [],
    options?: ExecFileSyncOptionsWithStringEncoding | ExecFileSyncOptionsWithBufferEncoding,
  ): string | Buffer => {
    const runId = randomUUID();
    const startedAt = Date.now();
    const source = stackSource();
    const command = String(file);
    const normalizedArgs = sanitizeArgs((args ?? []).map((arg) => String(arg)));

    emit({
      runId,
      phase: "start",
      timestamp: timestamp(),
      source,
      command,
      args: normalizedArgs,
      cwd: typeof options?.cwd === "string" ? options.cwd : process.cwd(),
    });

    try {
      const result = originalExecFileSync.call(childProcess, file, args, options);
      emit({
        runId,
        phase: "success",
        timestamp: timestamp(),
        source,
        command,
        args: normalizedArgs,
        cwd: typeof options?.cwd === "string" ? options.cwd : process.cwd(),
        durationMs: Date.now() - startedAt,
        stdout: toStringOutput(result),
      });
      return result;
    } catch (error) {
      const execError = error as ExecFileException & {
        stdout?: string | Buffer;
        stderr?: string | Buffer;
        status?: number | null;
      };
      emit({
        runId,
        phase: "failure",
        timestamp: timestamp(),
        source,
        command,
        args: normalizedArgs,
        cwd: typeof options?.cwd === "string" ? options.cwd : process.cwd(),
        durationMs: Date.now() - startedAt,
        stdout: toStringOutput(execError.stdout),
        stderr: toStringOutput(execError.stderr),
        exitCode: execError.status ?? null,
        error: execError.message,
      });
      throw error;
    }
  }) as typeof childProcess.execFileSync;

  childProcess.spawn = ((
    command: string,
    argsOrOptions?: unknown,
    optionsArg?: unknown,
  ): ChildProcess => {
    const parsed = parseSpawnArgs(argsOrOptions, optionsArg);
    const runId = randomUUID();
    const startedAt = Date.now();
    const source = stackSource();
    const normalizedArgs = sanitizeArgs(parsed.args);
    const cwd = typeof parsed.options.cwd === "string" ? parsed.options.cwd : process.cwd();

    const child = originalSpawn.call(childProcess, command, parsed.args, parsed.options);

    emit({
      runId,
      phase: "start",
      timestamp: timestamp(),
      source,
      command,
      args: normalizedArgs,
      cwd,
      pid: child.pid ?? undefined,
    });

    let finished = false;
    let stdout = "";
    let stderr = "";

    if (hasPipedOutput(parsed.options.stdio, 1)) {
      maybeTapStream(child.stdout, (chunk) => {
        stdout = truncate(`${stdout}${chunk}`);
      });
    }
    if (hasPipedOutput(parsed.options.stdio, 2)) {
      maybeTapStream(child.stderr, (chunk) => {
        stderr = truncate(`${stderr}${chunk}`);
      });
    }

    child.on("error", (error) => {
      if (finished) return;
      finished = true;
      emit({
        runId,
        phase: "failure",
        timestamp: timestamp(),
        source,
        command,
        args: normalizedArgs,
        cwd,
        pid: child.pid ?? undefined,
        durationMs: Date.now() - startedAt,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        error: error.message,
      });
    });

    child.on("close", (code, signal) => {
      if (finished) return;
      finished = true;
      const success = code === 0;
      emit({
        runId,
        phase: success ? "success" : "failure",
        timestamp: timestamp(),
        source,
        command,
        args: normalizedArgs,
        cwd,
        pid: child.pid ?? undefined,
        durationMs: Date.now() - startedAt,
        exitCode: typeof code === "number" ? code : null,
        signal: signal ?? null,
        stdout: stdout || undefined,
        stderr: stderr || undefined,
        ...(success ? {} : { error: `Exited with code ${String(code ?? "null")}` }),
      });
    });

    return child;
  }) as typeof childProcess.spawn;

  syncBuiltinESMExports();
  installed = true;
}
