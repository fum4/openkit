import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "cli/index": "src/index.ts",
    "electron-entry": "src/electron-entry.ts",
  },
  outDir: "dist",
  format: "esm",
  external: ["node-pty", "electron", "ws"],
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      ".md": "text",
    };
  },
});
