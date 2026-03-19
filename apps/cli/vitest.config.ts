import path from "path";
import { defineConfig } from "vitest/config";
import { mdRawPlugin } from "../../libs/shared/src/vite-md-plugin";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@openkit/agents": path.resolve(__dirname, "../../libs/agents/src"),
    },
  },
  plugins: [mdRawPlugin()],
});
