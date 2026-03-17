# Vertical Web-App Tests Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace mocked MSW handlers with a real Hono server bridge so web-app component tests exercise the full server stack, mocking only at system boundaries (child_process, 3rd-party integrations).

**Architecture:** An MSW catch-all handler forwards every `/api/*` request to the real Hono app via `app.fetch()`. The Hono app is backed by a real `WorktreeManager` pointed at a per-test temp directory. Only `child_process` (git, process spawning), `node-pty`, and 3rd-party integration modules (Jira/Linear/GitHub) are mocked.

**Tech Stack:** Vitest, React Testing Library, MSW 2, Hono `app.fetch()`, happy-dom

---

## Chunk 1: Test Infrastructure

### Task 1: Add server dependencies to web-app for testing

The web-app needs access to server and integration source code at test time. We add path aliases in the vitest config (no runtime dependency added).

**Files:**

- Modify: `apps/web-app/vite.config.ts`
- Modify: `apps/web-app/package.json` (add devDependencies that the server needs at runtime: `hono`, `nanoid`, `picocolors`, `zod`)

- [ ] **Step 1: Add devDependencies the server source code needs**

```bash
pnpm add -D --filter @openkit/web-app hono nanoid picocolors zod
```

- [ ] **Step 2: Add resolve aliases for server and integrations packages in vitest config**

In `apps/web-app/vite.config.ts`, add these aliases to `resolve.alias`:

```ts
resolve: {
  alias: {
    "@openkit/shared": path.resolve(__dirname, "../../libs/shared/src"),
    "@openkit/integrations": path.resolve(__dirname, "../../libs/integrations/src"),
  },
},
```

Also add a `test.alias` section to resolve bare server imports:

```ts
test: {
  // ... existing config
  alias: {
    "server/": path.resolve(__dirname, "../server/src/"),
  },
},
```

- [ ] **Step 3: Run typecheck to verify aliases resolve**

```bash
pnpm nx run web-app:typecheck
```

Expected: PASS (no new errors from aliases — they're only used at test time)

- [ ] **Step 4: Commit**

```bash
git add apps/web-app/vite.config.ts apps/web-app/package.json pnpm-lock.yaml
git commit -m "test(web-app): add server/integrations aliases for vertical tests"
```

---

### Task 2: Create the server bridge

This is the core infrastructure. It creates a real Hono server and provides an MSW handler that forwards requests to it.

**Files:**

- Create: `apps/web-app/src/test/server-bridge.ts`

- [ ] **Step 1: Create the server bridge module**

`apps/web-app/src/test/server-bridge.ts` must:

1. Import `WorktreeManager` from `server/manager` and `createWorktreeServer` from `server/index`
2. Export a `createServerBridge()` function that:
   - Creates a temp directory via `fs.mkdtempSync(path.join(os.tmpdir(), 'openkit-test-'))`
   - Creates `.openkit/` subdirectory structure in the temp dir
   - Writes a minimal `config.json` to `<tempDir>/.openkit/config.json`
   - Creates a `WorktreeManager` with a test config and a config file path pointing into the temp dir
   - Calls `createWorktreeServer(manager)` to get the Hono `app`
   - Returns `{ app, manager, tempDir, cleanup }` where `cleanup` removes the temp dir
3. Export a `createBridgeHandler()` function that returns an MSW `http.all("*/api/*", ...)` handler that:
   - Takes the incoming MSW request
   - Forwards it to `app.fetch(request)` (Hono's native fetch interface)
   - Returns the Hono response as an MSW `HttpResponse` passthrough

Key implementation detail for the MSW bridge handler:

```ts
import { http, type HttpHandler, passthrough } from "msw";

export function createBridgeHandler(app: {
  fetch: (req: Request) => Promise<Response>;
}): HttpHandler {
  return http.all("/api/*", async ({ request }) => {
    // Forward the request to the real Hono app
    const url = new URL(request.url);
    // Hono needs a full URL; rewrite to localhost for in-process handling
    const honoUrl = `http://localhost${url.pathname}${url.search}`;
    const honoRequest = new Request(honoUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      duplex: "half",
    });
    const response = await app.fetch(honoRequest);
    // Return the real response to MSW
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  });
}
```

- [ ] **Step 2: Verify the module compiles**

```bash
pnpm nx run web-app:typecheck
```

Expected: PASS

---

### Task 3: Create system boundary mocks

Mock `child_process`, `node-pty`, and 3rd-party integrations. These are the ONLY things we mock.

**Files:**

- Create: `apps/web-app/src/test/mocks/child-process.ts`
- Create: `apps/web-app/src/test/mocks/integrations.ts`

- [ ] **Step 1: Create child_process mock**

`apps/web-app/src/test/mocks/child-process.ts`:

This module provides a `mockChildProcess()` function that uses `vi.mock("child_process", ...)`. It should:

- Mock `execFile` (the promisified version) to simulate git commands:
  - `git worktree list --porcelain` → returns empty string (no worktrees)
  - `git rev-parse --git-dir` → returns `.git`
  - `git rev-parse --verify` → succeeds (branch exists)
  - `git show-ref --verify` → returns exit code based on branch
  - `git worktree add` → succeeds (creates directories in temp dir)
  - `git fetch` → succeeds
  - `git branch` → succeeds
  - Other git commands → succeed with empty output
- Mock `execFileSync` similarly
- Mock `spawn` to return a mock child process with stdio streams
- Export a `getExecFileCalls()` helper so tests can assert which commands were run
- Export a `setGitCommandResponse(command, response)` helper so individual tests can override behavior

- [ ] **Step 2: Create integrations mock**

`apps/web-app/src/test/mocks/integrations.ts`:

This module provides mock factories for Jira, Linear, and GitHub integrations. Use `vi.mock()` for each:

```ts
// Mock all Jira modules
vi.mock("@openkit/integrations/jira/credentials", () => ({
  loadJiraCredentials: vi.fn(() => null),
  saveJiraCredentials: vi.fn(),
  loadJiraProjectConfig: vi.fn(() => null),
  saveJiraProjectConfig: vi.fn(),
  deleteJiraCredentials: vi.fn(),
}));

vi.mock("@openkit/integrations/jira/auth", () => ({
  testConnection: vi.fn(async () => true),
  getApiBase: vi.fn(() => "https://jira.example.com"),
  getAuthHeaders: vi.fn(() => ({ Authorization: "Bearer test" })),
}));

vi.mock("@openkit/integrations/jira/api", () => ({
  fetchIssue: vi.fn(),
  fetchIssues: vi.fn(async () => []),
  resolveTaskKey: vi.fn((key: string) => key),
  saveTaskData: vi.fn(),
  downloadAttachments: vi.fn(async () => []),
}));

// Similar mocks for Linear and GitHub modules
vi.mock("@openkit/integrations/linear/credentials", () => ({ ... }));
vi.mock("@openkit/integrations/linear/api", () => ({ ... }));
vi.mock("@openkit/integrations/github/github-manager", () => ({ ... }));
vi.mock("@openkit/integrations/github/gh-client", () => ({ ... }));
```

Also mock `node-pty`:

```ts
vi.mock("node-pty", () => ({
  spawn: vi.fn(() => ({
    onData: vi.fn(),
    onExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pid: 99999,
  })),
}));
```

Also mock the server runtime monitors (they patch Node internals):

```ts
vi.mock("server/runtime/install-command-monitor", () => ({}));
vi.mock("server/runtime/command-monitor", () => ({
  setCommandMonitorSink: vi.fn(),
}));
vi.mock("server/runtime/fetch-monitor", () => ({
  setFetchMonitorSink: vi.fn(),
}));
```

Export helper functions so domain tests can configure integration responses:

```ts
export function mockJiraConfigured(config?: Partial<JiraConfig>) { ... }
export function mockJiraIssues(issues: JiraIssueSummary[]) { ... }
export function mockLinearConfigured(config?: Partial<LinearConfig>) { ... }
export function mockLinearIssues(issues: LinearIssueSummary[]) { ... }
export function mockGitHubAuthenticated() { ... }
```

- [ ] **Step 3: Verify mocks compile**

```bash
pnpm nx run web-app:typecheck
```

- [ ] **Step 4: Commit**

```bash
git add apps/web-app/src/test/mocks/child-process.ts apps/web-app/src/test/mocks/integrations.ts
git commit -m "test(web-app): add system boundary mocks for vertical tests"
```

---

### Task 4: Update test setup to use the server bridge

Replace the old MSW setup with the bridge-based one. Keep backward compatibility so existing tests still pass.

**Files:**

- Modify: `apps/web-app/src/test/setup.ts`
- Modify: `apps/web-app/src/test/mocks/handlers.ts`

- [ ] **Step 1: Update setup.ts**

The new setup must:

1. Import the boundary mocks (child-process, integrations) — these MUST be imported before anything else since they use `vi.mock()` which is hoisted
2. Import and call `createServerBridge()` to get the real Hono app
3. Import `createBridgeHandler()` to create the MSW catch-all handler
4. Set up the MSW server with the bridge handler
5. Keep the `MockEventSource` and `ServerContext` mocks (they're still needed for SSE and URL resolution)
6. In `beforeAll`: create the server bridge, start MSW with the bridge handler
7. In `afterEach`: reset handlers, clean up test state (but keep the bridge alive)
8. In `afterAll`: call `bridge.cleanup()`, close MSW server
9. Export the `bridge` object so tests can access `bridge.manager` for assertions

```ts
import "./mocks/child-process";
import "./mocks/integrations";
import "@testing-library/jest-dom/vitest";

import { setupServer } from "msw/node";
import { createServerBridge, createBridgeHandler } from "./server-bridge";

let bridge: ReturnType<typeof createServerBridge>;

export const server = setupServer();

beforeAll(() => {
  bridge = createServerBridge();
  server.use(createBridgeHandler(bridge.app));
  server.listen({ onUnhandledRequest: "bypass" });
});

afterEach(() => {
  server.resetHandlers();
  // Re-add bridge handler since resetHandlers removes it
  server.use(createBridgeHandler(bridge.app));
});

afterAll(() => {
  server.close();
  bridge.cleanup();
});

export function getTestBridge() {
  return bridge;
}

// ... keep MockEventSource and ServerContext mocks as-is ...
```

- [ ] **Step 2: Slim down handlers.ts**

Remove all the hand-written MSW handlers. Keep only:

- `createWorktreeInfo()` helper (tests may still use it for assertions)
- `resetWorktreeStore()` → repurpose to reset the bridge's WorktreeManager state if needed
- `getWorktreeStore()` → remove (tests should query via the real API)

The file should be much smaller — just test data helpers, no HTTP handlers.

- [ ] **Step 3: Run existing tests to verify they still pass**

```bash
pnpm nx run web-app:test
```

Expected: All 8 existing test files pass. If any fail, fix the failures by adjusting how they set up test data (they may need to use `server.use()` overrides for specific scenarios like error responses).

- [ ] **Step 4: Commit**

```bash
git add apps/web-app/src/test/setup.ts apps/web-app/src/test/mocks/handlers.ts apps/web-app/src/test/server-bridge.ts
git commit -m "test(web-app): replace mocked handlers with real server bridge"
```

---

## Chunk 2: Domain Tests — Worktree Lifecycle

### Task 5: Worktree lifecycle tests

Test the core worktree flow: create, list, start, stop, remove, rename, recover.

**Files:**

- Modify: `apps/web-app/src/components/CreateWorktreeModal.test.tsx` (update existing tests to use real server)
- Modify: `apps/web-app/src/components/WorktreeList.test.tsx` (update for real data)
- Modify: `apps/web-app/src/components/WorktreeItem.test.tsx` (update for real data)
- Create: `apps/web-app/src/components/WorktreeExistsModal.test.tsx`

**Key patterns for this domain:**

Tests should use the real API flow. For example, to test worktree creation:

```tsx
it("creates a worktree and shows it in the list", async () => {
  const user = userEvent.setup();
  render(<CreateWorktreeModal onClose={onClose} onCreated={onCreated} />);

  await user.type(screen.getByLabelText(/branch/i), "feat/my-feature");
  await user.click(screen.getByRole("button", { name: /create/i }));

  await waitFor(() => {
    expect(onCreated).toHaveBeenCalled();
  });
});
```

The real server will exercise: request validation, ID generation, worktree state management, and response formatting. The only mock involved is `child_process` (the `git worktree add` command).

**Tests to write:**

- [ ] Update existing `CreateWorktreeModal.test.tsx` tests to work with real server responses
- [ ] Update existing `WorktreeList.test.tsx` tests — instead of setting `worktreeStore` directly, create worktrees via the API
- [ ] Update existing `WorktreeItem.test.tsx` tests — pass real `WorktreeInfo` shapes from server
- [ ] Write `WorktreeExistsModal.test.tsx`:
  - Renders when worktree already exists (WORKTREE_EXISTS code)
  - "Reuse" action calls recover API
  - "Recreate" action calls recover with recreate
  - Close callback fires
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 3: Domain Tests — Tasks & Activity

### Task 6: Custom tasks tests

**Files:**

- Create: `apps/web-app/src/components/CreateCustomTaskModal.test.tsx`
- Create: `apps/web-app/src/components/CustomTaskList.test.tsx`
- Create: `apps/web-app/src/components/CustomTaskItem.test.tsx`
- Create: `apps/web-app/src/components/detail/CustomTaskDetailPanel.test.tsx`

Read each component file first. Then write tests covering:

**CreateCustomTaskModal:**

- Renders form fields (title, description, priority)
- Submits task via real API → server creates task file in temp dir
- Shows validation errors for empty title
- Calls onCreated callback with new task data
- Loading state while creating

**CustomTaskList:**

- Renders empty state when no tasks
- Lists tasks fetched from real API
- Renders task items with correct data
- Supports filtering/search if applicable

**CustomTaskItem:**

- Renders task title, status, priority
- Click handler fires selection callback
- Status indicator styling

**CustomTaskDetailPanel:**

- Read this component first to understand its full UI
- Renders task details from real API
- Edits task fields (title, description, status, priority) via real API
- Deletes task via real API
- Creates worktree from task
- Todo management (add, toggle, delete) if applicable

- [ ] Read each component source file
- [ ] Write failing tests
- [ ] Verify they fail for the right reason (component behavior, not mock issues)
- [ ] Implement any needed test helpers
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

### Task 7: Activity feed tests

**Files:**

- Create: `apps/web-app/src/components/ActivityFeed.test.tsx`
- Create: `apps/web-app/src/components/ActivityPage.test.tsx`

Read each component first. Then write tests covering:

**ActivityFeed:**

- Renders empty state
- Renders activity events fetched from real API
- Event items show correct metadata (type, timestamp, title)
- Filtering by category if applicable
- Real-time updates via SSE (use MockEventSource)

**ActivityPage:**

- Renders feed and any surrounding controls
- Filter/search interactions

- [ ] Read component source files
- [ ] Write tests using real API (activity events created via `bridge.manager.getActivityLog().addEvent()`)
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 4: Domain Tests — Configuration & Setup

### Task 8: Configuration panel tests

**Files:**

- Create: `apps/web-app/src/components/ConfigurationPanel.test.tsx`
- Create: `apps/web-app/src/components/IntegrationsPanel.test.tsx`
- Create: `apps/web-app/src/components/AppSettingsModal.test.tsx`

Read each component first. Then write tests covering:

**ConfigurationPanel:**

- Renders current config from real API
- Updates config fields (start command, install command, base branch) via real PATCH
- Port discovery section
- Agent rules section if present

**IntegrationsPanel:**

- Shows integration status (Jira/Linear/GitHub) — these use the mocked integration modules
- Setup/disconnect flows
- Configuration forms

**AppSettingsModal:**

- Renders settings
- Saves changes via real API

- [ ] Read component source files
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

### Task 9: Setup flow tests

**Files:**

- Create: `apps/web-app/src/components/ProjectSetupScreen.test.tsx`
- Create: `apps/web-app/src/components/SetupCommitModal.test.tsx`

Read each component first. Then write tests covering:

**ProjectSetupScreen:**

- Renders setup wizard steps
- Config detection flow (detect → display → confirm)
- Setup verification indicators

**SetupCommitModal:**

- Renders commit form
- Submits via real API
- Success/error states

- [ ] Read component source files
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 5: Domain Tests — Hooks & Skills

### Task 10: Hooks tests

**Files:**

- Create: `apps/web-app/src/components/detail/HooksTab.test.tsx`
- Create: `apps/web-app/src/components/VerificationPanel.test.tsx`

Read each component first. Then write tests covering:

**HooksTab:**

- Renders hook steps from real API
- Add/remove/toggle hook steps
- Skill configuration
- Trigger type selection

**VerificationPanel:**

- Renders hooks status
- Run hooks flow
- Results display

- [ ] Read component source files
- [ ] Write tests using real hooks API (config persisted in temp dir)
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

### Task 11: Skills tests

**Files:**

- Create: `apps/web-app/src/components/SkillCreateModal.test.tsx`
- Create: `apps/web-app/src/components/SkillItem.test.tsx`
- Create: `apps/web-app/src/components/detail/SkillDetailPanel.test.tsx`

Read each component first. Then write tests covering:

**SkillCreateModal:**

- Form fields (name, description)
- Creates skill via real API → server writes SKILL.md to temp dir
- Validation

**SkillItem:**

- Renders skill metadata
- Deploy/undeploy interactions

**SkillDetailPanel:**

- Renders skill detail from real API
- Edit skill content
- Deployment status
- Delete skill

- [ ] Read component source files
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 6: Domain Tests — Agents & Plugins

### Task 12: Agents tests

**Files:**

- Create: `apps/web-app/src/components/AgentCreateModal.test.tsx`
- Create: `apps/web-app/src/components/AgentsView.test.tsx`
- Create: `apps/web-app/src/components/AgentItem.test.tsx`
- Create: `apps/web-app/src/components/detail/AgentDetailPanel.test.tsx`

Read each component first. Then write tests covering:

**AgentCreateModal:**

- Form fields (name, description, tools, model, instructions)
- Creates agent via real API
- Scope selection (global/project)

**AgentsView:**

- Renders agent list from real API
- Toolbar actions
- Empty state

**AgentItem:**

- Renders agent metadata
- Click selection

**AgentDetailPanel:**

- Renders agent detail
- Edit fields
- Deploy/undeploy to targets
- Delete agent

- [ ] Read component source files
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

### Task 13: Plugins tests

**Files:**

- Create: `apps/web-app/src/components/PluginItem.test.tsx`
- Create: `apps/web-app/src/components/PluginInstallModal.test.tsx`
- Create: `apps/web-app/src/components/detail/PluginDetailPanel.test.tsx`

Read each component first. Then write tests covering:

**PluginItem:**

- Renders plugin name, description, status
- Enable/disable toggle

**PluginInstallModal:**

- Install from reference/URL
- Shows available plugins

**PluginDetailPanel:**

- Plugin detail view
- Configuration
- Install/uninstall
- Deploy as agent

- [ ] Read component source files
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 7: Domain Tests — Notes & Detail Panels

### Task 14: Notes tests

**Files:**

- Create: `apps/web-app/src/components/detail/NotesSection.test.tsx`
- Create: `apps/web-app/src/components/detail/TodoList.test.tsx`

Read each component first. Then write tests covering:

**NotesSection:**

- Renders notes from real API (personal, AI context sections)
- Edits note content → saves via real API → persists in temp dir
- Empty state

**TodoList:**

- Renders todos from real API
- Add new todo
- Toggle todo completion
- Delete todo

- [ ] Read component source files
- [ ] Write tests using real notes API
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

### Task 15: Issue detail panels tests

**Files:**

- Create: `apps/web-app/src/components/detail/JiraDetailPanel.test.tsx`
- Create: `apps/web-app/src/components/detail/LinearDetailPanel.test.tsx`
- Create: `apps/web-app/src/components/detail/DetailPanel.test.tsx`
- Create: `apps/web-app/src/components/detail/GitActionInputs.test.tsx`

Read each component first. Then write tests covering:

**JiraDetailPanel:**

- Renders issue detail (uses `mockJiraConfigured()` + `mockJiraIssues()` from integration mocks)
- Status/priority/type updates (mock the Jira API responses)
- Comments CRUD
- Notes section integration

**LinearDetailPanel:**

- Same pattern as Jira but with Linear mocks
- Status/priority updates
- Comments CRUD

**DetailPanel:**

- Container/routing logic for different detail views
- Tab switching if applicable

**GitActionInputs:**

- Commit message input
- Push button
- PR creation form

For Jira/Linear panels: the server routes are real (validation, error handling), but the external API calls are mocked via `apps/web-app/src/test/mocks/integrations.ts`. This is the vertical sweet spot — you test the full stack except the 3rd-party HTTP calls.

- [ ] Read component source files
- [ ] Configure integration mocks for each test
- [ ] Write tests
- [ ] Run tests: `pnpm nx run web-app:test`
- [ ] Commit

---

## Chunk 8: Finalization

### Task 16: Run full test suite and fix any issues

- [ ] Run all web-app tests: `pnpm nx run web-app:test`
- [ ] Run typecheck: `pnpm nx run web-app:typecheck`
- [ ] Run lint: `pnpm nx run web-app:lint`
- [ ] Fix any failures
- [ ] Final commit

---

## Testing Guidelines for All Agents

### DO:

- **Read every component source file before writing tests.** Understand what it renders, what hooks it uses, what API calls it makes.
- Use `render()` from `../test/render` (or `../../test/render` from detail/).
- Use `userEvent.setup()` for all interactions.
- Use `screen.getByRole()`, `screen.getByLabelText()`, `screen.getByText()` — never query by test-id or class.
- Use `waitFor()` for async assertions (API calls, state updates).
- Use `server.use()` from the MSW server (imported from `../test/setup` or `../../test/setup`) to override specific endpoints for error scenarios.
- One behavior per `it()` block. Arrange-Act-Assert structure.
- Name tests as behavior specs: `"shows error toast when creation fails"`, not `"test error"`.
- Use the testing skill (`apps/web-app/.claude/skills/testing/`) if available for additional patterns.
- **Use real server interactions wherever possible.** For example, to test a list component, first create items via the API, then render the list and verify items appear.
- Import `getTestBridge` from test setup to access the bridge's manager for direct state setup when needed (e.g., seeding activity events).

### DON'T:

- Don't mock API functions (`vi.mock("../hooks/api")`). The whole point is to hit the real server.
- Don't mock internal hooks (`useWorktrees`, `useConfig`, etc.). Let them make real API calls.
- Don't create new MSW handlers for `/api/*` routes. The bridge handles all of them.
- Don't use `server.use()` to add happy-path handlers — only use it for error/edge-case overrides.
- Don't test implementation details (internal state, hook internals, CSS classes).
- Don't add `data-testid` attributes to components.
