import { existsSync, readFileSync, writeFileSync } from "fs";

import { PortManager } from "../port-manager";
import type { WorktreeConfig } from "../types";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("url", () => ({
  fileURLToPath: () => "/fake/libs/port-offset/src/port-manager.ts",
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
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);

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

function createManager(overrides = {}, configFilePath: string | null = null) {
  return new PortManager(createTestConfig(overrides), configFilePath);
}

describe("PortManager facade", () => {
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

  describe("getDiscoveredPorts", () => {
    it("returns a copy of discovered ports", () => {
      const pm = createManager({ ports: { discovered: [3000, 4000], offsetStep: 10 } });

      expect(pm.getDiscoveredPorts()).toEqual([3000, 4000]);
    });

    it("returns an independent copy that does not mutate the original", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      const ports = pm.getDiscoveredPorts();
      ports.push(9999);

      expect(pm.getDiscoveredPorts()).toEqual([3000]);
    });
  });

  describe("allocateOffset / releaseOffset", () => {
    it("allocates sequential offsets", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      expect(pm.allocateOffset()).toBe(10);
      expect(pm.allocateOffset()).toBe(20);
    });

    it("reuses released offsets", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      const first = pm.allocateOffset();
      pm.allocateOffset();
      pm.releaseOffset(first);

      expect(pm.allocateOffset()).toBe(10);
    });
  });

  describe("getPortsForOffset", () => {
    it("adds offset to each discovered port", () => {
      const pm = createManager({ ports: { discovered: [3000, 4000, 5000], offsetStep: 10 } });

      expect(pm.getPortsForOffset(10)).toEqual([3010, 4010, 5010]);
    });
  });

  describe("getProjectDir", () => {
    it("returns dirname of dirname of configFilePath when provided", () => {
      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getProjectDir()).toBe("/projects/myapp");
    });

    it("returns process.cwd() when no configFilePath", () => {
      const pm = createManager();

      expect(pm.getProjectDir()).toBe(process.cwd());
    });
  });

  describe("getFramework", () => {
    it("returns undefined when no framework is configured or detected", () => {
      const pm = createManager();

      expect(pm.getFramework()).toBeUndefined();
    });

    it("returns persisted framework from config", () => {
      const pm = createManager({ framework: "react-native" });

      expect(pm.getFramework()).toBe("react-native");
    });
  });

  describe("auto-detect framework on construction", () => {
    it("does not detect when framework is already set in config", () => {
      const pm = createManager({ framework: "expo" }, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBe("expo");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("auto-detects expo and persists when not set in config", () => {
      mockedExistsSync.mockImplementation((p) => String(p).endsWith("package.json"));
      mockedReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("package.json")) {
          return JSON.stringify({ dependencies: { expo: "~52.0.0", "react-native": "0.76.0" } });
        }
        if (String(p).endsWith("config.json")) {
          return JSON.stringify({ ports: { discovered: [], offsetStep: 1 } });
        }
        return "";
      });

      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBe("expo");
      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        "/projects/myapp/.openkit/config.json",
        expect.stringContaining('"framework"'),
      );
    });
  });

  describe("needsAdbReverse", () => {
    it("returns false for generic projects", () => {
      const pm = createManager();

      expect(pm.needsAdbReverse()).toBe(false);
    });

    it("returns true for react-native projects", () => {
      const pm = createManager({ framework: "react-native" });

      expect(pm.needsAdbReverse()).toBe(true);
    });
  });

  describe("getStartCommandPortArgs", () => {
    it("returns empty array for generic framework", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      expect(pm.getStartCommandPortArgs("npm run dev", 10)).toEqual([]);
    });

    it("returns -- --port for npm-based RN project", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "react-native",
      });

      expect(pm.getStartCommandPortArgs("npm start", 10)).toEqual(["--", "--port", "8091"]);
    });

    it("returns --port without -- for yarn", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "react-native",
      });

      expect(pm.getStartCommandPortArgs("yarn start", 10)).toEqual(["--port", "8091"]);
    });
  });

  describe("getEnvForOffset", () => {
    it("returns empty object when no ports are discovered", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 1 } });

      expect(pm.getEnvForOffset(10)).toEqual({});
    });

    it("includes port hook env vars", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 1 } });

      const env = pm.getEnvForOffset(10);

      expect(env.__WM_PORT_OFFSET__).toBe("10");
      expect(env.__WM_KNOWN_PORTS__).toBe("[3000]");
      expect(env.NODE_OPTIONS).toContain("--require");
    });

    it("resolves envMapping templates with offset", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [3000], offsetStep: 1 },
        envMapping: {
          VITE_API_URL: "http://localhost:${3000}/api",
        },
      });

      const env = pm.getEnvForOffset(10);

      expect(env.VITE_API_URL).toBe("http://localhost:3010/api");
    });
  });

  describe("setDebugLogger", () => {
    it("accepts a debug logger function", () => {
      const pm = createManager();
      const logger = vi.fn();

      expect(() => pm.setDebugLogger(logger)).not.toThrow();
    });

    it("accepts null to clear logger", () => {
      const pm = createManager();

      expect(() => pm.setDebugLogger(null)).not.toThrow();
    });
  });
});
