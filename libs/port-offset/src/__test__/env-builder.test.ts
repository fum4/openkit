import { existsSync } from "fs";

import { buildOffsetEnvironment } from "../env-builder";
import type { FrameworkDetectionResult, WorktreeConfig } from "../types";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
}));

vi.mock("url", () => ({
  fileURLToPath: () => "/fake/libs/port-offset/src/hook-resolver.ts",
}));

vi.mock("./logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockedExistsSync = vi.mocked(existsSync);

function createTestConfig(overrides: Partial<WorktreeConfig> = {}): WorktreeConfig {
  return {
    projectDir: "",
    startCommand: "pnpm dev",
    installCommand: "pnpm install",
    baseBranch: "main",
    ports: { discovered: [3000], offsetStep: 1 },
    ...overrides,
  };
}

describe("buildOffsetEnvironment", () => {
  const originalPlatform = process.platform;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    process.env = originalEnv;
  });

  it("returns empty env when no ports are discovered and generic", () => {
    const config = createTestConfig({ ports: { discovered: [], offsetStep: 1 } });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env).toEqual({});
    expect(result.extraArgs).toEqual([]);
    expect(result.needsPty).toBe(false);
    expect(result.needsAdbReverse).toBe(false);
  });

  it("includes __WM_PORT_OFFSET__ as string", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({ ports: { discovered: [3000], offsetStep: 1 } });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.__WM_PORT_OFFSET__).toBe("10");
  });

  it("includes __WM_KNOWN_PORTS__ as JSON array", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({ ports: { discovered: [3000, 4000], offsetStep: 1 } });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.__WM_KNOWN_PORTS__).toBe("[3000,4000]");
  });

  it("includes NODE_OPTIONS with --require hook path", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig();

    const result = buildOffsetEnvironment(config, 5, null, "pnpm dev");

    expect(result.env.NODE_OPTIONS).toContain("--require");
    expect(result.env.NODE_OPTIONS).toContain("port-hook.cjs");
  });

  it("appends to existing NODE_OPTIONS", () => {
    process.env.NODE_OPTIONS = "--max-old-space-size=4096";
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig();

    const result = buildOffsetEnvironment(config, 5, null, "pnpm dev");

    expect(result.env.NODE_OPTIONS).toContain("--max-old-space-size=4096");
    expect(result.env.NODE_OPTIONS).toContain("--require");
  });

  it("sets DYLD_INSERT_LIBRARIES on macOS when native hook exists", () => {
    Object.defineProperty(process, "platform", { value: "darwin" });
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("libport-hook.dylib");
    });
    const config = createTestConfig({ useNativePortHook: true });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.DYLD_INSERT_LIBRARIES).toContain("libport-hook.dylib");
    expect(result.env.LD_PRELOAD).toBeUndefined();
  });

  it("sets LD_PRELOAD on Linux when native hook exists", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockedExistsSync.mockImplementation((p) => {
      return String(p).includes("libport-hook.so");
    });
    const config = createTestConfig({ useNativePortHook: true });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.LD_PRELOAD).toContain("libport-hook.so");
    expect(result.env.DYLD_INSERT_LIBRARIES).toBeUndefined();
  });

  it("resolves envMapping templates with offset", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({
      ports: { discovered: [3000], offsetStep: 1 },
      envMapping: {
        VITE_API_URL: "http://localhost:${3000}/api",
        DATABASE_URL: "postgres://localhost:${3000}/db",
      },
    });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.VITE_API_URL).toBe("http://localhost:3010/api");
    expect(result.env.DATABASE_URL).toBe("postgres://localhost:3010/db");
  });

  it("resolves multiple port references in a single template", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({
      ports: { discovered: [3000, 4000], offsetStep: 10 },
      envMapping: {
        SERVICES: "${3000},${4000}",
      },
    });

    const result = buildOffsetEnvironment(config, 20, null, "pnpm dev");

    expect(result.env.SERVICES).toBe("3020,4020");
  });

  it("provides RCT_METRO_PORT from default port when discovered is empty for RN", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({
      ports: { discovered: [], offsetStep: 10 },
      framework: "expo",
    });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.env.RCT_METRO_PORT).toBe("8091");
  });

  it("does not include CI/EXPO_OFFLINE in env (scoped to spawnOnlyEnv)", () => {
    mockedExistsSync.mockReturnValue(false);
    const expoDetection: FrameworkDetectionResult = {
      framework: "expo",
      defaultPorts: [8081],
      envVarTemplates: { RCT_METRO_PORT: "${8081}" },
      needsAdbReverse: true,
      spawnOnlyEnv: { CI: "0", EXPO_OFFLINE: "0" },
      needsPty: true,
    };
    const config = createTestConfig({
      ports: { discovered: [8081], offsetStep: 10 },
    });

    const result = buildOffsetEnvironment(config, 10, expoDetection, "npm start");

    expect(result.env.CI).toBeUndefined();
    expect(result.env.EXPO_OFFLINE).toBeUndefined();
    expect(result.spawnOnlyEnv.CI).toBe("0");
    expect(result.spawnOnlyEnv.EXPO_OFFLINE).toBe("0");
  });

  it("sets needsPty and needsAdbReverse from detection", () => {
    mockedExistsSync.mockReturnValue(false);
    const rnDetection: FrameworkDetectionResult = {
      framework: "react-native",
      defaultPorts: [8081],
      envVarTemplates: {},
      needsAdbReverse: true,
      needsPty: true,
    };
    const config = createTestConfig({
      ports: { discovered: [8081], offsetStep: 10 },
    });

    const result = buildOffsetEnvironment(config, 10, rnDetection, "yarn start");

    expect(result.needsPty).toBe(true);
    expect(result.needsAdbReverse).toBe(true);
    expect(result.extraArgs).toEqual(["--port", "8091"]);
  });

  it("returns extraArgs for RN with npm start", () => {
    mockedExistsSync.mockReturnValue(false);
    const rnDetection: FrameworkDetectionResult = {
      framework: "react-native",
      defaultPorts: [8081],
      envVarTemplates: {},
      needsAdbReverse: true,
      needsPty: true,
    };
    const config = createTestConfig({
      ports: { discovered: [8081], offsetStep: 10 },
    });

    const result = buildOffsetEnvironment(config, 10, rnDetection, "npm start");

    expect(result.extraArgs).toEqual(["--", "--port", "8091"]);
  });

  it("computes offset ports correctly", () => {
    mockedExistsSync.mockReturnValue(false);
    const config = createTestConfig({
      ports: { discovered: [3000, 4000, 5000], offsetStep: 10 },
    });

    const result = buildOffsetEnvironment(config, 10, null, "pnpm dev");

    expect(result.ports).toEqual([3010, 4010, 5010]);
    expect(result.offset).toBe(10);
  });
});
