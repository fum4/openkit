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
  noExternal: ["ws", "picocolors", "@xterm/headless", "@xterm/addon-serialize"],
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
