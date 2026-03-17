import { existsSync, readFileSync } from "fs";

import { detectPackageManager, detectStartCommand } from "./detect-config";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);

describe("detectStartCommand", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns npm run dev for generic npm project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("package-lock.json"));

    expect(detectStartCommand("/project")).toBe("npm run dev");
  });

  it("returns yarn dev for generic yarn project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"));

    expect(detectStartCommand("/project")).toBe("yarn dev");
  });

  it("returns pnpm dev for generic pnpm project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("pnpm-lock.yaml"));

    expect(detectStartCommand("/project")).toBe("pnpm dev");
  });

  it("returns npm start for npm-based React Native project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("package-lock.json"));
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
    );

    expect(detectStartCommand("/project")).toBe("npm start");
  });

  it("returns yarn start for yarn-based Expo project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"));
    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ dependencies: { expo: "~52.0.0", "react-native": "0.76.0" } }),
    );

    expect(detectStartCommand("/project")).toBe("yarn start");
  });

  it("returns pnpm start for pnpm-based Expo project", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("pnpm-lock.yaml"));
    mockedReadFileSync.mockReturnValue(JSON.stringify({ dependencies: { expo: "~52.0.0" } }));

    expect(detectStartCommand("/project")).toBe("pnpm start");
  });

  it("returns null when no package manager is detected", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(detectStartCommand("/project")).toBeNull();
  });

  it("falls back to dev command when package.json is missing", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"));
    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(detectStartCommand("/project")).toBe("yarn dev");
  });

  it("falls back to dev command when package.json is malformed", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"));
    mockedReadFileSync.mockReturnValue("not json");

    expect(detectStartCommand("/project")).toBe("yarn dev");
  });
});

describe("detectPackageManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("detects pnpm from pnpm-lock.yaml", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("pnpm-lock.yaml"));

    expect(detectPackageManager("/project")).toBe("pnpm");
  });

  it("detects yarn from yarn.lock", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("yarn.lock"));

    expect(detectPackageManager("/project")).toBe("yarn");
  });

  it("detects npm from package-lock.json", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("package-lock.json"));

    expect(detectPackageManager("/project")).toBe("npm");
  });

  it("detects bun from bun.lockb", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("bun.lockb"));

    expect(detectPackageManager("/project")).toBe("bun");
  });

  it("detects bun from bun.lock (text-based lockfile)", () => {
    mockedExistsSync.mockImplementation((p) => String(p).endsWith("bun.lock"));

    expect(detectPackageManager("/project")).toBe("bun");
  });

  it("returns null when no lock file found", () => {
    mockedExistsSync.mockReturnValue(false);

    expect(detectPackageManager("/project")).toBeNull();
  });
});
