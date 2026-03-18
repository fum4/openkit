/**
 * System boundary mock: child_process
 *
 * Mocks git commands and process spawning so the real WorktreeManager
 * can run without actually touching git or spawning dev servers.
 */
import { EventEmitter } from "events";
import { vi } from "vitest";

// ─── Recorded calls ────────────────────────────────────────────

interface ExecFileCall {
  file: string;
  args: string[];
}

const execFileCalls: ExecFileCall[] = [];
const gitResponses = new Map<string, { stdout?: string; stderr?: string; error?: Error }>();

export function getExecFileCalls(): ExecFileCall[] {
  return execFileCalls;
}

export function clearExecFileCalls(): void {
  execFileCalls.length = 0;
}

export function setGitCommandResponse(
  pattern: string,
  response: { stdout?: string; stderr?: string; error?: Error },
): void {
  gitResponses.set(pattern, response);
}

export function clearGitCommandResponses(): void {
  gitResponses.clear();
}

// ─── Install the mock ──────────────────────────────────────────

vi.mock("child_process", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;

  function findGitResponse(args: string[]) {
    const command = args.join(" ");
    for (const [pattern, response] of gitResponses) {
      if (command.includes(pattern)) return response;
    }
    return null;
  }

  function defaultGitResponse(args: string[]): { stdout: string; stderr: string } {
    const command = args.join(" ");

    if (command.includes("worktree list --porcelain")) return { stdout: "", stderr: "" };
    if (command.includes("rev-parse --git-dir")) return { stdout: ".git", stderr: "" };
    if (command.includes("rev-parse --verify")) return { stdout: "abc123", stderr: "" };
    if (command.includes("show-ref --verify")) return { stdout: "", stderr: "" };
    if (command.includes("config user.")) return { stdout: "test-user", stderr: "" };
    if (command.includes("remote get-url")) {
      return { stdout: "https://github.com/test/repo.git", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }

  function mockedExecFile(
    file: string,
    args: string[] | Record<string, unknown> | Function,
    optionsOrCallback?: Record<string, unknown> | Function,
    callback?: Function,
  ) {
    // Normalize overloaded call signatures
    let actualArgs: string[] = [];
    let cb: Function | undefined = callback;

    if (Array.isArray(args)) {
      actualArgs = args;
      if (typeof optionsOrCallback === "function") {
        cb = optionsOrCallback;
      }
    } else if (typeof args === "function") {
      cb = args;
    }

    execFileCalls.push({ file, args: actualArgs });

    const customResponse = findGitResponse(actualArgs);
    if (customResponse?.error) {
      if (cb) cb(customResponse.error, "", customResponse.stderr ?? "");
      return;
    }

    const response = customResponse ?? defaultGitResponse(actualArgs);
    if (cb) cb(null, response.stdout ?? "", response.stderr ?? "");
  }

  // Mark as promisifiable — Node's promisify looks for __promisify__ or falls back
  // to wrapping the callback-style function. Our function already uses callback style.
  (mockedExecFile as any)[Symbol.for("util.promisify.custom")] = async (
    file: string,
    args: string[] = [],
    _options?: Record<string, unknown>,
  ) => {
    execFileCalls.push({ file, args });

    const customResponse = findGitResponse(args);
    if (customResponse?.error) throw customResponse.error;

    const response = customResponse ?? defaultGitResponse(args);
    return { stdout: response.stdout ?? "", stderr: response.stderr ?? "" };
  };

  function mockedExecFileSync(
    _file: string,
    args: string[] = [],
    _options?: Record<string, unknown>,
  ): string | Buffer {
    const customResponse = findGitResponse(args);
    if (customResponse?.error) throw customResponse.error;

    const response = customResponse ?? defaultGitResponse(args);
    return response.stdout ?? "";
  }

  function mockedSpawn() {
    const proc = new (EventEmitter as unknown as new () => EventEmitter & {
      pid: number;
      stdin: EventEmitter;
      stdout: EventEmitter;
      stderr: EventEmitter;
      kill: () => boolean;
    })();
    proc.pid = 99999;
    proc.stdin = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = () => true;

    queueMicrotask(() => proc.emit("close", 0));
    return proc;
  }

  const mock = {
    ...actual,
    execFile: mockedExecFile,
    execFileSync: mockedExecFileSync,
    spawn: mockedSpawn,
  };

  return { ...mock, default: mock };
});

// Reset recorded calls between tests
afterEach(() => {
  clearExecFileCalls();
  clearGitCommandResponses();
});
