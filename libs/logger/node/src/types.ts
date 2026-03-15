export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFormat = "dev" | "prod";
export type LogContext = { domain: string; error?: unknown } & Record<string, unknown>;
