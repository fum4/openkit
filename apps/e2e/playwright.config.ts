/**
 * Playwright configuration for OpenKit E2E tests.
 * Uses Electron launch (not browser projects) — tests run against the real desktop app.
 */
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./src",
  timeout: 60_000,
  expect: {
    timeout: 30_000,
  },
  workers: 1,
  retries: 1,
  reporter: [["html", { open: "never" }], ["list"]],
  use: {
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
});
