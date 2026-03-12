import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/standalone.ts", "src/runtime/**", "src/test/**"],
    },
  },
  resolve: {
    alias: {
      "@openkit/shared": path.resolve(__dirname, "../../libs/shared/src"),
      "@openkit/integrations": path.resolve(__dirname, "../../libs/integrations/src"),
      "@openkit/agents": path.resolve(__dirname, "../../libs/agents/src"),
      "@openkit/server": path.resolve(__dirname, "./src"),
    },
  },
});
