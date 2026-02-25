import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

const webAppPort = Number.parseInt(process.env.OPENKIT_WEB_APP_PORT ?? "5173");
const serverPort = Number.parseInt(process.env.OPENKIT_SERVER_PORT ?? "6969");
const workspaceRoot = path.resolve(__dirname, "../..");

export default defineConfig({
  plugins: [react()],
  root: path.resolve(__dirname, "src"),
  resolve: {
    alias: {
      "@openkit/agent": path.resolve(workspaceRoot, "libs/agent/src"),
      "@openkit/cli": path.resolve(workspaceRoot, "apps/cli/src"),
      "@openkit/core": path.resolve(workspaceRoot, "libs/core/src"),
      "@openkit/instructions": path.resolve(workspaceRoot, "libs/instructions/src"),
      "@openkit/integrations": path.resolve(workspaceRoot, "libs/integrations/src"),
      "@openkit/server": path.resolve(workspaceRoot, "apps/server/src"),
      "@openkit/shared": path.resolve(workspaceRoot, "libs/shared/src"),
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
});
