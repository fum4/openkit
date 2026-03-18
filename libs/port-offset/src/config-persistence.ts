import { readFileSync, writeFileSync } from "fs";

import { log } from "./logger";
import type { PortDebugLogger, WorktreeConfig } from "./types";

/**
 * Persists discovered ports to the config.json file.
 */
export function persistDiscoveredPorts(
  configFilePath: string | null,
  ports: number[],
  debugLogger?: PortDebugLogger | null,
): void {
  if (!configFilePath) return;

  try {
    const content = readFileSync(configFilePath, "utf-8");
    const config = JSON.parse(content);
    if (!config.ports) {
      config.ports = {};
    }
    config.ports.discovered = ports;
    writeFileSync(configFilePath, JSON.stringify(config, null, 2) + "\n");
    log.debug(`[port-discovery] Saved discovered ports to ${configFilePath}`);
  } catch (err) {
    if (debugLogger) {
      try {
        debugLogger({
          action: "port.discovery.persist-discovered-ports",
          message: "Failed to persist discovered ports",
          status: "failed",
          level: "error",
          metadata: {
            configFilePath,
            ports,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // Ignore debug sink failures.
      }
    }
  }
}

/**
 * Persists env var mapping to the config.json file.
 * Also updates the in-memory config object.
 */
export function persistEnvMapping(
  configFilePath: string | null,
  config: WorktreeConfig,
  mapping: Record<string, string>,
  debugLogger?: PortDebugLogger | null,
): void {
  if (!configFilePath) return;

  config.envMapping = mapping;

  try {
    const content = readFileSync(configFilePath, "utf-8");
    const fileConfig = JSON.parse(content);
    fileConfig.envMapping = mapping;
    writeFileSync(configFilePath, JSON.stringify(fileConfig, null, 2) + "\n");
    log.debug(`[port-discovery] Saved env mapping to ${configFilePath}`);
  } catch (err) {
    if (debugLogger) {
      try {
        debugLogger({
          action: "port.discovery.persist-env-mapping",
          message: "Failed to persist env mapping",
          status: "failed",
          level: "error",
          metadata: {
            configFilePath,
            error: err instanceof Error ? err.message : String(err),
          },
        });
      } catch {
        // Ignore debug sink failures.
      }
    }
  }
}

/**
 * Persists framework type to the config.json file.
 * Also updates the in-memory config object.
 */
export function persistFramework(
  configFilePath: string | null,
  config: WorktreeConfig,
  framework: WorktreeConfig["framework"],
): void {
  if (!configFilePath) return;

  config.framework = framework;

  try {
    const content = readFileSync(configFilePath, "utf-8");
    const fileConfig = JSON.parse(content);
    fileConfig.framework = framework;
    writeFileSync(configFilePath, JSON.stringify(fileConfig, null, 2) + "\n");
  } catch (err) {
    log.warn(
      `Failed to persist framework to config: ${err instanceof Error ? err.message : String(err)}`,
      { domain: "framework-detect" },
    );
  }
}
