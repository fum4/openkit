import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const webAppPort = Number.parseInt(process.env.OPENKIT_WEB_APP_PORT ?? "5173");
const serverPort = Number.parseInt(process.env.OPENKIT_SERVER_PORT ?? "6969");
export default defineConfig({
  plugins: [
    react(),
    // Stub Node-only modules that the server imports but aren't needed in web-app tests.
    // Uses prefix matching so subpath imports (e.g. @openkit/agents/actions) are caught too.
    {
      name: "node-module-stubs",
      resolveId(id: string) {
        const prefixes = [
          "@openkit/agents",
          "@modelcontextprotocol/",
          "node-pty",
          "@hono/node-ws",
          "@hono/node-server",
        ];
        if (prefixes.some((p) => id === p || id.startsWith(p + "/"))) {
          return `\0stub:${id}`;
        }
      },
      load(id: string) {
        if (id.startsWith("\0stub:")) return "export default {}";
      },
    },
  ],
  root: path.resolve(__dirname, "src"),
  resolve: {
    alias: {
      "@openkit/shared": path.resolve(__dirname, "../../libs/shared/src"),
      "@openkit/integrations": path.resolve(__dirname, "../../libs/integrations/src"),
      "@openkit/logger/browser": path.resolve(__dirname, "../../libs/logger/browser/src/index.ts"),
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
    alias: [
      { find: /^@openkit\/server\/(.*)/, replacement: path.resolve(__dirname, "../server/src/$1") },
      {
        find: "@openkit/logger/node",
        replacement: path.resolve(__dirname, "../../libs/logger/node/src/index.ts"),
      },
    ],
    coverage: {
      provider: "v8",
      include: ["**/*.{ts,tsx}"],
      exclude: ["main.tsx", "test/**"],
    },
  },
});
