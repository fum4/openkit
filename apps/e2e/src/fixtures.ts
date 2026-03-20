/**
 * Playwright fixtures for OpenKit E2E tests.
 * Provides electronApp, window, and testProject fixtures.
 */
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { _electron, type ElectronApplication, type Page } from "playwright-core";
import { test as base, expect } from "@playwright/test";

const PORT_OFFSET = "900";

export interface TestProject {
  dir: string;
}

export const test = base.extend<{
  electronApp: ElectronApplication;
  window: Page;
  testProject: TestProject;
}>({
  testProject: async ({}, use) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "openkit-e2e-"));

    execFileSync("git", ["init"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.name", "e2e"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["config", "user.email", "e2e@test"], { cwd: dir, stdio: "ignore" });
    execFileSync("git", ["commit", "--allow-empty", "-m", "init"], {
      cwd: dir,
      stdio: "ignore",
    });

    await use({ dir });

    fs.rmSync(dir, { recursive: true, force: true });
  },

  electronApp: async ({}, use) => {
    const mainPath = path.resolve(import.meta.dirname, "../../../apps/desktop-app/dist/main.js");

    const app = await _electron.launch({
      args: [mainPath],
      env: {
        ...process.env,
        __WM_PORT_OFFSET__: PORT_OFFSET,
        NODE_ENV: "test",
      },
    });

    await use(app);
    await app.close();
  },

  window: async ({ electronApp }, use) => {
    const window = await electronApp.firstWindow();
    await use(window);
  },
});

export { expect };
