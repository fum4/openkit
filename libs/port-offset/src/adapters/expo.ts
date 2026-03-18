import { log } from "../logger";
import type { FrameworkDetectionResult } from "../types";
import { detectMetroPort } from "./react-native";
import { FrameworkAdapter } from "./base";

export class ExpoAdapter extends FrameworkAdapter {
  readonly id = "expo" as const;

  detect(projectDir: string): FrameworkDetectionResult | null {
    const deps = this.readProjectDeps(projectDir);
    if (!deps) return null;
    if (!("expo" in deps)) return null;

    const metroPort = detectMetroPort(projectDir);

    log.debug(`Detected expo project (Metro port: ${metroPort})`, {
      domain: "framework-detect",
    });

    return {
      framework: "expo",
      defaultPorts: [metroPort],
      envVarTemplates: { RCT_METRO_PORT: `\${${metroPort}}` },
      needsAdbReverse: true,
      spawnOnlyEnv: { CI: "0", EXPO_OFFLINE: "0" },
      needsPty: true,
    };
  }

  getStartCommandPortArgs(startCommand: string, offsetPort: number): string[] {
    return this.getMetroPortArgs(startCommand, offsetPort);
  }
}

export const expoAdapter = new ExpoAdapter();
