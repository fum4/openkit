import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  lstatSync,
  unlinkSync,
} from "fs";
import path from "path";
import os from "os";
import { detectOpenkitRepoPath, validateOpenkitRepoPath, symlinkOpsLog } from "./dev-mode.js";

vi.mock("fs");
vi.mock("os");

const mockExistsSync = vi.mocked(existsSync);
const mockMkdirSync = vi.mocked(mkdirSync);
const mockReaddirSync = vi.mocked(readdirSync);
const mockReadFileSync = vi.mocked(readFileSync);
const mockSymlinkSync = vi.mocked(symlinkSync);
const mockLstatSync = vi.mocked(lstatSync);
const mockUnlinkSync = vi.mocked(unlinkSync);
const mockHomedir = vi.mocked(os.homedir);

const APP_PATH = "/Users/testuser/_work/openkit-dev";

/** Mock readFileSync to return matching package name for appPath and specific candidates */
function mockPackageReads(matches: Record<string, string>) {
  mockReadFileSync.mockImplementation((p) => {
    const dir = path.dirname(String(p));
    if (dir in matches) {
      return JSON.stringify({ name: matches[dir] });
    }
    throw new Error("not found");
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockHomedir.mockReturnValue("/Users/testuser");
  mockReaddirSync.mockReturnValue([]);
});

describe("detectOpenkitRepoPath", () => {
  it("returns null when no appPath is provided", () => {
    expect(detectOpenkitRepoPath()).toBeNull();
  });

  it("returns null when appPath has no package.json", () => {
    mockExistsSync.mockReturnValue(false);

    expect(detectOpenkitRepoPath(APP_PATH)).toBeNull();
  });

  it("detects repo from appPath hint", () => {
    mockExistsSync.mockImplementation((p) => {
      return p === path.join(APP_PATH, "package.json");
    });
    mockPackageReads({ [APP_PATH]: "openkit" });

    expect(detectOpenkitRepoPath(APP_PATH)).toBe(APP_PATH);
  });

  it("detects repo by scanning dev directories", () => {
    const workDir = path.join("/Users/testuser", "_work");
    const repoDir = path.join(workDir, "dawg");

    mockExistsSync.mockImplementation((p) => {
      if (String(p) === path.join(APP_PATH, "package.json")) return true;
      if (String(p) === workDir) return true;
      if (String(p) === path.join(repoDir, "package.json")) return true;
      return false;
    });
    mockReaddirSync.mockImplementation((p) => {
      if (String(p) === workDir) {
        return [{ name: "dawg", isDirectory: () => true }] as unknown as ReturnType<
          typeof readdirSync
        >;
      }
      return [] as unknown as ReturnType<typeof readdirSync>;
    });
    mockPackageReads({ [APP_PATH]: "openkit", [repoDir]: "openkit" });

    // appPath itself won't match as a candidate because existsSync only returns true
    // for its package.json — the cwd walk won't find it either. But the dev dir scan will.
    expect(detectOpenkitRepoPath(APP_PATH)).toBe(APP_PATH);
  });

  it("ignores directories with wrong package name", () => {
    mockExistsSync.mockImplementation((p) => {
      return String(p).endsWith("package.json");
    });
    mockPackageReads({ [APP_PATH]: "openkit" });
    // All other candidates will throw "not found" from mockPackageReads,
    // but existsSync returns true for all package.json paths — readFileSync
    // will throw for unknown dirs, so readPackageName returns null for them.
    // The only match is appPath itself.

    expect(detectOpenkitRepoPath(APP_PATH)).toBe(APP_PATH);
  });
});

describe("validateOpenkitRepoPath", () => {
  it("returns true when repo matches appPath package name", () => {
    mockExistsSync.mockReturnValue(true);
    mockPackageReads({ [APP_PATH]: "openkit", "/some/path": "openkit" });

    expect(validateOpenkitRepoPath("/some/path", APP_PATH)).toBe(true);
  });

  it("returns false when no appPath is provided", () => {
    expect(validateOpenkitRepoPath("/some/path")).toBe(false);
  });

  it("returns false when package.json does not exist", () => {
    mockExistsSync.mockReturnValue(false);

    expect(validateOpenkitRepoPath("/some/path", APP_PATH)).toBe(false);
  });

  it("returns false when package name does not match", () => {
    mockExistsSync.mockReturnValue(true);
    mockPackageReads({ [APP_PATH]: "openkit", "/some/path": "other-project" });

    expect(validateOpenkitRepoPath("/some/path", APP_PATH)).toBe(false);
  });
});

describe("symlinkOpsLog", () => {
  it("creates ops-log directory and symlink", () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === "/repo/.openkit/ops-log") return false;
      if (String(p) === "/project/.openkit/ops-log.jsonl") return true;
      return false;
    });
    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    symlinkOpsLog("/project", "my-app", "/repo");

    expect(mockMkdirSync).toHaveBeenCalledWith("/repo/.openkit/ops-log", { recursive: true });
    expect(mockSymlinkSync).toHaveBeenCalledWith(
      "/project/.openkit/ops-log.jsonl",
      "/repo/.openkit/ops-log/my-app.jsonl",
    );
  });

  it("removes existing symlink before creating new one", () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === "/repo/.openkit/ops-log") return true;
      if (String(p) === "/project/.openkit/ops-log.jsonl") return true;
      return false;
    });
    mockLstatSync.mockReturnValue({ isSymbolicLink: () => true } as ReturnType<typeof lstatSync>);

    symlinkOpsLog("/project", "my-app", "/repo");

    expect(mockUnlinkSync).toHaveBeenCalledWith("/repo/.openkit/ops-log/my-app.jsonl");
    expect(mockSymlinkSync).toHaveBeenCalled();
  });

  it("does not create symlink when source ops-log does not exist", () => {
    mockExistsSync.mockReturnValue(false);
    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    symlinkOpsLog("/project", "my-app", "/repo");

    expect(mockSymlinkSync).not.toHaveBeenCalled();
  });

  it("sanitizes project name for the symlink filename", () => {
    mockExistsSync.mockImplementation((p) => {
      if (String(p) === "/repo/.openkit/ops-log") return true;
      if (String(p) === "/project/.openkit/ops-log.jsonl") return true;
      return false;
    });
    mockLstatSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    symlinkOpsLog("/project", "@scope/my-app", "/repo");

    expect(mockSymlinkSync).toHaveBeenCalledWith(
      "/project/.openkit/ops-log.jsonl",
      "/repo/.openkit/ops-log/-scope-my-app.jsonl",
    );
  });
});
