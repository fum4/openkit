import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

const webAppPort = Number.parseInt(process.env.OPENKIT_WEB_APP_PORT ?? "5173");
const serverPort = Number.parseInt(process.env.OPENKIT_SERVER_PORT ?? "6969");
export default defineConfig({
  plugins: [
    react(),
    // Stub Node-only modules that the server imports but aren't needed in web-app tests.
    // Uses prefix matching so subpath imports (e.g. @openkit/agents/instructions) are caught too.
    {
      name: "node-module-stubs",
      enforce: "pre",
      resolveId(id: string) {
        const prefixes = [
          "@openkit/agents",
          "node-pty",
          "pidusage",
          "@hono/node-ws",
          "@hono/node-server",
        ];
        if (prefixes.some((p) => id === p || id.startsWith(p + "/"))) {
          return `\0stub:${id}`;
        }
      },
      load(id: string) {
        if (!id.startsWith("\0stub:")) return;
        // Return a module where every export is a callable noop.
        // Named exports are required because ESM can't dynamically generate them.
        // NOTE: If a stubbed package adds new named exports that are transitively
        // imported in web-app tests, add them here — otherwise they'll be undefined.
        return [
          "const noop = () => noop;",
          "export default noop;",
          // @hono/node-server + @hono/node-ws
          "export { noop as serveStatic, noop as createAdaptorServer, noop as createNodeWebSocket };",
          // @openkit/agents
          "export { noop as BUNDLED_SKILLS, noop as CLAUDE_SKILL, noop as CURSOR_RULE, noop as VSCODE_PROMPT };",
          // node-pty
          "export { noop as spawn };",
        ].join("\n");
      },
    },
  ],
  root: path.resolve(__dirname, "src"),
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
