import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    main: "src/main.ts",
  },
  outDir: "dist",
  format: "esm",
  platform: "node",
  target: "node18",
  clean: true,
  external: ["electron", "electron-updater", "node-pty", "koffi"],
  esbuildOptions(options) {
    options.banner = {
      ...options.banner,
      js: `${options.banner?.js ?? ""}
import { createRequire as __createRequire } from "module";
const require = __createRequire(import.meta.url);`,
    };
  },
});
