import { existsSync } from "fs";

import { getNativeHookPath, getNodeHookPath } from "../hook-resolver";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("url", () => ({
  fileURLToPath: () => "/fake/libs/port-offset/src/hook-resolver.ts",
}));

const mockedExistsSync = vi.mocked(existsSync);

describe("getNativeHookPath", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns null when no native hook is found", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(getNativeHookPath()).toBeNull();
  });

  it("returns dev hook path when it exists on macOS", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("hooks/libc/zig-out/lib/libport-hook.dylib");
    });

    const result = getNativeHookPath();

    expect(result).not.toBeNull();
    expect(result).toContain("libport-hook.dylib");
  });

  it("returns dev hook path when it exists on Linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("hooks/libc/zig-out/lib/libport-hook.so");
    });

    const result = getNativeHookPath();

    expect(result).not.toBeNull();
    expect(result).toContain("libport-hook.so");
  });

  it("falls back to bundled hook path", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    let callCount = 0;
    mockedExistsSync.mockImplementation((p) => {
      const pathStr = String(p);
      if (pathStr.includes("zig-out")) return false;
      if (pathStr.includes("runtime/libport-hook.dylib")) {
        callCount++;
        return callCount === 1;
      }
      return false;
    });

    const result = getNativeHookPath();

    expect(result).not.toBeNull();
    expect(result).toContain("runtime/libport-hook.dylib");
  });
});

describe("getNodeHookPath", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns hooks/node/dist path when it exists", () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("hooks/node/dist/port-hook.cjs");
    });

    expect(getNodeHookPath()).toContain("port-hook.cjs");
  });

  it("falls back to server dist/runtime path", () => {
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("dist/runtime/port-hook.cjs");
    });

    expect(getNodeHookPath()).toContain("dist/runtime/port-hook.cjs");
  });

  it("returns hooks/node/dist path as final fallback when no path exists", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(getNodeHookPath()).toContain("port-hook.cjs");
  });
});
