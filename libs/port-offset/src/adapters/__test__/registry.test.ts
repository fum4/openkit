import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";

import { detectFramework, getAdapter } from "../registry";

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
    `openkit-adapter-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

function writePackageJson(
  dir: string,
  deps: Record<string, string> = {},
  devDeps: Record<string, string> = {},
) {
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({ dependencies: deps, devDependencies: devDeps }),
  );
}

describe("detectFramework", () => {
  it("detects Expo project from dependencies", () => {
    const dir = createTempDir();
    writePackageJson(dir, { expo: "~52.0.0", "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.framework).toBe("expo");
    expect(result.defaultPorts).toEqual([8081]);
    expect(result.envVarTemplates).toEqual({ RCT_METRO_PORT: "${8081}" });
    expect(result.needsAdbReverse).toBe(true);
  });

  it("detects Expo from devDependencies", () => {
    const dir = createTempDir();
    writePackageJson(dir, {}, { expo: "~52.0.0", "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.framework).toBe("expo");
  });

  it("detects bare React Native project (no Expo)", () => {
    const dir = createTempDir();
    writePackageJson(dir, { "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.framework).toBe("react-native");
    expect(result.defaultPorts).toEqual([8081]);
    expect(result.envVarTemplates).toEqual({ RCT_METRO_PORT: "${8081}" });
    expect(result.needsAdbReverse).toBe(true);
  });

  it("returns generic when no React Native dependency", () => {
    const dir = createTempDir();
    writePackageJson(dir, { react: "^19.0.0", "react-dom": "^19.0.0" });

    const result = detectFramework(dir);

    expect(result.framework).toBe("generic");
    expect(result.defaultPorts).toEqual([]);
    expect(result.envVarTemplates).toEqual({});
    expect(result.needsAdbReverse).toBe(false);
  });

  it("returns generic when package.json is missing", () => {
    const dir = createTempDir();

    const result = detectFramework(dir);

    expect(result.framework).toBe("generic");
  });

  it("returns generic when package.json is malformed", () => {
    const dir = createTempDir();
    writeFileSync(path.join(dir, "package.json"), "not json");

    const result = detectFramework(dir);

    expect(result.framework).toBe("generic");
  });

  it("uses custom Metro port from metro.config.js", () => {
    const dir = createTempDir();
    writePackageJson(dir, { "react-native": "0.76.0" });
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { server: { port: 9090 } };`,
    );

    const result = detectFramework(dir);

    expect(result.framework).toBe("react-native");
    expect(result.defaultPorts).toEqual([9090]);
    expect(result.envVarTemplates).toEqual({ RCT_METRO_PORT: "${9090}" });
  });

  it("prefers expo over react-native when both present", () => {
    const dir = createTempDir();
    writePackageJson(dir, { expo: "~52.0.0", "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.framework).toBe("expo");
  });

  it("returns spawnOnlyEnv for expo", () => {
    const dir = createTempDir();
    writePackageJson(dir, { expo: "~52.0.0", "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.spawnOnlyEnv).toEqual({ CI: "0", EXPO_OFFLINE: "0" });
  });

  it("sets needsPty for react-native", () => {
    const dir = createTempDir();
    writePackageJson(dir, { "react-native": "0.76.0" });

    const result = detectFramework(dir);

    expect(result.needsPty).toBe(true);
  });
});

describe("getAdapter", () => {
  it("returns expo adapter for expo framework", () => {
    expect(getAdapter("expo").id).toBe("expo");
  });

  it("returns react-native adapter for react-native framework", () => {
    expect(getAdapter("react-native").id).toBe("react-native");
  });

  it("returns generic adapter for generic framework", () => {
    expect(getAdapter("generic").id).toBe("generic");
  });
});
