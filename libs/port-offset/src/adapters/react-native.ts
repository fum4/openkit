import { existsSync, readFileSync } from "fs";
import path from "path";

import { log } from "../logger";
import type { FrameworkDetectionResult } from "../types";
import { FrameworkAdapter } from "./base";

export const DEFAULT_METRO_PORT = 8081;

/**
 * Reads metro.config.{js,ts,cjs,mjs} and extracts a custom server port
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
      // Negative lookbehind ensures "port" is standalone (not "viewport", "reportPort", etc.)
      const match = content.match(/(?<![a-zA-Z])["']?port["']?\s*:\s*(\d+)/);
      if (match) {
        const port = parseInt(match[1], 10);
        if (!isNaN(port) && port > 0 && port <= 65535) {
          return port;
        }
      }
    } catch (err) {
      log.debug("Failed to read Metro config, falling back to default Metro port", {
        domain: "framework-detect",
        projectDir,
        configPath,
        filename,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return DEFAULT_METRO_PORT;
}

export class ReactNativeAdapter extends FrameworkAdapter {
  readonly id = "react-native" as const;

  detect(projectDir: string): FrameworkDetectionResult | null {
    const deps = this.readProjectDeps(projectDir);
    if (!deps) return null;

    // Expo adapter has higher priority — skip if expo is present
    if ("expo" in deps) return null;
    if (!("react-native" in deps)) return null;

    const metroPort = detectMetroPort(projectDir);

    log.debug(`Detected react-native project (Metro port: ${metroPort})`, {
      domain: "framework-detect",
    });

    return {
      framework: "react-native",
      defaultPorts: [metroPort],
      envVarTemplates: { RCT_METRO_PORT: `\${${metroPort}}` },
      needsAdbReverse: true,
      needsPty: true,
    };
  }

  getStartCommandPortArgs(startCommand: string, offsetPort: number): string[] {
    return this.getMetroPortArgs(startCommand, offsetPort);
  }
}

export const reactNativeAdapter = new ReactNativeAdapter();
