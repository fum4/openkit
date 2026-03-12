import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const webAppPort = Number.parseInt(process.env.OPENKIT_WEB_APP_PORT ?? "5173");
const serverPort = Number.parseInt(process.env.OPENKIT_SERVER_PORT ?? "6969");
export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src"),
  resolve: {
    alias: {
      "@openkit/shared": path.resolve(__dirname, "../../libs/shared/src"),
    },
  },
  base: "./",
  build: {
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
  server: {
    port: webAppPort,
    proxy: {
      "/api": {
        target: `http://localhost:${serverPort}`,
        changeOrigin: true,
        ws: true,
      },
    },
  },
  test: {
    environment: "happy-dom",
    globals: true,
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["test/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["main.tsx", "test/**"],
    },
  },
});
