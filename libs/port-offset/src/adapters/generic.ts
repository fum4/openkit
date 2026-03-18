import type { FrameworkDetectionResult } from "../types";
import { FrameworkAdapter } from "./base";

export class GenericAdapter extends FrameworkAdapter {
  readonly id = "generic" as const;

  detect(_projectDir: string): FrameworkDetectionResult | null {
    return {
      framework: "generic",
      defaultPorts: [],
      envVarTemplates: {},
      needsAdbReverse: false,
    };
  }
}

export const genericAdapter = new GenericAdapter();
