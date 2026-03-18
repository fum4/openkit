import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

function resolveProjectRoot(startDir: string): string {
  const bundledRoot = process.env.OPENKIT_BUNDLED_ROOT;
  if (bundledRoot && existsSync(path.join(bundledRoot, "runtime", "port-hook.cjs"))) {
    return bundledRoot;
  }

  // In dev: startDir is libs/port-offset/src → walk up to workspace root
  const devWorkspaceRoot = path.resolve(startDir, "..", "..", "..");
  return devWorkspaceRoot;
}

/**
 * Resolves the path to the native port hook library (Zig-compiled .dylib/.so).
 * Returns null if the native hook binary is not found.
 *
 * Searches in order:
 * 1. Dev: libs/port-offset/src/hooks/libc/zig-out/lib/
 * 2. Bundled: runtime/ (from OPENKIT_BUNDLED_ROOT or workspace root)
 * 3. Dist: apps/server/dist/runtime/
 */
export function getNativeHookPath(): string | null {
  const ext = process.platform === "darwin" ? "dylib" : "so";
  const filename = `libport-hook.${ext}`;

  // Dev: built from libs/port-offset/src/hooks/libc
  const devHook = path.resolve(currentDir, "hooks", "libc", "zig-out", "lib", filename);
  if (existsSync(devHook)) {
    return devHook;
  }

  // Packaged: bundled alongside port-hook.cjs
  const projectRoot = resolveProjectRoot(currentDir);
  const bundledHook = path.resolve(projectRoot, "runtime", filename);
  if (existsSync(bundledHook)) {
    return bundledHook;
  }

  // Built: dist/runtime/
  const distHook = path.resolve(projectRoot, "apps", "server", "dist", "runtime", filename);
  if (existsSync(distHook)) {
    return distHook;
  }

  return null;
}

/**
 * Resolves the path to the Node.js port hook CJS file.
 * Used via NODE_OPTIONS="--require <path>" to patch net.Server/Socket.
 *
 * Searches in order:
 * 1. Dev: libs/port-offset/src/hooks/node/dist/port-hook.cjs
 * 2. Bundled/Dist: apps/server/dist/runtime/port-hook.cjs
 */
export function getNodeHookPath(): string {
  // Dev: built to src/hooks/node/dist/ by tsup
  const distHook = path.resolve(currentDir, "hooks", "node", "dist", "port-hook.cjs");
  if (existsSync(distHook)) {
    return distHook;
  }

  const projectRoot = resolveProjectRoot(currentDir);
  const appLocalHook = path.resolve(
    projectRoot,
    "apps",
    "server",
    "dist",
    "runtime",
    "port-hook.cjs",
  );
  if (existsSync(appLocalHook)) {
    return appLocalHook;
  }

  return distHook;
}
