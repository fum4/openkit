/**
 * Unit tests for git diff functions (getChangedFiles, getFileContent).
 *
 * Mocks child_process.execFile and fs.readFile at the boundary to test
 * parsing and orchestration logic without requiring a real git repo.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExec = vi.fn();

vi.mock("child_process", () => {
  const execFileFn = (...args: unknown[]) => {
    const cb = args[args.length - 1];
    if (typeof cb === "function") {
      const result = mockExec(args[0], args[1], args[2]);
      if (result instanceof Error) {
        cb(result);
      } else {
        // Pass stdout and stderr as separate callback arguments (matching Node's execFile signature)
        cb(null, result.stdout ?? "", result.stderr ?? "");
      }
      return;
    }
  };
  return { execFile: execFileFn };
});

vi.mock("@openkit/shared/command-path", () => ({
  resolveCommandPath: vi.fn((cmd: string) => cmd),
  withAugmentedPathEnv: vi.fn((env: NodeJS.ProcessEnv) => env),
}));

vi.mock("@openkit/integrations/github/logger", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const mockReadFile = vi.fn();
vi.mock("fs/promises", () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import { getChangedFiles, getFileContent } from "@openkit/integrations/github/git-diff";

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

describe("getChangedFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns modified, added, and deleted files from git diff output", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      // Staged diff (--cached must come before bare "diff --name-status" to win substring match)
      "diff --name-status --cached": {
        stdout: "M\tsrc/app.ts\nA\tsrc/new.ts\nD\tsrc/old.ts\n",
      },
      "diff --numstat --cached": {
        stdout: "10\t3\tsrc/app.ts\n15\t0\tsrc/new.ts\n0\t20\tsrc/old.ts\n",
      },
      // Unstaged diff (bare, no ref)
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(3);
    expect(result.files[0]).toEqual({
      path: "src/app.ts",
      status: "modified",
      linesAdded: 10,
      linesRemoved: 3,
      isBinary: false,
      staged: true,
    });
    expect(result.files[1]).toEqual({
      path: "src/new.ts",
      status: "added",
      linesAdded: 15,
      linesRemoved: 0,
      isBinary: false,
      staged: true,
    });
    expect(result.files[2]).toEqual({
      path: "src/old.ts",
      status: "deleted",
      linesAdded: 0,
      linesRemoved: 20,
      isBinary: false,
      staged: true,
    });
  });

  it("handles untracked files", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { stdout: "" },
      "diff --numstat --cached": { stdout: "" },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "untracked.ts\n" },
    });
    // countUntrackedLines now reads the file directly instead of using wc -l
    mockReadFile.mockResolvedValue("line1\nline2\nline3\n".repeat(8) + "last");

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("untracked.ts");
    expect(result.files[0].status).toBe("untracked");
    expect(result.files[0].linesAdded).toBeGreaterThan(0);
    expect(result.files[0].linesRemoved).toBe(0);
    expect(result.files[0].staged).toBe(false);
  });

  it("detects binary files from numstat output", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { stdout: "M\timage.png\n" },
      "diff --numstat --cached": { stdout: "-\t-\timage.png\n" },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].isBinary).toBe(true);
    expect(result.files[0].linesAdded).toBe(0);
    expect(result.files[0].linesRemoved).toBe(0);
  });

  it("handles renamed files with old path", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { stdout: "R100\told-name.ts\tnew-name.ts\n" },
      "diff --numstat --cached": { stdout: "0\t0\tnew-name.ts\n" },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      path: "new-name.ts",
      oldPath: "old-name.ts",
      status: "renamed",
      linesAdded: 0,
      linesRemoved: 0,
      isBinary: false,
      staged: true,
    });
  });

  it("handles renamed files with {old => new} numstat format", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": {
        stdout: "R100\tsrc/__test__/ops-log.test.ts\tsrc/__test__/log-store.test.ts\n",
      },
      "diff --numstat --cached": {
        stdout: "55\t53\tsrc/__test__/{ops-log.test.ts => log-store.test.ts}\n",
      },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toEqual({
      path: "src/__test__/log-store.test.ts",
      oldPath: "src/__test__/ops-log.test.ts",
      status: "renamed",
      linesAdded: 55,
      linesRemoved: 53,
      isBinary: false,
      staged: true,
    });
  });

  it("diffs against base branch when includeCommitted is true", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "rev-parse --verify origin/main": { stdout: "def456\n" },
      // With includeCommitted, all tracked changes are diffed against origin/main
      "diff --name-status origin/main": { stdout: "M\tsrc/local.ts\nA\tsrc/committed.ts\n" },
      "diff --numstat origin/main": {
        stdout: "5\t2\tsrc/local.ts\n20\t0\tsrc/committed.ts\n",
      },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", true);

    expect(result.files).toHaveLength(2);
    expect(result.files.find((f) => f.path === "src/local.ts")?.linesAdded).toBe(5);
    expect(result.files.find((f) => f.path === "src/committed.ts")?.status).toBe("added");
  });

  it("returns empty list for clean worktree", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { stdout: "" },
      "diff --numstat --cached": { stdout: "" },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(0);
  });

  it("returns empty list when HEAD does not exist (no commits yet)", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { throws: true, stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(0);
  });

  it("handles git command failures gracefully", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { throws: true, stdout: "" },
      "diff --numstat --cached": { throws: true, stdout: "" },
      "diff --name-status": { throws: true, stdout: "" },
      "diff --numstat": { throws: true, stdout: "" },
      "ls-files --others --exclude-standard": { throws: true, stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", false);

    // Should not throw, just return empty with error details
    expect(result.files).toHaveLength(0);
    expect(result.error).toBeDefined();
  });

  it("separates staged and unstaged files when includeCommitted is false", async () => {
    mockExec.mockImplementation((_cmd: string, args: string[]) => {
      const key = args.join(" ");
      if (key === "rev-parse --verify HEAD") return { stdout: "abc123\n", stderr: "" };
      if (key === "diff --name-status --cached")
        return { stdout: "M\tsrc/staged.ts\n", stderr: "" };
      if (key === "diff --numstat --cached") return { stdout: "5\t2\tsrc/staged.ts\n", stderr: "" };
      if (key === "diff --name-status") return { stdout: "M\tsrc/unstaged.ts\n", stderr: "" };
      if (key === "diff --numstat") return { stdout: "3\t1\tsrc/unstaged.ts\n", stderr: "" };
      if (key.includes("ls-files")) return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    const result = await getChangedFiles("/fake", "main", false);

    const stagedFile = result.files.find((f) => f.path === "src/staged.ts");
    const unstagedFile = result.files.find((f) => f.path === "src/unstaged.ts");

    expect(stagedFile).toBeDefined();
    expect(stagedFile?.staged).toBe(true);
    expect(unstagedFile).toBeDefined();
    expect(unstagedFile?.staged).toBe(false);
    // Staged files should come first in the sorted output
    expect(result.files.indexOf(stagedFile!)).toBeLessThan(result.files.indexOf(unstagedFile!));
  });

  it("does not set staged field when includeCommitted is true", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "rev-parse --verify origin/main": { stdout: "def456\n" },
      "diff --name-status origin/main": { stdout: "M\tsrc/local.ts\nA\tsrc/committed.ts\n" },
      "diff --numstat origin/main": {
        stdout: "5\t2\tsrc/local.ts\n20\t0\tsrc/committed.ts\n",
      },
      "ls-files --others --exclude-standard": { stdout: "" },
    });

    const result = await getChangedFiles("/fake", "main", true);

    expect(result.files).toHaveLength(2);
    for (const file of result.files) {
      expect(file.staged).toBeUndefined();
    }
  });

  it("untracked files have staged: false when includeCommitted is false", async () => {
    setupMockResponses({
      "rev-parse --verify HEAD": { stdout: "abc123\n" },
      "diff --name-status --cached": { stdout: "" },
      "diff --numstat --cached": { stdout: "" },
      "diff --name-status": { stdout: "" },
      "diff --numstat": { stdout: "" },
      "ls-files --others --exclude-standard": { stdout: "new-file.ts\n" },
    });
    mockReadFile.mockResolvedValue("content\n");

    const result = await getChangedFiles("/fake", "main", false);

    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe("new-file.ts");
    expect(result.files[0].status).toBe("untracked");
    expect(result.files[0].staged).toBe(false);
  });
});

describe("getFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns old and new content for modified files", async () => {
    setupMockResponses({
      "show HEAD:src/app.ts": { stdout: "old content" },
    });
    mockReadFile.mockResolvedValue("new content");

    const result = await getFileContent("/fake", "src/app.ts", "modified", "main", false);

    expect(result.oldContent).toBe("old content");
    expect(result.newContent).toBe("new content");
  });

  it("returns empty old content for added files", async () => {
    mockReadFile.mockResolvedValue("added file content");

    const result = await getFileContent("/fake", "src/new.ts", "added", "main", false);

    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("added file content");
  });

  it("returns empty new content for deleted files", async () => {
    setupMockResponses({
      "show HEAD:src/old.ts": { stdout: "deleted file content" },
    });

    const result = await getFileContent("/fake", "src/old.ts", "deleted", "main", false);

    expect(result.oldContent).toBe("deleted file content");
    expect(result.newContent).toBe("");
  });

  it("uses origin/baseBranch ref when includeCommitted is true", async () => {
    setupMockResponses({
      "show origin/main:src/app.ts": { stdout: "base branch content" },
    });
    mockReadFile.mockResolvedValue("current content");

    const result = await getFileContent("/fake", "src/app.ts", "modified", "main", true);

    expect(result.oldContent).toBe("base branch content");
    expect(result.newContent).toBe("current content");
  });

  it("returns empty content when file read fails", async () => {
    setupMockResponses({
      "show HEAD:src/broken.ts": { throws: true, stdout: "" },
    });
    mockReadFile.mockRejectedValue(new Error("ENOENT"));

    const result = await getFileContent("/fake", "src/broken.ts", "modified", "main", false);

    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("");
  });

  it("handles renamed files with old path", async () => {
    setupMockResponses({
      "show HEAD:src/old-name.ts": { stdout: "original content" },
    });
    mockReadFile.mockResolvedValue("renamed content");

    const result = await getFileContent(
      "/fake",
      "src/new-name.ts",
      "renamed",
      "main",
      false,
      "src/old-name.ts",
    );

    expect(result.oldContent).toBe("original content");
    expect(result.newContent).toBe("renamed content");
  });
});
