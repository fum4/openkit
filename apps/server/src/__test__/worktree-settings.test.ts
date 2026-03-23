import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { log } from "../logger";
import {
  deleteWorktreeSettings,
  loadWorktreeSettings,
  updateWorktreeSettings,
} from "../worktree-settings";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  unlinkSync: vi.fn(),
}));

vi.mock("../logger", () => ({
  log: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

describe("loadWorktreeSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns {} when file does not exist", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    const result = loadWorktreeSettings("/project", "wt-1");

    expect(result).toEqual({});
  });

  it("returns settings for an existing worktree", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "wt-1": { autoCleanupOnMerge: true, autoCleanupOnClose: false },
        "wt-2": { autoCleanupOnMerge: false },
      }),
    );

    const result = loadWorktreeSettings("/project", "wt-1");

    expect(result).toEqual({ autoCleanupOnMerge: true, autoCleanupOnClose: false });
  });

  it("returns {} for an unknown worktree ID", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ "wt-1": { autoCleanupOnMerge: true } }),
    );

    const result = loadWorktreeSettings("/project", "wt-unknown");

    expect(result).toEqual({});
  });

  it("returns {} on malformed JSON and logs a warning", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue("{invalid json");

    const result = loadWorktreeSettings("/project", "wt-1");

    expect(result).toEqual({});
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("Failed to parse worktree settings"),
      expect.objectContaining({ domain: "config" }),
    );
  });
});

describe("updateWorktreeSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("creates a new file and sets the override", () => {
    vi.mocked(existsSync).mockReturnValue(false);

    updateWorktreeSettings("/project", "wt-1", { autoCleanupOnMerge: true });

    expect(writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining("worktree-settings.json"),
      expect.stringContaining('"autoCleanupOnMerge": true'),
    );
    expect(mkdirSync).toHaveBeenCalledWith(expect.stringContaining(".openkit"), {
      recursive: true,
    });
  });

  it("merges patch into existing settings for a worktree", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ "wt-1": { autoCleanupOnMerge: false } }),
    );

    updateWorktreeSettings("/project", "wt-1", { autoCleanupOnClose: true });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed["wt-1"]).toEqual({ autoCleanupOnMerge: false, autoCleanupOnClose: true });
  });

  it("removes a field when value is null", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ "wt-1": { autoCleanupOnMerge: true, autoCleanupOnClose: false } }),
    );

    updateWorktreeSettings("/project", "wt-1", { autoCleanupOnMerge: null });

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed["wt-1"]).toEqual({ autoCleanupOnClose: false });
    expect(parsed["wt-1"]).not.toHaveProperty("autoCleanupOnMerge");
  });

  it("removes worktree entry and deletes file when result is empty", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ "wt-1": { autoCleanupOnMerge: true } }),
    );

    updateWorktreeSettings("/project", "wt-1", { autoCleanupOnMerge: null });

    expect(unlinkSync).toHaveBeenCalledWith(expect.stringContaining("worktree-settings.json"));
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

describe("deleteWorktreeSettings", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("removes a worktree entry and writes the remaining entries", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({
        "wt-1": { autoCleanupOnMerge: true },
        "wt-2": { autoCleanupOnClose: false },
      }),
    );

    deleteWorktreeSettings("/project", "wt-1");

    const written = vi.mocked(writeFileSync).mock.calls[0][1] as string;
    const parsed = JSON.parse(written);
    expect(parsed).not.toHaveProperty("wt-1");
    expect(parsed["wt-2"]).toEqual({ autoCleanupOnClose: false });
  });

  it("is a no-op when worktree is not in file", () => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(
      JSON.stringify({ "wt-1": { autoCleanupOnMerge: true } }),
    );

    deleteWorktreeSettings("/project", "wt-not-present");

    expect(writeFileSync).not.toHaveBeenCalled();
    expect(unlinkSync).not.toHaveBeenCalled();
  });
});
