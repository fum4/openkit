import { existsSync, readFileSync } from "fs";
import path from "path";

import { log } from "./logger";

export type ProjectFramework = "react-native" | "expo" | "generic";

export interface FrameworkDetection {
  framework: ProjectFramework;
  /** Default ports the framework uses that should be added to discovered if missing */
  defaultPorts: number[];
  /** Env vars that should be auto-added to envMapping */
  envVarTemplates: Record<string, string>;
  /** Whether adb reverse should be run post-start for Android */
  needsAdbReverse: boolean;
}

const DEFAULT_METRO_PORT = 8081;

/**
 * Reads metro.config.js or metro.config.ts and extracts a custom server port
 * via regex. Returns the default Metro port (8081) if no custom port is found.
 */
export function detectMetroPort(projectDir: string): number {
  for (const filename of [
    "metro.config.js",
    "metro.config.ts",
    "metro.config.cjs",
    "metro.config.mjs",
  ]) {
    const configPath = path.join(projectDir, filename);
    if (!existsSync(configPath)) continue;

    try {
      const content = readFileSync(configPath, "utf-8");
      // Match patterns like: port: 8082, port:8082, "port": 8082
      const match = content.match(/["']?port["']?\s*:\s*(\d+)/);
      if (match) {
        const port = parseInt(match[1], 10);
        if (!isNaN(port) && port > 0 && port <= 65535) {
          return port;
        }
      }
    } catch (err) {
      log.debug(
        `Failed to read ${filename}, falling back to default Metro port: ${err instanceof Error ? err.message : String(err)}`,
        { domain: "framework-detect" },
      );
    }
  }

  return DEFAULT_METRO_PORT;
}

/**
 * Detects the project framework by reading package.json dependencies.
 * Returns framework-specific port defaults and env var templates.
 */
export function detectFramework(projectDir: string): FrameworkDetection {
  const generic: FrameworkDetection = {
    framework: "generic",
    defaultPorts: [],
    envVarTemplates: {},
    needsAdbReverse: false,
  };

  const pkgPath = path.join(projectDir, "package.json");
  if (!existsSync(pkgPath)) return generic;

  let deps: Record<string, string> = {};
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    deps = { ...pkg.dependencies, ...pkg.devDependencies };
  } catch (err) {
    log.debug(`Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`, {
      domain: "framework-detect",
    });
    return generic;
  }

  const isExpo = "expo" in deps;
  const isReactNative = "react-native" in deps;

  if (!isExpo && !isReactNative) return generic;

  const metroPort = detectMetroPort(projectDir);
  const framework: ProjectFramework = isExpo ? "expo" : "react-native";

  log.debug(`Detected ${framework} project (Metro port: ${metroPort})`, {
    domain: "framework-detect",
  });

  return {
    framework,
    defaultPorts: [metroPort],
    envVarTemplates: {
      RCT_METRO_PORT: `\${${metroPort}}`,
    },
    needsAdbReverse: true,
  };
}
