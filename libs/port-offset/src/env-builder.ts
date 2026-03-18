import type { FrameworkDetectionResult, OffsetEnvironment, WorktreeConfig } from "./types";
import { DEFAULT_METRO_PORT } from "./adapters/react-native";
import { getAdapter } from "./adapters/registry";
import { resolveEnvTemplates } from "./env-mapper";
import { getNativeHookPath, getNodeHookPath } from "./hook-resolver";

/**
 * Builds the complete OffsetEnvironment for spawning a worktree process.
 * Combines hook env vars, env mapping resolution, and adapter-specific
 * args/env into a single recipe that the spawn caller can follow.
 */
export function buildOffsetEnvironment(
  config: WorktreeConfig,
  offset: number,
  detection: FrameworkDetectionResult | null,
  startCommand: string,
): OffsetEnvironment {
  const framework = detection?.framework ?? config.framework;
  const isRnOrExpo = framework === "react-native" || framework === "expo";
  const hasDiscoveredPorts = config.ports.discovered.length > 0;

  const env: Record<string, string> = {};
  const spawnOnlyEnv: Record<string, string> = {};
  const ports = config.ports.discovered.map((port: number) => port + offset);

  // For generic projects with no discovered ports, return minimal environment
  if (!hasDiscoveredPorts && !isRnOrExpo) {
    return {
      env,
      spawnOnlyEnv,
      ports,
      offset,
      extraArgs: [],
      needsPty: false,
      needsAdbReverse: false,
    };
  }

  // Port hook env vars (only when we have discovered ports to offset)
  if (hasDiscoveredPorts) {
    env.__WM_PORT_OFFSET__ = String(offset);
    env.__WM_KNOWN_PORTS__ = JSON.stringify(config.ports.discovered);

    // Native hook (runtime-agnostic: Python, Ruby, Go on macOS, etc.)
    // Enabled by default — falls back to Node.js-only if disabled or binary not found.
    const useNative = config.useNativePortHook !== false;
    const nativeHook = useNative ? getNativeHookPath() : null;
    if (nativeHook) {
      if (process.platform === "darwin") {
        env.DYLD_INSERT_LIBRARIES = nativeHook;
      } else {
        env.LD_PRELOAD = nativeHook;
      }
    }

    // Node.js hook (keep as safety net for Node-specific patching)
    const hookPath = getNodeHookPath();
    const existingNodeOptions = process.env.NODE_OPTIONS || "";
    const requireFlag = `--require ${hookPath}`;
    env.NODE_OPTIONS = existingNodeOptions ? `${existingNodeOptions} ${requireFlag}` : requireFlag;
  }

  // Resolve env var templates with offset ports
  if (config.envMapping) {
    Object.assign(env, resolveEnvTemplates(config.envMapping, offset));
  }

  // For RN/Expo without discovered ports, provide RCT_METRO_PORT from default
  if (isRnOrExpo && !env.RCT_METRO_PORT) {
    env.RCT_METRO_PORT = String(DEFAULT_METRO_PORT + offset);
  }

  // Adapter-driven spawn metadata
  let extraArgs: string[] = [];
  let needsPty = false;
  let needsAdbReverse = false;

  if (detection) {
    needsPty = detection.needsPty ?? false;
    needsAdbReverse = detection.needsAdbReverse;

    if (detection.spawnOnlyEnv) {
      Object.assign(spawnOnlyEnv, detection.spawnOnlyEnv);
    }

    // Get port args from adapter
    if (isRnOrExpo) {
      const adapter = getAdapter(detection.framework);
      const metroBasePort = config.ports.discovered[0] || DEFAULT_METRO_PORT;
      const metroOffsetPort = metroBasePort + offset;
      extraArgs = adapter.getStartCommandPortArgs(startCommand, metroOffsetPort);
    }
  } else if (framework) {
    // Fallback when detection hasn't run but framework is persisted in config
    needsAdbReverse = framework === "react-native" || framework === "expo";
    needsPty = framework === "react-native" || framework === "expo";

    if (framework === "expo") {
      spawnOnlyEnv.CI = "0";
      spawnOnlyEnv.EXPO_OFFLINE = "0";
    }

    if (isRnOrExpo) {
      const adapter = getAdapter(framework);
      const metroBasePort = config.ports.discovered[0] || DEFAULT_METRO_PORT;
      const metroOffsetPort = metroBasePort + offset;
      extraArgs = adapter.getStartCommandPortArgs(startCommand, metroOffsetPort);
    }
  }

  return {
    env,
    spawnOnlyEnv,
    ports,
    offset,
    extraArgs,
    needsPty,
    needsAdbReverse,
  };
}
