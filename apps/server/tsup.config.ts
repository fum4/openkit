import { spawn } from "child_process";
import { cpSync, mkdirSync } from "fs";
import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    standalone: "src/standalone.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  clean: true,
  external: ["node-pty"],
  noExternal: [/^@openkit\//, "ws", "picocolors", "@xterm/headless", "@xterm/addon-serialize"],
  async onSuccess() {
    if (process.argv.includes("--watch")) {
      const server = spawn("node", ["dist/standalone.js"], { stdio: "inherit" });
      return () => {
        server.kill();
      };
    } else {
      mkdirSync("dist/runtime", { recursive: true });
      cpSync(
        "../../libs/port-offset/src/hooks/node/dist/port-hook.cjs",
        "dist/runtime/port-hook.cjs",
      );
      cpSync("../../libs/port-offset/src/hooks/libc/zig-out/lib", "dist/runtime", {
        recursive: true,
      });
    }
  },
  esbuildOptions(options) {
    options.banner = {
      ...options.banner,
      js: `${options.banner?.js ?? ""}
import { createRequire as __createRequire } from "module";
const require = __createRequire(import.meta.url);`,
    };
    options.loader = {
      ...options.loader,
      ".md": "text",
    };
  },
});
