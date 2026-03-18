import { readdirSync, readFileSync } from "fs";
import path from "path";
import type { Dirent } from "fs";

import { detectEnvMapping, resolveEnvTemplates } from "../env-mapper";

vi.mock("fs", () => ({
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

const mockedReaddirSync = vi.mocked(readdirSync);
const mockedReadFileSync = vi.mocked(readFileSync);

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

describe("detectEnvMapping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty object when no ports discovered", () => {
    expect(detectEnvMapping("/project", [])).toEqual({});
  });

  it("finds ports in .env files and creates templates", () => {
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue("API_URL=http://localhost:3000\n");

    const mapping = detectEnvMapping("/project", [3000]);

    expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
  });

  it("handles double-quoted values", () => {
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue('API_URL="http://localhost:3000"\n');

    const mapping = detectEnvMapping("/project", [3000]);

    expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
  });

  it("handles single-quoted values", () => {
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue("WS_URL='ws://localhost:4000'\n");

    const mapping = detectEnvMapping("/project", [4000]);

    expect(mapping).toEqual({ WS_URL: "ws://localhost:${4000}" });
  });

  it("skips comments and empty lines", () => {
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue("# PORT=3000\n\nAPI_URL=http://localhost:3000\n");

    const mapping = detectEnvMapping("/project", [3000]);

    expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
  });

  it("skips lines without port references", () => {
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue("NODE_ENV=production\nAPI_URL=http://localhost:3000\n");

    const mapping = detectEnvMapping("/project", [3000]);

    expect(mapping).toEqual({ API_URL: "http://localhost:${3000}" });
    expect(mapping).not.toHaveProperty("NODE_ENV");
  });

  it("skips node_modules and .git directories", () => {
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

    const mapping = detectEnvMapping("/project", [3000]);

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
    mockedReaddirSync.mockReturnValue([makeDirent(".env", false)] as unknown as ReturnType<
      typeof readdirSync
    >);
    mockedReadFileSync.mockReturnValue("SERVICES=http://localhost:3000,http://localhost:4000\n");

    const mapping = detectEnvMapping("/project", [3000, 4000]);

    expect(mapping).toEqual({ SERVICES: "http://localhost:${3000},http://localhost:${4000}" });
  });

  it("handles unreadable directories gracefully", () => {
    mockedReaddirSync.mockImplementation(() => {
      throw new Error("EACCES: permission denied");
    });

    expect(() => detectEnvMapping("/project", [3000])).not.toThrow();
    expect(detectEnvMapping("/project", [3000])).toEqual({});
  });

  it("scans .env.local and .env.production files", () => {
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

    const mapping = detectEnvMapping("/project", [5000]);

    expect(mapping).toEqual({ DEV_URL: "http://localhost:${5000}" });
    expect(mapping).not.toHaveProperty("PROD_URL");
  });
});

describe("resolveEnvTemplates", () => {
  it("resolves templates with offset", () => {
    const resolved = resolveEnvTemplates(
      {
        VITE_API_URL: "http://localhost:${3000}/api",
        DATABASE_URL: "postgres://localhost:${3000}/db",
      },
      10,
    );

    expect(resolved.VITE_API_URL).toBe("http://localhost:3010/api");
    expect(resolved.DATABASE_URL).toBe("postgres://localhost:3010/db");
  });

  it("resolves multiple port references in a single template", () => {
    const resolved = resolveEnvTemplates({ SERVICES: "${3000},${4000}" }, 20);

    expect(resolved.SERVICES).toBe("3020,4020");
  });

  it("returns empty object for empty mapping", () => {
    expect(resolveEnvTemplates({}, 10)).toEqual({});
  });
});
