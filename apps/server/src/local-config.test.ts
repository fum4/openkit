import { existsSync, readFileSync } from "fs";
import { loadLocalConfig, loadLocalGitPolicyConfig } from "./local-config";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe("loadLocalConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty object when config file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadLocalConfig("/project");

    expect(result).toEqual({});
  });

  it("parses valid config with boolean fields", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        allowAgentCommits: true,
        allowAgentPushes: false,
        allowAgentPRs: true,
      }),
    );

    const result = loadLocalConfig("/project");

    expect(result).toEqual({
      allowAgentCommits: true,
      allowAgentPushes: false,
      allowAgentPRs: true,
    });
  });

  it("strips non-boolean fields from config", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        allowAgentCommits: "yes",
        allowAgentPushes: 1,
        extraField: true,
      }),
    );

    const result = loadLocalConfig("/project");

    expect(result).toEqual({});
  });

  it("returns empty object when config file has corrupt JSON", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{invalid json");

    const result = loadLocalConfig("/project");

    expect(result).toEqual({});
  });

  it("returns empty object when config is null", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("null");

    const result = loadLocalConfig("/project");

    expect(result).toEqual({});
  });
});

describe("loadLocalGitPolicyConfig", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns all false when no config exists", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadLocalGitPolicyConfig("/project");

    expect(result).toEqual({
      allowAgentCommits: false,
      allowAgentPushes: false,
      allowAgentPRs: false,
    });
  });

  it("returns true values from config", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        allowAgentCommits: true,
        allowAgentPRs: true,
      }),
    );

    const result = loadLocalGitPolicyConfig("/project");

    expect(result).toEqual({
      allowAgentCommits: true,
      allowAgentPushes: false,
      allowAgentPRs: true,
    });
  });
});
