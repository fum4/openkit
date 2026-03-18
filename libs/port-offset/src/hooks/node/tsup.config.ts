import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["port-hook.ts"],
  outDir: "dist",
  format: "cjs",
  platform: "node",
  splitting: false,
  clean: true,
  outExtension: () => ({ js: ".cjs" }),
});
