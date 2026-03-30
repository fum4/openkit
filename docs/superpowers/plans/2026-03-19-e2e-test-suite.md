# Plan: E2E Test Suite — Onboarding Flow

## Context

The project has robust unit/component tests (Vitest + RTL + MSW) but zero e2e coverage. We need a real end-to-end test that launches the Electron app, opens a project, walks through the onboarding setup wizard, and verifies the user lands on the main workspace.

This is the foundation for the e2e test suite — once the infrastructure is in place, additional flows can be added incrementally.

## Approach: Playwright + Electron

Playwright has first-class Electron support via `_electron.launch()`. It launches the real Electron binary, gives us a `Page` object for the renderer window, and lets us evaluate code in the main process (for dialog mocking). This tests the full stack: Electron main process → IPC → CLI spawn → HTTP server → React UI.

## Files to Create

```
apps/e2e/
├── README.md
├── package.json
├── project.json
├── tsconfig.json
├── playwright.config.ts
└── src/
    ├── fixtures/
    │   ├── electron-app.ts       — Fixture: launch/teardown Electron
    │   ├── test-project.ts       — Fixture: create temp git repo
    │   └── index.ts              — Barrel export
    └── __test__/
        └── onboarding.test.ts    — First test: full onboarding flow
```

## Files to Modify

- `package.json` (root) — add `e2e` script
- `docs/DEVELOPMENT.md` — add E2E section
- `docs/ARCHITECTURE.md` — mention e2e package

## Implementation Steps

### Step 1: Create `apps/e2e/` package

**`apps/e2e/package.json`**:

- Name: `@openkit/e2e`, private, type: module
- devDependencies: `@playwright/test`, `electron` (same version as desktop-app: `^40.6.1`)
- Scripts: `e2e`, `e2e:ui`, `e2e:report`

**`apps/e2e/project.json`**:

- Target `e2e` with `dependsOn: ["desktop-app:build"]` — this cascades through `web-app:build`, `cli:build`, `server:build` automatically
- Target `e2e:ui` for interactive debugging

**`apps/e2e/playwright.config.ts`**:

- `testDir: "./src/__test__"`
- `timeout: 60_000` (server startup can take up to 30s)
- `workers: 1` (only one Electron instance at a time)
- `trace: "on-first-retry"`, `screenshot: "only-on-failure"`
- No browser `projects` — Electron tests don't use them

**Root `package.json`**: add `"e2e": "pnpm nx run e2e:e2e"`

Install with `cd apps/e2e && pnpm add -D @playwright/test electron`.

### Step 2: Create Electron app fixture (`src/fixtures/electron-app.ts`)

Extends Playwright's `test` with two fixtures:

- **`electronApp`**: Calls `_electron.launch()` with:
  - `args: [resolvedPath("apps/desktop-app/dist/main.js")]`
  - `env.__WM_PORT_OFFSET__: "900"` — this scopes the app name to `OpenKit-worktree-900` and uses a separate userData path + single-instance lock, avoiding conflicts with any running dev instance (leverages existing isolation in `main.ts:60-72`)
  - `env.NODE_ENV: "test"`
  - Teardown: `electronApp.close()`

- **`window`**: Calls `electronApp.firstWindow()` to get the renderer Page

### Step 3: Create test project fixture (`src/fixtures/test-project.ts`)

Creates a temporary git repo that triggers the onboarding flow:

- `mkdtempSync` for isolation
- `git init` + `git commit --allow-empty -m "init"` (needs at least one commit)
- No `.openkit/config.json` — this is what triggers the setup screen
- Returns `{ dir, cleanup }` for use/teardown

### Step 4: Write the onboarding test (`src/__test__/onboarding.test.ts`)

The test flow:

```
1. Electron launches → WelcomeScreen visible
   Assert: "Welcome to OpenKit" text visible

2. Mock native dialog + click "Ready to launch"
   - Use electronApp.evaluate() to override dialog.showOpenDialog
     to return the temp project dir (mocking at the OS boundary)
   - Click the "Ready to launch" button

3. Wait for server startup + setup screen
   - ProjectManager spawns CLI → CLI starts server → polls /api/config
   - Once ready, web-app detects no config → shows ProjectSetupScreen
   Assert: setup screen heading visible (timeout: 30s for server startup)

4. Choice screen → click auto-detect
   Assert: auto-detect option visible, click it

5. Agents screen → click "Skip for now"

6. Commit & Push screen → click "Skip for now"

7. Integrations screen → click "Continue without integrations"
   (or "Continue" — the text varies based on connected count)

8. Complete screen → click "Go to workspace"

9. Verify workspace loaded
   Assert: main workspace UI elements visible (e.g. "Worktrees" tab)
```

### Step 5: Add scripts and update docs

- Root `package.json`: add `"e2e"` script
- `docs/DEVELOPMENT.md`: add E2E testing section (how to run, how to debug with `--ui`)
- `docs/ARCHITECTURE.md`: mention the `apps/e2e` package

## Key Design Decisions

**Dialog mocking strategy**: Override `dialog.showOpenDialog` via `electronApp.evaluate()` before clicking the button. This exercises the full UI flow (button → selectFolder → openProject IPC) while only stubbing the native OS boundary — consistent with the project's "mock at the boundary" testing philosophy.

**Instance isolation via `__WM_PORT_OFFSET__`**: The app already supports this for worktree-scoped Electron instances. Setting it to `900` gives the test its own app name, userData directory, and single-instance lock — no conflict with dev instances.

**Serial execution (`workers: 1`)**: Only one Electron app can meaningfully run at a time per test suite. Parallelism comes from running e2e as a separate CI job alongside unit tests.

**No Playwright browsers needed**: Electron tests use the Electron binary directly, not Chromium/Firefox/WebKit. No `playwright install` step required.

## Critical Files Reference

- `apps/desktop-app/src/main.ts` — Electron entry: IPC handlers, dialog.showOpenDialog, `__WM_PORT_OFFSET__` isolation (lines 60-72)
- `apps/desktop-app/project.json` — Nx build deps: desktop-app:build → web-app:build, cli:build, server:build
- `apps/web-app/src/components/ProjectSetupScreen.tsx` — Setup wizard: `SetupMode` state machine (`choice` → `agents` → `commit-prompt` → `integrations` → `getting-started`)
- `apps/web-app/src/components/WelcomeScreen.tsx` — Initial screen: "Ready to launch" button triggers project open
- `apps/web-app/src/App.tsx` — Setup condition logic: `needsSetup` (line 440), `showWelcomeScreen` (line 445), `handleSetupComplete` (line 455)
- `apps/desktop-app/src/server-spawner.ts` — Server spawn + readiness polling (`waitForServerReady`, 30s timeout, 500ms interval)
- `apps/desktop-app/src/project-manager.ts` — Multi-project tab management, IPC event dispatch

## Verification

1. `pnpm build` — ensure all apps build successfully
2. `pnpm e2e` — runs the onboarding test end-to-end
3. On failure: check `apps/e2e/playwright-report/` for screenshots and traces
4. Debug interactively: `pnpm nx run e2e:e2e:ui`
