import { existsSync } from "fs";
import {
  generateBranchName,
  readBranchNameRuleContent,
  wrapWithExportDefault,
  hasCustomBranchNameRule,
  DEFAULT_BRANCH_RULE,
} from "../branch-name";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

describe("generateBranchName", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // No custom rule files exist by default
    vi.mocked(existsSync).mockReturnValue(false);
  });

  it("generates branch name using default rule", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-123",
      name: "Fix Login Bug",
      type: "jira",
    });

    expect(result).toBe("PROJ-123/fix_login_bug");
  });

  it("strips special characters from name", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-1",
      name: "Hello, World! @#$ Test",
      type: "jira",
    });

    expect(result).toBe("PROJ-1/hello_world_test");
  });

  it("handles unicode characters by replacing with underscores", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-1",
      name: "Ünïcödé Tëst",
      type: "jira",
    });

    expect(result).toBe("PROJ-1/n_c_d_t_st");
  });

  it("trims leading and trailing underscores from slug", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-1",
      name: "---test---",
      type: "jira",
    });

    expect(result).toBe("PROJ-1/test");
  });

  it("handles empty name gracefully", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-1",
      name: "",
      type: "jira",
    });

    expect(result).toBe("PROJ-1/");
  });

  it("uses default rule for unknown source types", async () => {
    const result = await generateBranchName("/project", {
      issueId: "PROJ-1",
      name: "Test Issue",
      type: "unknown",
    });

    expect(result).toBe("PROJ-1/test_issue");
  });
});

describe("readBranchNameRuleContent", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns default rule when no custom file exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = readBranchNameRuleContent("/project");

    expect(result).toBe(DEFAULT_BRANCH_RULE);
  });

  it("returns empty string for source-specific rule that does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = readBranchNameRuleContent("/project", "jira");

    expect(result).toBe("");
  });
});

describe("wrapWithExportDefault", () => {
  it("wraps function body with export default", () => {
    const fn = "() => 'test'";

    const result = wrapWithExportDefault(fn);

    expect(result).toBe("export default () => 'test'");
  });

  it("does not double-wrap when already exported", () => {
    const fn = "export default () => 'test'";

    const result = wrapWithExportDefault(fn);

    expect(result).toBe("export default () => 'test'");
  });

  it("handles leading whitespace before export default", () => {
    const fn = "  export default () => 'test'";

    const result = wrapWithExportDefault(fn);

    expect(result).toBe("  export default () => 'test'");
  });
});

describe("hasCustomBranchNameRule", () => {
  it("returns true when rule file exists", () => {
    vi.mocked(existsSync).mockReturnValue(true);

    expect(hasCustomBranchNameRule("/project")).toBe(true);
  });

  it("returns false when rule file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    expect(hasCustomBranchNameRule("/project")).toBe(false);
  });
});
