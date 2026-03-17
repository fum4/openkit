import { existsSync, readFileSync, readdirSync } from "fs";
import path from "path";
import type { Dirent } from "fs";

import {
  isOpenKitAutomatedPrompt,
  extractClaudeMessagePreview,
  findHistoricalAgentSessions,
  type ClaudeTranscriptEvent,
} from "./agent-history";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  readdirSync: vi.fn(),
}));

vi.mock("os", () => ({
  default: { homedir: vi.fn(() => "/mock-home") },
  homedir: vi.fn(() => "/mock-home"),
}));

vi.mock("../logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: "",
    path: "",
  } as Dirent;
}

function makeJsonlContent(lines: object[]): string {
  return lines.map((l) => JSON.stringify(l)).join("\n");
}

describe("isOpenKitAutomatedPrompt", () => {
  it("returns true for automated task prompts", () => {
    const text =
      "Implement local task LOCAL-4 (PR Review - Payment methods). You are already in the correct worktree at /some/path.";

    expect(isOpenKitAutomatedPrompt(text)).toBe(true);
  });

  it("returns false for normal user messages", () => {
    expect(isOpenKitAutomatedPrompt("How do I fix this bug?")).toBe(false);
  });

  it("returns false when only prefix matches", () => {
    expect(isOpenKitAutomatedPrompt("Implement local task LOCAL-4")).toBe(false);
  });

  it("returns false when only suffix matches", () => {
    expect(
      isOpenKitAutomatedPrompt("Some other text. You are already in the correct worktree"),
    ).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isOpenKitAutomatedPrompt("")).toBe(false);
  });
});

describe("extractClaudeMessagePreview", () => {
  it("extracts preview from event.message.content", () => {
    const event: ClaudeTranscriptEvent = {
      message: { content: "Fix the authentication bug" },
    };

    expect(extractClaudeMessagePreview(event)).toBe("Fix the authentication bug");
  });

  it("extracts preview from event.content string", () => {
    const event: ClaudeTranscriptEvent = {
      content: "Refactor the database layer",
    };

    expect(extractClaudeMessagePreview(event)).toBe("Refactor the database layer");
  });

  it("returns null for automated OpenKit prompts in message.content", () => {
    const event: ClaudeTranscriptEvent = {
      message: {
        content:
          "Implement local task LOCAL-4 (PR Review - Payment methods). You are already in the correct worktree at /path",
      },
    };

    expect(extractClaudeMessagePreview(event)).toBeNull();
  });

  it("returns null for automated OpenKit prompts in event.content", () => {
    const event: ClaudeTranscriptEvent = {
      content:
        "Implement local task LOCAL-4 (Some task). You are already in the correct worktree at /path",
    };

    expect(extractClaudeMessagePreview(event)).toBeNull();
  });

  it("returns null for empty message content", () => {
    const event: ClaudeTranscriptEvent = {
      message: { content: "" },
    };

    expect(extractClaudeMessagePreview(event)).toBeNull();
  });

  it("returns null for local_command subtype", () => {
    const event: ClaudeTranscriptEvent = {
      content: "git status",
      subtype: "local_command",
    };

    expect(extractClaudeMessagePreview(event)).toBeNull();
  });

  it("strips HTML markup from content", () => {
    const event: ClaudeTranscriptEvent = {
      message: { content: "Hello <b>world</b> test" },
    };

    expect(extractClaudeMessagePreview(event)).toBe("Hello world test");
  });

  it("returns null when no content is present", () => {
    const event: ClaudeTranscriptEvent = {
      type: "some_type",
    };

    expect(extractClaudeMessagePreview(event)).toBeNull();
  });
});

describe("findHistoricalAgentSessions (claude)", () => {
  const projectsDir = path.join("/mock-home", ".claude", "projects");
  const worktreePath = "/projects/edm/.openkit/worktrees/LOCAL-4";

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when projects directory does not exist", () => {
    mockedExistsSync.mockReturnValue(false);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toEqual([]);
  });

  it("matches sessions by cwd and returns gitBranch", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [makeDirent("session.jsonl", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const transcript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "abc12345-session",
        timestamp: "2026-03-15T10:00:00Z",
        gitBranch: "LOCAL-4/feature-branch",
        message: { content: "Fix the rendering bug in the dashboard" },
      },
    ]);
    mockedReadFileSync.mockReturnValue(transcript);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("abc12345-session");
    expect(result[0].gitBranch).toBe("LOCAL-4/feature-branch");
    expect(result[0].title).toBe("Fix the rendering bug in the dashboard");
  });

  it("skips automated prompts and uses next real message for title", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [makeDirent("session.jsonl", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const transcript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "abc12345-session",
        timestamp: "2026-03-15T10:00:00Z",
        gitBranch: "LOCAL-4/feature-branch",
        message: {
          content:
            "Implement local task LOCAL-4 (PR Review - Payment methods). You are already in the correct worktree at /path",
        },
      },
      {
        cwd: worktreePath,
        sessionId: "abc12345-session",
        timestamp: "2026-03-15T10:01:00Z",
        content: "Actual user question about EDM code",
      },
    ]);
    mockedReadFileSync.mockReturnValue(transcript);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Actual user question about EDM code");
    expect(result[0].preview).toBe("Actual user question about EDM code");
  });

  it("uses fallback title with gitBranch when all messages are automated", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [makeDirent("session.jsonl", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const transcript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "abc12345-session",
        timestamp: "2026-03-15T10:00:00Z",
        gitBranch: "LOCAL-4/feature-branch",
        message: {
          content:
            "Implement local task LOCAL-4 (Task title). You are already in the correct worktree at /path",
        },
      },
    ]);
    mockedReadFileSync.mockReturnValue(transcript);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("Claude session (LOCAL-4/feature-branch)");
  });

  it("does not match sessions from different worktree paths", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [makeDirent("session.jsonl", false)] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const transcript = makeJsonlContent([
      {
        cwd: "/projects/avo/.openkit/worktrees/LOCAL-4",
        sessionId: "other-session",
        timestamp: "2026-03-15T10:00:00Z",
        message: { content: "PR Review - Payment methods" },
      },
    ]);
    mockedReadFileSync.mockReturnValue(transcript);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toEqual([]);
  });

  it("skips subagents directory", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [
          makeDirent("subagents", true),
          makeDirent("session.jsonl", false),
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const transcript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "main-session",
        timestamp: "2026-03-15T10:00:00Z",
        message: { content: "Main session content" },
      },
    ]);
    mockedReadFileSync.mockReturnValue(transcript);

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toHaveLength(1);
    expect(result[0].sessionId).toBe("main-session");
  });

  it("sorts results by updatedAt descending", () => {
    mockedExistsSync.mockReturnValue(true);
    mockedReaddirSync.mockImplementation((dirPath: unknown) => {
      if (dirPath === projectsDir) {
        return [
          makeDirent("old.jsonl", false),
          makeDirent("new.jsonl", false),
        ] as unknown as ReturnType<typeof readdirSync>;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });

    const oldTranscript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "old-session",
        timestamp: "2026-03-14T10:00:00Z",
        message: { content: "Old session" },
      },
    ]);
    const newTranscript = makeJsonlContent([
      {
        cwd: worktreePath,
        sessionId: "new-session",
        timestamp: "2026-03-15T10:00:00Z",
        message: { content: "New session" },
      },
    ]);

    mockedReadFileSync.mockImplementation((filePath: unknown) => {
      if (String(filePath).includes("old.jsonl")) return oldTranscript;
      return newTranscript;
    });

    const result = findHistoricalAgentSessions("claude", worktreePath);

    expect(result).toHaveLength(2);
    expect(result[0].sessionId).toBe("new-session");
    expect(result[1].sessionId).toBe("old-session");
  });
});
