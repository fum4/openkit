import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExec = vi.fn();

vi.mock("child_process", () => {
  // Node's promisify checks for [util.promisify.custom] on execFile.
  // We provide a mock that works with both callback and promisify forms.
  const { promisify } = require("util");
  const execFileFn = (...args: unknown[]) => {
    // Callback form: (cmd, args, opts, cb)
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      const result = mockExec(args[0], args[1], args[2]);
      if (result instanceof Error) {
        cb(result);
      } else {
        cb(null, result);
      }
      return;
    }
  };
  // Attach promisify.custom so promisify(execFile) calls mockExec via promise
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (execFileFn as any)[promisify.custom] = (cmd: string, args: string[], opts?: unknown) => {
    const result = mockExec(cmd, args, opts);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve(result);
  };
  return { execFile: execFileFn };
});

vi.mock("@openkit/shared/command-path", () => ({
  isCommandOnPath: vi.fn(() => true),
  resolveCommandPath: vi.fn((cmd: string) => cmd),
  withAugmentedPathEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

import { getGitStatus } from "@openkit/integrations/github/gh-client";

function setupMockResponses(responses: Record<string, { stdout: string; throws?: boolean }>) {
  mockExec.mockImplementation((cmd: string, args: string[]) => {
    const key = [cmd, ...args].join(" ");
    for (const [pattern, response] of Object.entries(responses)) {
      if (key.includes(pattern)) {
        if (response.throws) {
          return new Error("command failed");
        }
        return { stdout: response.stdout, stderr: "" };
      }
    }
    return { stdout: "", stderr: "" };
  });
}

describe("getGitStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes untracked file lines in linesAdded", async () => {
    setupMockResponses({
      "status --porcelain": { stdout: "?? new-file.ts\n" },
      "rev-list --left-right": { stdout: "0\t0\n" },
      "diff --numstat HEAD": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "new-file.ts\n" },
      "wc -l": { stdout: "  42 new-file.ts\n" },
    });

    const result = await getGitStatus("/fake/worktree");

    expect(result.linesAdded).toBe(42);
    expect(result.linesRemoved).toBe(0);
    expect(result.hasUncommitted).toBe(true);
  });

  it("combines tracked changes and untracked file lines", async () => {
    setupMockResponses({
      "status --porcelain": { stdout: "M existing.ts\n?? new-file.ts\n" },
      "rev-list --left-right": { stdout: "1\t0\n" },
      "diff --numstat HEAD": { stdout: "10\t3\texisting.ts\n" },
      "ls-files --others --exclude-standard": { stdout: "new-file.ts\n" },
      "wc -l": { stdout: "  20 new-file.ts\n" },
    });

    const result = await getGitStatus("/fake/worktree");

    expect(result.linesAdded).toBe(30); // 10 tracked + 20 untracked
    expect(result.linesRemoved).toBe(3);
  });

  it("handles multiple untracked files with wc total line", async () => {
    setupMockResponses({
      "status --porcelain": { stdout: "?? a.ts\n?? b.ts\n" },
      "rev-list --left-right": { stdout: "0\t0\n" },
      "diff --numstat HEAD": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "a.ts\nb.ts\n" },
      "wc -l": { stdout: "  10 a.ts\n  15 b.ts\n  25 total\n" },
    });

    const result = await getGitStatus("/fake/worktree");

    expect(result.linesAdded).toBe(25);
  });

  it("returns zero when no untracked files exist", async () => {
    setupMockResponses({
      "status --porcelain": { stdout: "" },
      "rev-list --left-right": { stdout: "0\t0\n" },
      "diff --numstat HEAD": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getGitStatus("/fake/worktree");

    expect(result.linesAdded).toBe(0);
    expect(result.linesRemoved).toBe(0);
  });

  it("gracefully handles wc failure", async () => {
    setupMockResponses({
      "status --porcelain": { stdout: "?? new.ts\n" },
      "rev-list --left-right": { stdout: "0\t0\n" },
      "diff --numstat HEAD": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "new.ts\n" },
      "wc -l": { stdout: "", throws: true },
    });

    const result = await getGitStatus("/fake/worktree");

    // Should not throw, just skip untracked count
    expect(result.linesAdded).toBe(0);
  });
});
