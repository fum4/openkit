/**
 * Unit tests for GitHub PR diff functions (getPrDiffFiles, getPrFileContent).
 *
 * Mocks child_process.execFile at the boundary to test parsing and orchestration
 * logic without requiring a real GitHub API connection or gh CLI.
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

import { getPrDiffFiles, getPrFileContent } from "@openkit/integrations/github/pr-diff";

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

const BASE_META = JSON.stringify({
  base_sha: "abc123",
  base_ref: "main",
  merge_commit_sha: "def456",
});

describe("getPrDiffFiles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps GitHub PR files to DiffFileInfo array (modified, added, removed, renamed)", async () => {
    const ghFiles = [
      {
        filename: "src/app.ts",
        status: "modified",
        additions: 10,
        deletions: 3,
        changes: 13,
        patch: "@@ ...",
      },
      {
        filename: "src/new.ts",
        status: "added",
        additions: 20,
        deletions: 0,
        changes: 20,
        patch: "@@ ...",
      },
      {
        filename: "src/old.ts",
        status: "removed",
        additions: 0,
        deletions: 15,
        changes: 15,
        patch: "@@ ...",
      },
      {
        filename: "src/renamed.ts",
        previous_filename: "src/original.ts",
        status: "renamed",
        additions: 5,
        deletions: 2,
        changes: 7,
        patch: "@@ ...",
      },
    ];

    setupMockResponses({
      [`pulls/42/files`]: { stdout: JSON.stringify(ghFiles) },
      [`pulls/42 --jq`]: { stdout: BASE_META },
    });

    const result = await getPrDiffFiles("myorg", "myrepo", 42);

    expect(result.success).toBe(true);
    expect(result.baseSha).toBe("abc123");
    expect(result.mergeSha).toBe("def456");
    expect(result.baseBranch).toBe("main");
    expect(result.files).toHaveLength(4);

    expect(result.files[0]).toEqual({
      path: "src/app.ts",
      status: "modified",
      linesAdded: 10,
      linesRemoved: 3,
      isBinary: false,
    });
    expect(result.files[1]).toEqual({
      path: "src/new.ts",
      status: "added",
      linesAdded: 20,
      linesRemoved: 0,
      isBinary: false,
    });
    expect(result.files[2]).toEqual({
      path: "src/old.ts",
      status: "deleted",
      linesAdded: 0,
      linesRemoved: 15,
      isBinary: false,
    });
    expect(result.files[3]).toEqual({
      path: "src/renamed.ts",
      oldPath: "src/original.ts",
      status: "renamed",
      linesAdded: 5,
      linesRemoved: 2,
      isBinary: false,
    });
  });

  it("detects binary files (no patch field, zero changes)", async () => {
    const ghFiles = [
      { filename: "assets/image.png", status: "modified", additions: 0, deletions: 0, changes: 0 },
    ];

    setupMockResponses({
      [`pulls/42/files`]: { stdout: JSON.stringify(ghFiles) },
      [`pulls/42 --jq`]: { stdout: BASE_META },
    });

    const result = await getPrDiffFiles("myorg", "myrepo", 42);

    expect(result.success).toBe(true);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].isBinary).toBe(true);
    expect(result.files[0].linesAdded).toBe(0);
    expect(result.files[0].linesRemoved).toBe(0);
  });

  it("maps 'copied' status to 'added'", async () => {
    const ghFiles = [
      {
        filename: "src/copy.ts",
        status: "copied",
        additions: 8,
        deletions: 0,
        changes: 8,
        patch: "@@ ...",
      },
    ];

    setupMockResponses({
      [`pulls/42/files`]: { stdout: JSON.stringify(ghFiles) },
      [`pulls/42 --jq`]: { stdout: BASE_META },
    });

    const result = await getPrDiffFiles("myorg", "myrepo", 42);

    expect(result.success).toBe(true);
    expect(result.files[0].status).toBe("added");
  });

  it("returns error when merge_commit_sha is null", async () => {
    const unmergedMeta = JSON.stringify({
      base_sha: "abc123",
      base_ref: "main",
      merge_commit_sha: null,
    });

    setupMockResponses({
      [`pulls/42 --jq`]: { stdout: unmergedMeta },
    });

    const result = await getPrDiffFiles("myorg", "myrepo", 42);

    expect(result.success).toBe(false);
    expect(result.error).toMatch(/not been merged/i);
    expect(result.files).toHaveLength(0);
  });

  it("returns error when gh api fails", async () => {
    setupMockResponses({
      [`pulls/42 --jq`]: { stdout: "", throws: true },
    });

    const result = await getPrDiffFiles("myorg", "myrepo", 42);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.files).toHaveLength(0);
  });
});

describe("getPrFileContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches old and new content for a modified file", async () => {
    const oldEncoded = btoa("old file content");
    const newEncoded = btoa("new file content");

    setupMockResponses({
      [`contents/src/app.ts?ref=abc123`]: {
        stdout: JSON.stringify({ content: oldEncoded, encoding: "base64" }),
      },
      [`contents/src/app.ts?ref=def456`]: {
        stdout: JSON.stringify({ content: newEncoded, encoding: "base64" }),
      },
    });

    const result = await getPrFileContent(
      "myorg",
      "myrepo",
      "src/app.ts",
      "modified",
      "abc123",
      "def456",
    );

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("old file content");
    expect(result.newContent).toBe("new file content");
  });

  it("returns empty old content for added files", async () => {
    const newEncoded = btoa("brand new content");

    setupMockResponses({
      [`contents/src/new.ts?ref=def456`]: {
        stdout: JSON.stringify({ content: newEncoded, encoding: "base64" }),
      },
    });

    const result = await getPrFileContent(
      "myorg",
      "myrepo",
      "src/new.ts",
      "added",
      "abc123",
      "def456",
    );

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("brand new content");
  });

  it("returns empty new content for deleted files", async () => {
    const oldEncoded = btoa("deleted file content");

    setupMockResponses({
      [`contents/src/old.ts?ref=abc123`]: {
        stdout: JSON.stringify({ content: oldEncoded, encoding: "base64" }),
      },
    });

    const result = await getPrFileContent(
      "myorg",
      "myrepo",
      "src/old.ts",
      "deleted",
      "abc123",
      "def456",
    );

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("deleted file content");
    expect(result.newContent).toBe("");
  });

  it("uses oldPath for renamed files when fetching old content", async () => {
    const oldEncoded = btoa("content at old path");
    const newEncoded = btoa("content at new path");

    setupMockResponses({
      [`contents/src/original.ts?ref=abc123`]: {
        stdout: JSON.stringify({ content: oldEncoded, encoding: "base64" }),
      },
      [`contents/src/renamed.ts?ref=def456`]: {
        stdout: JSON.stringify({ content: newEncoded, encoding: "base64" }),
      },
    });

    const result = await getPrFileContent(
      "myorg",
      "myrepo",
      "src/renamed.ts",
      "renamed",
      "abc123",
      "def456",
      "src/original.ts",
    );

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("content at old path");
    expect(result.newContent).toBe("content at new path");
  });

  it("handles GitHub 403 for large files gracefully", async () => {
    mockExec.mockImplementation((cmd: string, args: string[]) => {
      const key = [cmd, ...args].join(" ");
      if (key.includes("contents/src/huge.ts")) {
        return new Error(
          "HTTP 403: This file is too large to display. Files must be smaller than 1 MB.",
        );
      }
      return { stdout: "", stderr: "" };
    });

    const result = await getPrFileContent(
      "myorg",
      "myrepo",
      "src/huge.ts",
      "modified",
      "abc123",
      "def456",
    );

    expect(result.success).toBe(true);
    expect(result.oldContent).toBe("");
    expect(result.newContent).toBe("");
    expect(result.error).toMatch(/too large/i);
  });
});
