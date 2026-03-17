# Remove OpenKit's Own MCP Server — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove OpenKit's own MCP server while preserving all skill deployment, third-party MCP server management, and agent instruction infrastructure.

**Architecture:** OpenKit currently exposes its capabilities to AI agents via two mechanisms: (1) its own MCP server (`openkit mcp` CLI command + HTTP transport), and (2) skill files deployed to agent config directories (SKILL.md, .mdc, .prompt.md). The MCP path is deprecated. This plan removes it entirely, leaving skills as the sole mechanism. The `actions.ts` tool definitions (only consumed by MCP) become dead code and are removed. The circular dependency between `@openkit/agents` and `@openkit/server` dissolves as a side effect.

**Tech Stack:** TypeScript, pnpm workspaces, Nx, Vitest, Hono (server routes)

**Scope boundary:** We remove ONLY OpenKit's own MCP server. Third-party MCP server management (`apps/server/src/routes/mcp-servers.ts`), agent instruction deployment (`builtin-instructions.ts`), and skill deployment routes (`routes/skills.ts`) are untouched.

---

## Pre-implementation: safety checks

The onboarding wizard (`ProjectSetupScreen.tsx`) already uses the skills API (`deploySkill`/`undeploySkill`) — confirmed by lines 523-526 using `ONBOARDING_SKILL_NAME = "work-on-task"`. The MCP code path is commented out (lines 518-522). No action needed on onboarding.

The `IntegrationsPanel` `CodingAgentsCard` uses MCP setup routes, but is gated behind `OPENKIT_ENABLE_MCP_SETUP=1` (off by default). Users don't see it in normal operation.

---

### Task 1: Remove MCP server core files

**Files:**

- Delete: `libs/agents/src/mcp.ts`
- Delete: `libs/agents/src/actions.ts`
- Delete: `apps/server/src/mcp-server-factory.ts`
- Delete: `apps/server/src/routes/mcp-transport.ts`
- Delete: `apps/server/src/routes/mcp.ts`
- Delete: `libs/agents/src/mcp/mcp-server.md`
- Delete: `libs/agents/src/mcp/mcp-work-on-task.md`

- [ ] **Step 1: Delete the 7 MCP-only files**

```bash
rm libs/agents/src/mcp.ts
rm libs/agents/src/actions.ts
rm apps/server/src/mcp-server-factory.ts
rm apps/server/src/routes/mcp-transport.ts
rm apps/server/src/routes/mcp.ts
rm libs/agents/src/mcp/mcp-server.md
rm libs/agents/src/mcp/mcp-work-on-task.md
```

- [ ] **Step 2: Verify no remaining imports reference these files**

```bash
# Should return NO results from source files (only docs/plans):
grep -r "mcp-server-factory\|mcp-transport\|routes/mcp\b\|from.*@openkit/agents/actions\|from.*@openkit/agents/mcp\|from.*\.\/mcp\b\|from.*\.\/actions\b" --include="*.ts" --include="*.tsx" apps/ libs/
```

---

### Task 2: Clean up `libs/agents` exports

**Files:**

- Modify: `libs/agents/src/instructions.ts`
- Modify: `libs/agents/src/index.ts`
- Modify: `libs/agents/package.json` — remove `@openkit/server` and `@modelcontextprotocol/sdk`

- [ ] **Step 1: Remove MCP exports from `instructions.ts`**

Remove the two MCP-specific imports and exports:

- `import mcpServerMd from "./mcp/mcp-server.md"` (line 3)
- `import mcpWorkOnTaskMd from "./mcp/mcp-work-on-task.md"` (line 4)
- `export const MCP_INSTRUCTIONS = ...` (line 35)
- `export const MCP_WORK_ON_TASK_PROMPT = ...` (line 38)

Keep everything else: `CLAUDE_SKILL`, `CURSOR_RULE`, `VSCODE_PROMPT`, `BUNDLED_SKILLS`, `BundledSkill`, and the `workflowInstructionsMd` import (used by the skill exports).

- [ ] **Step 2: Verify `index.ts` re-exports are clean**

`index.ts` is `export * from "./instructions"` — the removed exports will automatically stop being re-exported. No edit needed unless there are other MCP-related re-exports.

- [ ] **Step 3: Remove `@openkit/server` and `@modelcontextprotocol/sdk` from `libs/agents/package.json`**

After `mcp.ts` and `actions.ts` are gone, agents has zero imports from `@openkit/server` and `@modelcontextprotocol/sdk`. Remove both from `dependencies`.

- [ ] **Step 4: Run `pnpm install` to update lockfile and symlinks**

---

### Task 3: Remove `mcp` CLI subcommand

**Files:**

- Modify: `apps/cli/src/index.ts` — remove `mcp` subcommand handler and help text
- Modify: `apps/cli/package.json` — remove `@modelcontextprotocol/sdk` dependency

- [ ] **Step 1: Remove the `mcp` subcommand block from `index.ts`**

Find the block that handles `case "mcp":` (lines ~213-222) and remove it. Also remove `mcp` from `printHelp()`.

- [ ] **Step 2: Remove `@modelcontextprotocol/sdk` from `apps/cli/package.json`**

---

### Task 4: Remove MCP route registration from server

**Files:**

- Modify: `apps/server/src/index.ts` — remove MCP route imports and registration
- Modify: `apps/server/package.json` — remove `@modelcontextprotocol/sdk`

- [ ] **Step 1: Remove MCP imports from `apps/server/src/index.ts`**

Remove:

- Import of `registerMcpRoutes` from `./routes/mcp`
- Import of `registerMcpTransportRoute` from `./routes/mcp-transport`
- The conditional `if (mcpSetupEnabled) { registerMcpRoutes(...) }` block
- The `registerMcpTransportRoute(...)` call
- The `isMcpSetupEnabled` import (check if used elsewhere in this file first — it's also used to log the "MCP setup routes disabled" message and pass to the variable; remove all of it)

Keep: `registerMcpServerRoutes` import and call (third-party MCP server manager — NOT related to OpenKit's own MCP server).

- [ ] **Step 2: Remove `@modelcontextprotocol/sdk` from `apps/server/package.json`**

- [ ] **Step 3: Run `pnpm install`**

---

### Task 5: Remove MCP feature flag infrastructure

**Files:**

- Modify: `apps/server/src/feature-flags.ts` — remove `isMcpSetupEnabled`, keep `isTruthy` if used elsewhere
- Modify: `apps/server/src/feature-flags.test.ts` — remove `isMcpSetupEnabled` tests
- Modify: `apps/server/src/routes/config.ts` — remove `mcpSetupEnabled` from features endpoint

- [ ] **Step 1: Check if `isTruthy` is used by anything other than `isMcpSetupEnabled`**

If `isMcpSetupEnabled` is the only export, and `isTruthy` is only used by it, delete the entire file and its test file. Otherwise keep `isTruthy`.

- [ ] **Step 2: Remove `mcpSetupEnabled` from `GET /api/config/features` in `routes/config.ts`**

Line 91: `mcpSetupEnabled: isMcpSetupEnabled()` — remove this property. If the features object becomes empty, consider removing the endpoint entirely.

- [ ] **Step 3: Update tests**

Remove or update the `feature-flags.test.ts` tests related to `isMcpSetupEnabled`.

---

### Task 6: Remove MCP UI from `IntegrationsPanel`

**Files:**

- Modify: `apps/web-app/src/components/IntegrationsPanel.tsx` — remove `CodingAgentsCard` and `mcpSetupEnabled` state
- Modify: `apps/web-app/src/hooks/api.ts` — remove `fetchMcpStatus`, `setupMcpAgent`, `removeMcpAgent`, `fetchSetupFeatures`

- [ ] **Step 1: Remove MCP API functions from `api.ts`**

Remove: `fetchMcpStatus`, `setupMcpAgent`, `removeMcpAgent`, `fetchSetupFeatures` (if it only returns `mcpSetupEnabled`).

- [ ] **Step 2: Remove `CodingAgentsCard` from `IntegrationsPanel.tsx`**

Remove:

- The `CodingAgentsCard` component definition (lines ~1344-1785 area)
- The `mcpSetupEnabled` state variable and its fetch logic
- The conditional render `{mcpSetupEnabled && (<CodingAgentsCard ... />)}`

Note: The onboarding wizard already provides the same agent setup capability through skills. There is no need to build a replacement card.

---

### Task 7: Clean up Vite stub plugin

**Files:**

- Modify: `apps/web-app/vite.config.ts`

- [ ] **Step 1: Update the stub plugin**

After removing `@modelcontextprotocol/sdk` from server's deps, the stub for it may no longer be needed (no transitive import path). Similarly, the `@openkit/agents` stub exported `MCP_INSTRUCTIONS` and `MCP_WORK_ON_TASK_PROMPT` — those exports no longer exist.

Update the stub plugin:

- Remove `"@modelcontextprotocol/"` from the `prefixes` array (verify it's no longer transitively imported first)
- Remove `noop as MCP_INSTRUCTIONS` and `noop as MCP_WORK_ON_TASK_PROMPT` from the agents stub exports
- Remove `noop as McpServer, noop as StdioServerTransport` (SDK stub line)
- Remove `noop as actions` since `actions.ts` is deleted

- [ ] **Step 2: Verify web-app tests still pass**

```bash
pnpm nx run web-app:test --skip-nx-cache
```

---

### Task 8: Remove `@openkit/agents` dependency from `@openkit/server` (if now possible)

**Files:**

- Check: `apps/server/package.json`

- [ ] **Step 1: Verify server's remaining agents imports**

After MCP removal, server should only import from `@openkit/agents` for:

- `BUNDLED_SKILLS` (skills.ts, verification-skills.ts)
- `CLAUDE_SKILL`, `CURSOR_RULE`, `VSCODE_PROMPT` (builtin-instructions.ts)

These are all content from `instructions.ts`. The `@openkit/agents` dependency is still needed — but now it's **one-directional** (server → agents). No cycle.

- [ ] **Step 2: Verify agents no longer depends on server**

`libs/agents/package.json` should NOT have `@openkit/server` in its dependencies after Task 2. Confirm.

- [ ] **Step 3: Remove `dependsOn: []` from `libs/agents/project.json`**

The `dependsOn: []` was needed to break the Nx circular dependency. With the cycle gone, Nx can infer the correct ordering naturally. Remove the override.

---

### Task 9: Full verification

- [ ] **Step 1: Typecheck all projects**

```bash
pnpm nx run-many -t typecheck --skip-nx-cache
```

- [ ] **Step 2: Run all tests**

```bash
pnpm nx run-many -t test --skip-nx-cache
```

- [ ] **Step 3: Build all projects**

```bash
pnpm nx run-many -t build --skip-nx-cache
```

- [ ] **Step 4: Verify no external @openkit imports in built output**

```bash
grep "from.*@openkit" apps/cli/dist/cli/index.js apps/server/dist/standalone.js apps/desktop-app/dist/main.js
```

Expected: no matches.

- [ ] **Step 5: Verify the dependency graph is acyclic**

```bash
pnpm nx graph --file=output.json 2>/dev/null
# Or just: confirm `pnpm nx run-many -t typecheck` succeeds without dependsOn overrides
```

---

### Task 10: Update documentation

**Files:**

- Modify: `docs/MCP.md` — mark OpenKit's own MCP server as removed; keep third-party MCP server management docs
- Modify: `docs/CLI.md` — remove `openkit mcp` command docs, remove `OPENKIT_ENABLE_MCP_SETUP` env var
- Modify: `docs/API.md` — remove `/api/mcp/status`, `/api/mcp/setup`, `/api/mcp/remove`, `/mcp` endpoints; remove `mcpSetupEnabled` from features
- Modify: `docs/AGENTS.md` — remove MCP setup references, keep skill deployment
- Modify: `docs/ARCHITECTURE.md` — update dependency graph, remove MCP references
- Modify: `CLAUDE.md` + `AGENTS.md` (root) — MCP Status section already says "legacy" / "do not use"; update to say "removed"
- Modify: `docs/SETUP-FLOW.md` — remove any MCP references in onboarding flow docs

- [ ] **Step 1: Update all docs listed above**

Focus on accuracy: remove references to `openkit mcp`, `/api/mcp/*` endpoints, `OPENKIT_ENABLE_MCP_SETUP`, and the CodingAgentsCard. Keep all references to third-party MCP server management and skill deployment.
