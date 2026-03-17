import { existsSync } from "fs";
import {
  formatCommitMessage,
  readCommitMessageRuleContent,
  wrapWithExportDefault,
  hasCustomCommitMessageRule,
  DEFAULT_COMMIT_MESSAGE_RULE,
} from "@openkit/shared/commit-message";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("formatCommitMessage", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it("returns the message as-is with default rule when no custom rule exists", async () => {
    const result = await formatCommitMessage("/project", {
      message: "Fix bug in login",
      issueId: "PROJ-123",
      source: "jira",
    });

    expect(result).toBe("Fix bug in login");
  });

  it("returns the message when source is null", async () => {
    const result = await formatCommitMessage("/project", {
      message: "Update readme",
      issueId: null,
      source: null,
    });

    expect(result).toBe("Update readme");
  });

  it("returns the message for unknown source types", async () => {
    const result = await formatCommitMessage("/project", {
      message: "Test commit",
      issueId: "123",
      source: "unknown",
    });

    expect(result).toBe("Test commit");
  });

  it("trims whitespace from result", async () => {
    const result = await formatCommitMessage("/project", {
      message: "  Fix spacing  ",
      issueId: null,
      source: null,
    });

    expect(result).toBe("Fix spacing");
  });
});

describe("readCommitMessageRuleContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns default rule when no custom file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = readCommitMessageRuleContent("/project");

    expect(result).toBe(DEFAULT_COMMIT_MESSAGE_RULE);
  });

  it("returns empty string for source-specific rule that does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = readCommitMessageRuleContent("/project", "jira");

    expect(result).toBe("");
  });
});

describe("wrapWithExportDefault", () => {
  it("wraps function body with export default", () => {
    const result = wrapWithExportDefault("() => 'test'");

    expect(result).toBe("export default () => 'test'");
  });

  it("does not double-wrap", () => {
    const result = wrapWithExportDefault("export default () => 'test'");

    expect(result).toBe("export default () => 'test'");
  });
});

describe("hasCustomCommitMessageRule", () => {
  it("returns true when rule file exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    expect(hasCustomCommitMessageRule("/project")).toBe(true);
  });

  it("returns false when rule file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(hasCustomCommitMessageRule("/project")).toBe(false);
  });
});
