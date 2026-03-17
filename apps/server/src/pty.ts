import { createRequire } from "module";

const require = createRequire(import.meta.url);

export type NodePtyModule = { spawn: (typeof import("node-pty"))["spawn"] };

function hasSpawn(value: unknown): value is NodePtyModule {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { spawn?: unknown }).spawn === "function"
  );
}

export function resolveNodePtyModule(): NodePtyModule {
  const loaded: unknown = require("node-pty");

  if (hasSpawn(loaded)) {
    return loaded;
  }

  if (typeof loaded === "object" && loaded !== null && "default" in loaded) {
    const defaultExport = (loaded as { default?: unknown }).default;
    if (hasSpawn(defaultExport)) {
      return defaultExport;
    }
  }

  throw new Error("node-pty module is missing a spawn() export");
}
