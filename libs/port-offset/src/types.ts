import type { PortConfig, WorktreeConfig } from "@openkit/shared/worktree-types";

export type { PortConfig, WorktreeConfig };

export type FrameworkId = "react-native" | "expo" | "generic";

export interface FrameworkDetectionResult {
  framework: FrameworkId;
  /** Default ports the framework uses that should be added to discovered if missing */
  defaultPorts: number[];
  /** Env vars that should be auto-added to envMapping */
  envVarTemplates: Record<string, string>;
  /** Whether adb reverse should be run post-start for Android */
  needsAdbReverse: boolean;
  /** Env vars scoped ONLY to the spawn context (e.g., CI=0 for Expo PTY) */
  spawnOnlyEnv?: Record<string, string>;
  /** Whether the dev server needs a real TTY (PTY spawn) */
  needsPty?: boolean;
}

export interface OffsetEnvironment {
  /** Full env var map to merge into process.env */
  env: Record<string, string>;
  /** Env vars only for the direct spawn context (not propagated to children) */
  spawnOnlyEnv: Record<string, string>;
  /** Computed offset ports */
  ports: number[];
  /** Allocated offset value */
  offset: number;
  /** Extra args for start command (e.g., --port 8091) */
  extraArgs: string[];
  /** Whether to spawn via PTY */
  needsPty: boolean;
  /** Whether to run adb reverse after spawn */
  needsAdbReverse: boolean;
}

export type PortDebugLogger = (event: {
  action: string;
  message: string;
  status?: "info" | "success" | "failed";
  level?: "debug" | "info" | "warning" | "error";
  metadata?: Record<string, unknown>;
}) => void;
