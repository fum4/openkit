import path from "path";

import { detectFramework, getAdapter } from "./adapters/registry";
import { DEFAULT_METRO_PORT } from "./adapters/react-native";
import { persistDiscoveredPorts, persistEnvMapping, persistFramework } from "./config-persistence";
import { buildOffsetEnvironment } from "./env-builder";
import { detectEnvMapping } from "./env-mapper";
import { log } from "./logger";
import { OffsetAllocator } from "./offset-allocator";
import { discoverPorts as discoverPortsRaw } from "./port-discovery";
import type {
  FrameworkDetectionResult,
  OffsetEnvironment,
  PortDebugLogger,
  WorktreeConfig,
} from "./types";

/**
 * Backward-compatible facade that delegates to the decomposed modules.
 * Consumers can use this class exactly as they used the old PortManager.
 */
export class PortManager {
  private config: WorktreeConfig;
  private configFilePath: string | null;
  private debugLogger: PortDebugLogger | null = null;
  private allocator: OffsetAllocator;
  private frameworkDetection: FrameworkDetectionResult | null = null;

  useNativeHook = true;

  constructor(config: WorktreeConfig, configFilePath: string | null = null) {
    this.config = config;
    this.configFilePath = configFilePath;
    this.allocator = new OffsetAllocator(config.ports);
    this.ensureFrameworkDetected();
  }

  /**
   * Early framework detection on construction — runs synchronously so the
   * framework is available before discoverPorts() is called.
   */
  private ensureFrameworkDetected(): void {
    if (this.config.framework) return;
    if (!this.configFilePath) return;

    const projectDir = this.getProjectDir();
    const detection = detectFramework(projectDir);

    if (detection.framework === "generic") return;

    this.frameworkDetection = detection;
    persistFramework(this.configFilePath, this.config, detection.framework);

    log.info(`Auto-detected ${detection.framework} project, persisted to config`, {
      domain: "framework-detect",
    });
  }

  getFramework(): WorktreeConfig["framework"] {
    return this.frameworkDetection?.framework ?? this.config.framework;
  }

  needsAdbReverse(): boolean {
    return (
      this.frameworkDetection?.needsAdbReverse ??
      (this.config.framework === "react-native" || this.config.framework === "expo")
    );
  }

  setDebugLogger(debugLogger: PortDebugLogger | null): void {
    this.debugLogger = debugLogger;
  }

  getProjectDir(): string {
    return this.configFilePath ? path.dirname(path.dirname(this.configFilePath)) : process.cwd();
  }

  getDiscoveredPorts(): number[] {
    return this.allocator.getDiscoveredPorts();
  }

  getOffsetStep(): number {
    return this.allocator.getOffsetStep();
  }

  allocateOffset(): number {
    return this.allocator.allocateOffset();
  }

  releaseOffset(offset: number): void {
    this.allocator.releaseOffset(offset);
  }

  getPortsForOffset(offset: number): number[] {
    return this.allocator.getPortsForOffset(offset);
  }

  getStartCommandPortArgs(startCommand: string, offset: number): string[] {
    const framework = this.getFramework();
    if (framework !== "react-native" && framework !== "expo") {
      return [];
    }

    const metroBasePort = this.config.ports.discovered[0] || DEFAULT_METRO_PORT;
    const metroOffsetPort = metroBasePort + offset;
    const adapter = getAdapter(framework);
    return adapter.getStartCommandPortArgs(startCommand, metroOffsetPort);
  }

  getEnvForOffset(offset: number): Record<string, string> {
    const offsetEnv = buildOffsetEnvironment(
      { ...this.config, useNativePortHook: this.useNativeHook },
      offset,
      this.frameworkDetection,
      this.config.startCommand,
    );
    return offsetEnv.env;
  }

  /**
   * Builds the full OffsetEnvironment for a worktree spawn.
   * New callers should prefer this over getEnvForOffset() + getStartCommandPortArgs().
   */
  buildOffsetEnvironment(offset: number, startCommand: string): OffsetEnvironment {
    return buildOffsetEnvironment(
      { ...this.config, useNativePortHook: this.useNativeHook },
      offset,
      this.frameworkDetection,
      startCommand,
    );
  }

  detectEnvMapping(projectDir: string): Record<string, string> {
    return detectEnvMapping(projectDir, this.config.ports.discovered);
  }

  persistEnvMapping(mapping: Record<string, string>): void {
    persistEnvMapping(this.configFilePath, this.config, mapping, this.debugLogger);
  }

  async discoverPorts(
    onLog?: (message: string) => void,
  ): Promise<{ ports: number[]; error?: string }> {
    const emit = onLog || ((msg: string) => log.info(msg));
    const workingDir = this.getProjectDir();

    const { ports, error } = await discoverPortsRaw(this.config.startCommand, workingDir, emit);

    if (error) {
      return { ports, error };
    }

    // Re-detect framework and merge defaults
    const detection = detectFramework(workingDir);
    this.frameworkDetection = detection;

    let finalPorts = [...ports];
    if (detection.framework !== "generic") {
      for (const port of detection.defaultPorts) {
        if (!finalPorts.includes(port)) {
          finalPorts.push(port);
        }
      }
      finalPorts.sort((a, b) => a - b);
      emit(`[port-discovery] Detected ${detection.framework} project, applied framework defaults`);
    }

    if (finalPorts.length > 0) {
      this.config.ports.discovered = finalPorts;
      this.allocator.setDiscoveredPorts(finalPorts);
      persistDiscoveredPorts(this.configFilePath, finalPorts, this.debugLogger);

      // Auto-detect env var mappings after port discovery
      const envMapping = this.detectEnvMapping(workingDir);

      // Merge framework-specific env var templates (don't overwrite user entries)
      if (detection.framework !== "generic") {
        for (const [key, template] of Object.entries(detection.envVarTemplates)) {
          if (!(key in envMapping)) {
            envMapping[key] = template;
          }
        }
      }

      if (Object.keys(envMapping).length > 0) {
        this.persistEnvMapping(envMapping);
        emit(`[port-discovery] Detected env var mappings: ${Object.keys(envMapping).join(", ")}`);
      }
    }

    // Persist framework type to config for subsequent starts
    if (detection.framework !== "generic") {
      persistFramework(this.configFilePath, this.config, detection.framework);
    }

    return { ports: finalPorts };
  }
}
