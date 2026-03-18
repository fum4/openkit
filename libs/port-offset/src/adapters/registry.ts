import type { FrameworkDetectionResult, FrameworkId } from "../types";
import { expoAdapter } from "./expo";
import { genericAdapter } from "./generic";
import { reactNativeAdapter } from "./react-native";
import { FrameworkAdapter } from "./base";

/**
 * Ordered list of adapters. Expo must come before React Native since an
 * Expo project also has react-native in its deps.
 */
const adapters: FrameworkAdapter[] = [expoAdapter, reactNativeAdapter, genericAdapter];

/**
 * Detects the project framework by iterating adapters in priority order.
 * Returns the first match (always returns at least the generic adapter).
 */
export function detectFramework(projectDir: string): FrameworkDetectionResult {
  for (const adapter of adapters) {
    const result = adapter.detect(projectDir);
    if (result) return result;
  }
  // Should never reach here since generic always matches
  return genericAdapter.detect("")!;
}

/**
 * Returns the adapter for a given framework ID.
 */
export function getAdapter(frameworkId: FrameworkId): FrameworkAdapter {
  return adapters.find((a) => a.id === frameworkId) ?? genericAdapter;
}
