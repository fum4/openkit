/**
 * E2E test for the full onboarding flow: launch Electron → WelcomeScreen → open project →
 * setup wizard (auto-detect → agents → commit → integrations → complete) → main workspace.
 */
import { test, expect } from "./fixtures.js";

test.describe("Onboarding flow", () => {
  test("completes setup wizard and reaches the workspace", async ({
    electronApp,
    window,
    testProject,
  }) => {
    // 1. WelcomeScreen should be visible
    await expect(window.getByText("Welcome to")).toBeVisible({ timeout: 15_000 });
    await expect(window.getByText("Ready to launch")).toBeVisible();

    // 2. Mock the native file dialog to return the test project dir, then click "Ready to launch"
    await electronApp.evaluate(({ dialog }, projectDir) => {
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [projectDir] });
    }, testProject.dir);

    await window.getByText("Ready to launch").click();

    // 3. Wait for server startup + setup screen (server can take up to 30s to start)
    await expect(window.getByText("Auto-detect settings")).toBeVisible({ timeout: 45_000 });

    // 4. Choice screen → click auto-detect
    await window.getByText("Auto-detect settings").click();

    // 5. Agents screen → click "Skip for now"
    await expect(window.getByText("Skip for now").first()).toBeVisible({ timeout: 15_000 });
    await window.getByText("Skip for now").first().click();

    // 6. Commit & Push screen → click "Skip for now"
    await expect(window.getByText("Configuration Created")).toBeVisible({ timeout: 15_000 });
    await window.getByText("Skip for now").first().click();

    // 7. Integrations screen → click "Continue without integrations" (or "Continue")
    const continueButton = window.getByText(/^Continue/);
    await expect(continueButton).toBeVisible({ timeout: 15_000 });
    await continueButton.click();

    // 8. Complete screen → click "Go to workspace"
    await expect(window.getByText("Go to workspace")).toBeVisible({ timeout: 10_000 });
    await window.getByText("Go to workspace").click();

    // 9. Verify workspace loaded — the main UI should show the "Create worktree" button
    await expect(window.getByText("Create worktree")).toBeVisible({ timeout: 15_000 });
  });
});
