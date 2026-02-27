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
  external: ["node-pty", "ws"],
  esbuildOptions(options) {
    options.loader = {
      ...options.loader,
      ".md": "text",
    };
  },
});
