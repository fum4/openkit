import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import { tmpdir } from "os";

import { DEFAULT_METRO_PORT, detectMetroPort, reactNativeAdapter } from "../react-native";

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
    `openkit-rn-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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

describe("detectMetroPort", () => {
  it("returns 8081 when no metro config exists", () => {
    const dir = createTempDir();

    expect(detectMetroPort(dir)).toBe(DEFAULT_METRO_PORT);
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

    expect(detectMetroPort(dir)).toBe(DEFAULT_METRO_PORT);
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

    expect(detectMetroPort(dir)).toBe(DEFAULT_METRO_PORT);
  });

  it("does not match port-like keys such as reportPort", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { server: { reportPort: 9999 } };`,
    );

    expect(detectMetroPort(dir)).toBe(DEFAULT_METRO_PORT);
  });

  it("does not match viewport as a false positive", () => {
    const dir = createTempDir();
    writeFileSync(
      path.join(dir, "metro.config.js"),
      `module.exports = { display: { viewport: 9999 } };`,
    );

    expect(detectMetroPort(dir)).toBe(DEFAULT_METRO_PORT);
  });
});

describe("getStartCommandPortArgs", () => {
  it("returns -- --port for npm-based RN project", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("npm start", 8091)).toEqual([
      "--",
      "--port",
      "8091",
    ]);
  });

  it("returns --port without -- for yarn-based RN project", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("yarn start", 8091)).toEqual([
      "--port",
      "8091",
    ]);
  });

  it("returns --port without -- for pnpm-based project", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("pnpm start", 8091)).toEqual([
      "--port",
      "8091",
    ]);
  });

  it("returns --port without -- for npx expo start", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("npx expo start", 8091)).toEqual([
      "--port",
      "8091",
    ]);
  });

  it("returns empty array when start command already contains --port", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("npx expo start --port 3000", 8091)).toEqual(
      [],
    );
  });

  it("returns --port without -- for bun start", () => {
    expect(reactNativeAdapter.getStartCommandPortArgs("bun start", 8091)).toEqual([
      "--port",
      "8091",
    ]);
  });
});
