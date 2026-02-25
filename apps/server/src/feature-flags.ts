function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

export function isMcpSetupEnabled(): boolean {
  return isTruthy(process.env.OPENKIT_ENABLE_MCP_SETUP);
}
