import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";

import { expoAdapter } from "../expo";

vi.mock("../logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const createdDirs: string[] = [];

function createTempDir(): string {
  const dir = path.join(
    tmpdir(),
    `openkit-expo-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  mkdirSync(dir, { recursive: true });
  createdDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of createdDirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors in tests
    }
  }
});

describe("expoAdapter.detect", () => {
  it("returns Expo detection when expo is in deps", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { expo: "~52.0.0", "react-native": "0.76.0" } }),
    );

    const result = expoAdapter.detect(dir);

    expect(result).not.toBeNull();
    expect(result!.framework).toBe("expo");
    expect(result!.spawnOnlyEnv).toEqual({ CI: "0", EXPO_OFFLINE: "0" });
    expect(result!.needsPty).toBe(true);
    expect(result!.needsAdbReverse).toBe(true);
  });

  it("returns null when expo is not in deps", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ dependencies: { "react-native": "0.76.0" } }),
    );

    expect(expoAdapter.detect(dir)).toBeNull();
  });

  it("returns null when package.json is missing", () => {
    const dir = createTempDir();

    expect(expoAdapter.detect(dir)).toBeNull();
  });
});

describe("expoAdapter.getStartCommandPortArgs", () => {
  it("returns -- --port for npm-based Expo project", () => {
    expect(expoAdapter.getStartCommandPortArgs("npm start", 8091)).toEqual([
      "--",
      "--port",
      "8091",
    ]);
  });

  it("returns --port without -- for npx expo start", () => {
    expect(expoAdapter.getStartCommandPortArgs("npx expo start", 8091)).toEqual(["--port", "8091"]);
  });

  it("returns empty array when start command already contains --port", () => {
    expect(expoAdapter.getStartCommandPortArgs("npx expo start --port 3000", 8091)).toEqual([]);
  });
});
