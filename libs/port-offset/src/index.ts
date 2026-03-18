// Facade
export { PortManager } from "./port-manager";

// Decomposed modules
export { OffsetAllocator } from "./offset-allocator";
export { detectEnvMapping, resolveEnvTemplates } from "./env-mapper";
export { persistDiscoveredPorts, persistEnvMapping, persistFramework } from "./config-persistence";
export { discoverPorts, getProcessTree, getListeningPorts } from "./port-discovery";
export { getNativeHookPath, getNodeHookPath } from "./hook-resolver";
export { buildOffsetEnvironment } from "./env-builder";

// Adapters
export { detectFramework, getAdapter } from "./adapters/registry";
export {
  DEFAULT_METRO_PORT,
  detectMetroPort,
  ReactNativeAdapter,
  reactNativeAdapter,
} from "./adapters/react-native";
export { ExpoAdapter, expoAdapter } from "./adapters/expo";
export { GenericAdapter, genericAdapter } from "./adapters/generic";
export { FrameworkAdapter } from "./adapters/base";

// Types
export type {
  FrameworkId,
  FrameworkDetectionResult,
  OffsetEnvironment,
  PortConfig,
  PortDebugLogger,
  WorktreeConfig,
} from "./types";
