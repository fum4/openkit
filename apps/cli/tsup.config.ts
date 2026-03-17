import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/index.ts",
  },
  outDir: "dist",
  clean: true,
  format: "esm",
  external: ["node-pty"],
  noExternal: [/^@openkit\//, "ws", "picocolors"],
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
