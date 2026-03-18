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
      exclude: ["src/standalone.ts", "src/runtime/**", "src/__test__/**"],
    },
  },
  resolve: {
    alias: {
      "@openkit/shared": path.resolve(__dirname, "../../libs/shared/src"),
      "@openkit/integrations": path.resolve(__dirname, "../../libs/integrations/src"),
      "@openkit/agents": path.resolve(__dirname, "../../libs/agents/src"),
      "@openkit/logger/node": path.resolve(
        __dirname,
        "../../libs/logger/src/bindings/node/logger.ts",
      ),
      "@openkit/port-offset": path.resolve(__dirname, "../../libs/port-offset/src"),
      "@openkit/server": path.resolve(__dirname, "./src"),
    },
  },
});
