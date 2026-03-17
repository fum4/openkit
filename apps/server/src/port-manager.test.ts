import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";
import type { Dirent } from "fs";

import { PortManager } from "./port-manager";
import { createTestConfig } from "./test/fixtures";

vi.mock("fs", () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("child_process", () => ({
  execFileSync: vi.fn(),
  spawn: vi.fn(),
}));

vi.mock("url", () => ({
  fileURLToPath: () => "/fake/apps/server/src/port-manager.ts",
}));

const mockedExistsSync = vi.mocked(existsSync);
const mockedReadFileSync = vi.mocked(readFileSync);
const mockedWriteFileSync = vi.mocked(writeFileSync);
const mockedReaddirSync = vi.mocked(readdirSync);

function makeDirent(name: string, isDir: boolean): Dirent {
  return {
    name,
    isFile: () => !isDir,
    isDirectory: () => isDir,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: "",
    path: "",
  } as Dirent;
}

function createManager(overrides = {}, configFilePath: string | null = null) {
  return new PortManager(createTestConfig(overrides), configFilePath);
}

describe("PortManager", () => {
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

    it("returns empty array when no ports discovered", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(pm.getDiscoveredPorts()).toEqual([]);
    });
  });

  describe("getOffsetStep", () => {
    it("returns the configured offset step", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(pm.getOffsetStep()).toBe(10);
    });

    it("returns different step values", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 100 } });

      expect(pm.getOffsetStep()).toBe(100);
    });
  });

  describe("allocateOffset", () => {
    it("allocates first offset equal to offsetStep", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(pm.allocateOffset()).toBe(10);
    });

    it("allocates sequential offsets (1*step, 2*step, 3*step)", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      expect(pm.allocateOffset()).toBe(10);
      expect(pm.allocateOffset()).toBe(20);
      expect(pm.allocateOffset()).toBe(30);
    });

    it("reuses released offsets before allocating new ones", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      const first = pm.allocateOffset(); // 10
      pm.allocateOffset(); // 20
      pm.releaseOffset(first);

      expect(pm.allocateOffset()).toBe(10);
    });

    it("fills the lowest gap first", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 5 } });

      pm.allocateOffset(); // 5
      const second = pm.allocateOffset(); // 10
      pm.allocateOffset(); // 15
      pm.releaseOffset(second); // release 10

      expect(pm.allocateOffset()).toBe(10);
      expect(pm.allocateOffset()).toBe(20);
    });

    it("handles step of 1 correctly", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 1 } });

      expect(pm.allocateOffset()).toBe(1);
      expect(pm.allocateOffset()).toBe(2);
      expect(pm.allocateOffset()).toBe(3);
    });
  });

  describe("releaseOffset", () => {
    it("releases an offset so it can be reallocated", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      const offset = pm.allocateOffset();
      pm.releaseOffset(offset);

      expect(pm.allocateOffset()).toBe(offset);
    });

    it("does not error when releasing an offset that was never allocated", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(() => pm.releaseOffset(999)).not.toThrow();
    });

    it("allows multiple release-reallocate cycles", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      const offset = pm.allocateOffset(); // 10
      pm.releaseOffset(offset);
      expect(pm.allocateOffset()).toBe(10);
      pm.releaseOffset(10);
      expect(pm.allocateOffset()).toBe(10);
    });
  });

  describe("getPortsForOffset", () => {
    it("adds offset to each discovered port", () => {
      const pm = createManager({ ports: { discovered: [3000, 4000, 5000], offsetStep: 10 } });

      expect(pm.getPortsForOffset(10)).toEqual([3010, 4010, 5010]);
    });

    it("returns empty array when no discovered ports", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(pm.getPortsForOffset(10)).toEqual([]);
    });

    it("handles single port", () => {
      const pm = createManager({ ports: { discovered: [8080], offsetStep: 10 } });

      expect(pm.getPortsForOffset(20)).toEqual([8100]);
    });
  });

  describe("getNativeHookPath", () => {
    it("returns null when no native hook is found", () => {
      mockedExistsSync.mockReturnValue(false);

      const pm = createManager();
      expect(pm.getNativeHookPath()).toBeNull();
    });

    it("returns dev hook path when it exists on macOS", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes("libs/port-resolution/zig-out/lib/libport-hook.dylib");
      });

      const pm = createManager();
      const result = pm.getNativeHookPath();

      expect(result).not.toBeNull();
      expect(result).toContain("libport-hook.dylib");
    });

    it("returns dev hook path when it exists on Linux", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes("libs/port-resolution/zig-out/lib/libport-hook.so");
      });

      const pm = createManager();
      const result = pm.getNativeHookPath();

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

      const pm = createManager();
      const result = pm.getNativeHookPath();

      expect(result).not.toBeNull();
      expect(result).toContain("runtime/libport-hook.dylib");
    });
  });

  describe("getHookPath", () => {
    it("returns src runtime path when it exists", () => {
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes(path.join("src", "runtime", "port-hook.cjs"));
      });

      const pm = createManager();
      expect(pm.getHookPath()).toContain("port-hook.cjs");
    });

    it("falls back to dist path when src path does not exist", () => {
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes(path.join("dist", "runtime", "port-hook.cjs"));
      });

      const pm = createManager();
      expect(pm.getHookPath()).toContain(path.join("dist", "runtime", "port-hook.cjs"));
    });

    it("returns src path as final fallback when no path exists", () => {
      mockedExistsSync.mockReturnValue(false);

      const pm = createManager();
      expect(pm.getHookPath()).toContain("port-hook.cjs");
    });
  });

  describe("getEnvForOffset", () => {
    it("returns empty object when no ports are discovered", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 1 } });

      expect(pm.getEnvForOffset(10)).toEqual({});
    });

    it("includes __WM_PORT_OFFSET__ as string", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 1 } });

      const env = pm.getEnvForOffset(10);

      expect(env.__WM_PORT_OFFSET__).toBe("10");
    });

    it("includes __WM_KNOWN_PORTS__ as JSON array", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({ ports: { discovered: [3000, 4000], offsetStep: 1 } });

      const env = pm.getEnvForOffset(10);

      expect(env.__WM_KNOWN_PORTS__).toBe("[3000,4000]");
    });

    it("includes NODE_OPTIONS with --require hook path", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager();

      const env = pm.getEnvForOffset(5);

      expect(env.NODE_OPTIONS).toContain("--require");
      expect(env.NODE_OPTIONS).toContain("port-hook.cjs");
    });

    it("appends to existing NODE_OPTIONS", () => {
      process.env.NODE_OPTIONS = "--max-old-space-size=4096";
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager();

      const env = pm.getEnvForOffset(5);

      expect(env.NODE_OPTIONS).toContain("--max-old-space-size=4096");
      expect(env.NODE_OPTIONS).toContain("--require");
    });

    it("sets DYLD_INSERT_LIBRARIES on macOS when native hook exists", () => {
      Object.defineProperty(process, "platform", { value: "darwin" });
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes("libport-hook.dylib");
      });
      const pm = createManager();
      pm.useNativeHook = true;

      const env = pm.getEnvForOffset(10);

      expect(env.DYLD_INSERT_LIBRARIES).toContain("libport-hook.dylib");
      expect(env.LD_PRELOAD).toBeUndefined();
    });

    it("sets LD_PRELOAD on Linux when native hook exists", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      mockedExistsSync.mockImplementation((p) => {
        return String(p).includes("libport-hook.so");
      });
      const pm = createManager();
      pm.useNativeHook = true;

      const env = pm.getEnvForOffset(10);

      expect(env.LD_PRELOAD).toContain("libport-hook.so");
      expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
    });

    it("omits native hook env vars when hook is not found", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager();

      const env = pm.getEnvForOffset(10);

      expect(env.DYLD_INSERT_LIBRARIES).toBeUndefined();
      expect(env.LD_PRELOAD).toBeUndefined();
    });

    it("resolves envMapping templates with offset", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [3000], offsetStep: 1 },
        envMapping: {
          VITE_API_URL: "http://localhost:${3000}/api",
          DATABASE_URL: "postgres://localhost:${3000}/db",
        },
      });

      const env = pm.getEnvForOffset(10);

      expect(env.VITE_API_URL).toBe("http://localhost:3010/api");
      expect(env.DATABASE_URL).toBe("postgres://localhost:3010/db");
    });

    it("resolves multiple port references in a single template", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [3000, 4000], offsetStep: 10 },
        envMapping: {
          SERVICES: "${3000},${4000}",
        },
      });

      const env = pm.getEnvForOffset(20);

      expect(env.SERVICES).toBe("3020,4020");
    });

    it("does not include envMapping keys when envMapping is undefined", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 1 } });

      const env = pm.getEnvForOffset(10);

      const coreKeys = ["__WM_PORT_OFFSET__", "__WM_KNOWN_PORTS__", "NODE_OPTIONS"];
      for (const key of Object.keys(env)) {
        expect(coreKeys).toContain(key);
      }
    });
  });

  describe("detectEnvMapping", () => {
    it("returns empty object when no ports discovered", () => {
      const pm = createManager({ ports: { discovered: [], offsetStep: 10 } });

      expect(pm.detectEnvMapping("/project")).toEqual({});
    });

    it("finds ports in .env files and creates templates", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue("API_URL=http://localhost:3000\n");

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
    });

    it("handles double-quoted values", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue('API_URL="http://localhost:3000"\n');

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
    });

    it("handles single-quoted values", () => {
      const pm = createManager({ ports: { discovered: [4000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue("WS_URL='ws://localhost:4000'\n");

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ WS_URL: "ws://localhost:${4000}" });
    });

    it("skips comments and empty lines", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue("# PORT=3000\n\nAPI_URL=http://localhost:3000\n");

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
    });

    it("skips lines without port references", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue("NODE_ENV=production\nAPI_URL=http://localhost:3000\n");

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
      expect(mapping).not.toHaveProperty("NODE_ENV");
    });

    it("skips node_modules and .git directories", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockImplementation((dir) => {
        const dirStr = String(dir);
        if (dirStr === "/project") {
          return [
            makeDirent("node_modules", true),
            makeDirent(".git", true),
            makeDirent("src", true),
            makeDirent(".env", false),
          ] as unknown as ReturnType<typeof readdirSync>;
        }
        if (dirStr === path.join("/project", "src")) {
          return [makeDirent(".env.local", false)] as unknown as ReturnType<typeof readdirSync>;
        }
        return [] as unknown as ReturnType<typeof readdirSync>;
      });

      mockedReadFileSync.mockImplementation((filePath) => {
        const p = String(filePath);
        if (p === path.join("/project", ".env")) return "PORT=3000\n";
        if (p === path.join("/project", "src", ".env.local")) return "API=http://localhost:3000\n";
        return "";
      });

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({
        PORT: "${3000}",
        API: "http://localhost:${3000}",
      });

      expect(mockedReaddirSync).not.toHaveBeenCalledWith(
        path.join("/project", "node_modules"),
        expect.anything(),
      );
      expect(mockedReaddirSync).not.toHaveBeenCalledWith(
        path.join("/project", ".git"),
        expect.anything(),
      );
    });

    it("detects multiple ports in a single value", () => {
      const pm = createManager({ ports: { discovered: [3000, 4000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
        typeof readdirSync
      >);
      mockedReadFileSync.mockReturnValue("SERVICES=http://localhost:3000,http://localhost:4000\n");

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ SERVICES: "http://localhost:${3000},http://localhost:${4000}" });
    });

    it("handles unreadable directories gracefully", () => {
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } });

      mockedReaddirSync.mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      expect(() => pm.detectEnvMapping("/project")).not.toThrow();
      expect(pm.detectEnvMapping("/project")).toEqual({});
    });

    it("scans .env.local and .env.production files", () => {
      const pm = createManager({ ports: { discovered: [5000], offsetStep: 10 } });

      mockedReaddirSync.mockReturnValue([
        makeDirent(".env.local", false),
        makeDirent(".env.production", false),
        makeDirent("package.json", false),
      ] as unknown as ReturnType<typeof readdirSync>);

      mockedReadFileSync.mockImplementation((filePath) => {
        const p = String(filePath);
        if (p.endsWith(".env.local")) return "DEV_URL=http://localhost:5000\n";
        if (p.endsWith(".env.production")) return "PROD_URL=http://prod.example.com\n";
        return "";
      });

      const mapping = pm.detectEnvMapping("/project");

      expect(mapping).toEqual({ DEV_URL: "http://localhost:${5000}" });
      expect(mapping).not.toHaveProperty("PROD_URL");
    });
  });

  describe("getProjectDir", () => {
    it("returns dirname of dirname of configFilePath when provided", () => {
      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getProjectDir()).toBe(path.resolve("/projects/myapp"));
    });

    it("returns process.cwd() when no configFilePath", () => {
      const pm = createManager();

      expect(pm.getProjectDir()).toBe(process.cwd());
    });

    it("returns process.cwd() when configFilePath is explicitly null", () => {
      const pm = createManager({}, null);

      expect(pm.getProjectDir()).toBe(process.cwd());
    });
  });

  describe("persistEnvMapping", () => {
    it("writes envMapping to config file", () => {
      const configPath = "/projects/myapp/.openkit/config.json";
      const pm = createManager({ ports: { discovered: [3000], offsetStep: 10 } }, configPath);

      const existingConfig = {
        startCommand: "npm start",
        ports: { discovered: [3000], offsetStep: 10 },
      };
      mockedReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

      const mapping = { API_URL: "http://localhost:${3000}" };
      pm.persistEnvMapping(mapping);

      expect(mockedWriteFileSync).toHaveBeenCalledWith(
        configPath,
        expect.stringContaining('"envMapping"'),
      );

      const writtenContent = JSON.parse((mockedWriteFileSync.mock.calls[0][1] as string).trim());
      expect(writtenContent.envMapping).toEqual(mapping);
    });

    it("no-ops when configFilePath is null", () => {
      const pm = createManager({}, null);

      pm.persistEnvMapping({ API_URL: "http://localhost:${3000}" });

      expect(mockedWriteFileSync).not.toHaveBeenCalled();
      expect(mockedReadFileSync).not.toHaveBeenCalled();
    });

    it("updates config.envMapping in memory even before writing", () => {
      const config = createTestConfig({ ports: { discovered: [3000], offsetStep: 10 } });
      const pm = new PortManager(config, "/path/to/.openkit/config.json");

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ ports: { discovered: [3000], offsetStep: 10 } }),
      );

      const mapping = { PORT: "${3000}" };
      pm.persistEnvMapping(mapping);

      expect(config.envMapping).toEqual(mapping);
    });

    it("handles read errors gracefully without throwing", () => {
      const pm = createManager(
        { ports: { discovered: [3000], offsetStep: 10 } },
        "/nonexistent/.openkit/config.json",
      );

      mockedReadFileSync.mockImplementation(() => {
        throw new Error("ENOENT: no such file or directory");
      });

      expect(() => pm.persistEnvMapping({ PORT: "${3000}" })).not.toThrow();
    });

    it("writes pretty-printed JSON with trailing newline", () => {
      const configPath = "/projects/myapp/.openkit/config.json";
      const pm = createManager({}, configPath);

      mockedReadFileSync.mockReturnValue(
        JSON.stringify({ ports: { discovered: [], offsetStep: 1 } }),
      );

      pm.persistEnvMapping({ PORT: "${3000}" });

      const written = mockedWriteFileSync.mock.calls[0][1] as string;
      expect(written).toMatch(/\n$/);
      expect(written).toContain("  "); // indented
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

    it("returns persisted expo framework from config", () => {
      const pm = createManager({ framework: "expo" });

      expect(pm.getFramework()).toBe("expo");
    });
  });

  describe("auto-detect framework on construction", () => {
    it("does not detect when framework is already set in config", () => {
      const pm = createManager({ framework: "expo" }, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBe("expo");
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("does not detect when configFilePath is null", () => {
      const pm = createManager();

      expect(pm.getFramework()).toBeUndefined();
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

    it("auto-detects react-native when not set in config", () => {
      mockedExistsSync.mockImplementation((p) => String(p).endsWith("package.json"));
      mockedReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("package.json")) {
          return JSON.stringify({ dependencies: { "react-native": "0.76.0" } });
        }
        if (String(p).endsWith("config.json")) {
          return JSON.stringify({ ports: { discovered: [], offsetStep: 1 } });
        }
        return "";
      });

      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBe("react-native");
    });

    it("does not persist when detection returns generic", () => {
      mockedExistsSync.mockImplementation((p) => String(p).endsWith("package.json"));
      mockedReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith("package.json")) {
          return JSON.stringify({ dependencies: { react: "^19.0.0" } });
        }
        return "";
      });

      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBeUndefined();
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
    });

    it("handles missing package.json gracefully", () => {
      mockedExistsSync.mockReturnValue(false);

      const pm = createManager({}, "/projects/myapp/.openkit/config.json");

      expect(pm.getFramework()).toBeUndefined();
      expect(mockedWriteFileSync).not.toHaveBeenCalled();
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

    it("returns true for expo projects", () => {
      const pm = createManager({ framework: "expo" });

      expect(pm.needsAdbReverse()).toBe(true);
    });

    it("returns false for generic framework in config", () => {
      const pm = createManager({ framework: "generic" });

      expect(pm.needsAdbReverse()).toBe(false);
    });
  });

  describe("getEnvForOffset with RCT_METRO_PORT", () => {
    it("resolves RCT_METRO_PORT template from envMapping", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 1 },
        envMapping: { RCT_METRO_PORT: "${8081}" },
      });

      const env = pm.getEnvForOffset(1);

      expect(env.RCT_METRO_PORT).toBe("8082");
    });

    it("resolves RCT_METRO_PORT with larger offset", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        envMapping: { RCT_METRO_PORT: "${8081}" },
      });

      const env = pm.getEnvForOffset(10);

      expect(env.RCT_METRO_PORT).toBe("8091");
    });
  });

  describe("getStartCommandPortArgs", () => {
    it("returns empty array for generic framework", () => {
      const pm = createManager({
        ports: { discovered: [3000], offsetStep: 10 },
      });

      expect(pm.getStartCommandPortArgs("npm run dev", 10)).toEqual([]);
    });

    it("returns -- --port for npm-based RN project", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "react-native",
      });

      expect(pm.getStartCommandPortArgs("npm start", 10)).toEqual(["--", "--port", "8091"]);
    });

    it("returns --port without -- for yarn-based RN project", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "react-native",
      });

      expect(pm.getStartCommandPortArgs("yarn start", 10)).toEqual(["--port", "8091"]);
    });

    it("returns --port without -- for pnpm-based Expo project", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "expo",
      });

      expect(pm.getStartCommandPortArgs("pnpm start", 10)).toEqual(["--port", "8091"]);
    });

    it("returns --port without -- for npx expo start", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "expo",
      });

      expect(pm.getStartCommandPortArgs("npx expo start", 10)).toEqual(["--port", "8091"]);
    });

    it("falls back to default Metro port 8081 when no discovered ports", () => {
      const pm = createManager({
        ports: { discovered: [], offsetStep: 10 },
        framework: "expo",
      });

      expect(pm.getStartCommandPortArgs("npm start", 10)).toEqual(["--", "--port", "8091"]);
    });

    it("returns empty array when no discovered ports and generic framework", () => {
      const pm = createManager({
        ports: { discovered: [], offsetStep: 10 },
      });

      expect(pm.getStartCommandPortArgs("npm run dev", 10)).toEqual([]);
    });

    it("returns empty array when start command already contains --port", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "expo",
      });

      expect(pm.getStartCommandPortArgs("npx expo start --port 3000", 10)).toEqual([]);
    });

    it("handles custom Metro port with offset", () => {
      const pm = createManager({
        ports: { discovered: [9090], offsetStep: 10 },
        framework: "react-native",
      });

      expect(pm.getStartCommandPortArgs("yarn start", 10)).toEqual(["--port", "9100"]);
    });

    it("returns --port without -- for bun start", () => {
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "expo",
      });

      expect(pm.getStartCommandPortArgs("bun start", 10)).toEqual(["--port", "8091"]);
    });
  });

  describe("getEnvForOffset with Expo env vars", () => {
    it("includes Expo-specific env vars for expo framework", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "expo",
      });

      const env = pm.getEnvForOffset(10);

      expect(env.CI).toBe("0");
      expect(env.EXPO_OFFLINE).toBe("0");
      expect(env.EXPO_NO_TYPESCRIPT_SETUP).toBeUndefined();
    });

    it("does not include Expo env vars for react-native framework", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [8081], offsetStep: 10 },
        framework: "react-native",
      });

      const env = pm.getEnvForOffset(10);

      expect(env.CI).toBeUndefined();
      expect(env.EXPO_OFFLINE).toBeUndefined();
      expect(env.EXPO_NO_TYPESCRIPT_SETUP).toBeUndefined();
    });

    it("does not include Expo env vars for generic framework", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [3000], offsetStep: 10 },
      });

      const env = pm.getEnvForOffset(10);

      expect(env.CI).toBeUndefined();
      expect(env.EXPO_OFFLINE).toBeUndefined();
    });

    it("provides Expo env vars even with empty discovered ports", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [], offsetStep: 10 },
        framework: "expo",
      });

      const env = pm.getEnvForOffset(10);

      expect(env.CI).toBe("0");
      expect(env.EXPO_OFFLINE).toBe("0");
      expect(env.EXPO_NO_TYPESCRIPT_SETUP).toBeUndefined();
    });

    it("provides RCT_METRO_PORT from default port when discovered is empty", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [], offsetStep: 10 },
        framework: "expo",
      });

      const env = pm.getEnvForOffset(10);

      expect(env.RCT_METRO_PORT).toBe("8091");
    });

    it("returns empty object for generic framework with empty discovered ports", () => {
      mockedExistsSync.mockReturnValue(false);
      const pm = createManager({
        ports: { discovered: [], offsetStep: 10 },
      });

      const env = pm.getEnvForOffset(10);

      expect(env).toEqual({});
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
