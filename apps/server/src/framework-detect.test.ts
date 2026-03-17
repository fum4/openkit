import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";

import { detectFramework, detectMetroPort } from "./framework-detect";

vi.mock("./logger", () => ({
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
    `openkit-framework-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
});

describe("detectMetroPort", () => {
  it("returns 8081 when no metro config exists", () => {
    const dir = createTempDir();

    expect(detectMetroPort(dir)).toBe(8081);
  });

  it("reads port from metro.config.js", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `const { getDefaultConfig } = require("@react-native/metro-config");
module.exports = {
  ...getDefaultConfig(__dirname),
  server: {
    port: 8082,
  },
};`,
    );

    expect(detectMetroPort(dir)).toBe(8082);
  });

  it("reads port from metro.config.ts", () => {
    const dir = createTempDir();
    writeFileSync(path.join(dir, "metro.config.ts"), `export default { server: { port: 9000 } };`);

    expect(detectMetroPort(dir)).toBe(9000);
  });

  it("returns 8081 when metro config has no explicit port", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { resolver: { sourceExts: ["jsx", "tsx"] } };`,
    );

    expect(detectMetroPort(dir)).toBe(8081);
  });

  it("handles quoted port keys", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { server: { "port": 7777 } };`,
    );

    expect(detectMetroPort(dir)).toBe(7777);
  });

  it("ignores invalid port numbers", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { server: { port: 99999 } };`,
    );

    expect(detectMetroPort(dir)).toBe(8081);
  });

  it("does not match port-like keys such as reportPort", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { server: { reportPort: 9999 } };`,
    );

    // Negative lookbehind ensures "port" is standalone (not preceded by letters)
    expect(detectMetroPort(dir)).toBe(8081);
  });

  it("does not match viewport as a false positive", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { display: { viewport: 9999 } };`,
    );

    expect(detectMetroPort(dir)).toBe(8081);
  });
});
