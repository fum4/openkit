import { readFileSync, writeFileSync } from "fs";

import { persistDiscoveredPorts, persistEnvMapping, persistFramework } from "../config-persistence";
import type { WorktreeConfig } from "../types";

vi.mock("fs", () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock("./logger", () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

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

describe("persistEnvMapping", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes envMapping to config file", () => {
    const configPath = "/projects/myapp/.openkit/config.json";
    const config = createTestConfig({ ports: { discovered: [3000], offsetStep: 10 } });

    const existingConfig = {
      startCommand: "npm start",
      ports: { discovered: [3000], offsetStep: 10 },
    };
    mockedReadFileSync.mockReturnValue(JSON.stringify(existingConfig));

    const mapping = { API_URL: "http://localhost:${3000}" };
    persistEnvMapping(configPath, config, mapping);

    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      configPath,
      expect.stringContaining('"envMapping"'),
    );

    const writtenContent = JSON.parse((mockedWriteFileSync.mock.calls[0][1] as string).trim());
    expect(writtenContent.envMapping).toEqual(mapping);
  });

  it("no-ops when configFilePath is null", () => {
    const config = createTestConfig();

    persistEnvMapping(null, config, { API_URL: "http://localhost:${3000}" });

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
    expect(mockedReadFileSync).not.toHaveBeenCalled();
  });

  it("updates config.envMapping in memory even before writing", () => {
    const config = createTestConfig({ ports: { discovered: [3000], offsetStep: 10 } });

    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ ports: { discovered: [3000], offsetStep: 10 } }),
    );

    const mapping = { PORT: "${3000}" };
    persistEnvMapping("/path/to/.openkit/config.json", config, mapping);

    expect(config.envMapping).toEqual(mapping);
  });

  it("handles read errors gracefully without throwing", () => {
    const config = createTestConfig({ ports: { discovered: [3000], offsetStep: 10 } });

    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT: no such file or directory");
    });

    expect(() =>
      persistEnvMapping("/nonexistent/.openkit/config.json", config, { PORT: "${3000}" }),
    ).not.toThrow();
  });

  it("writes pretty-printed JSON with trailing newline", () => {
    const configPath = "/projects/myapp/.openkit/config.json";
    const config = createTestConfig();

    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ ports: { discovered: [], offsetStep: 1 } }),
    );

    persistEnvMapping(configPath, config, { PORT: "${3000}" });

    const written = mockedWriteFileSync.mock.calls[0][1] as string;
    expect(written).toMatch(/\n$/);
    expect(written).toContain("  "); // indented
  });
});

describe("persistFramework", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes framework to config file", () => {
    const configPath = "/projects/myapp/.openkit/config.json";
    const config = createTestConfig();

    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ ports: { discovered: [], offsetStep: 1 } }),
    );

    persistFramework(configPath, config, "expo");

    expect(config.framework).toBe("expo");
    expect(mockedWriteFileSync).toHaveBeenCalledWith(
      configPath,
      expect.stringContaining('"framework"'),
    );
  });

  it("no-ops when configFilePath is null", () => {
    const config = createTestConfig();

    persistFramework(null, config, "expo");

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });

  it("handles write errors gracefully", () => {
    const config = createTestConfig();

    mockedReadFileSync.mockImplementation(() => {
      throw new Error("ENOENT");
    });

    expect(() =>
      persistFramework("/nonexistent/.openkit/config.json", config, "react-native"),
    ).not.toThrow();
  });
});

describe("persistDiscoveredPorts", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("writes ports to config file", () => {
    const configPath = "/projects/myapp/.openkit/config.json";

    mockedReadFileSync.mockReturnValue(
      JSON.stringify({ ports: { discovered: [], offsetStep: 1 } }),
    );

    persistDiscoveredPorts(configPath, [3000, 4000]);

    const writtenContent = JSON.parse((mockedWriteFileSync.mock.calls[0][1] as string).trim());
    expect(writtenContent.ports.discovered).toEqual([3000, 4000]);
  });

  it("no-ops when configFilePath is null", () => {
    persistDiscoveredPorts(null, [3000]);

    expect(mockedWriteFileSync).not.toHaveBeenCalled();
  });
});
