# Unified Logger Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the logger the single API for all operational logging, replacing all direct `opsLog.addEvent()` calls in the server.

**Architecture:** Add `started()` method to all logger bindings (Go, Node, Python, Zig, browser WASM). Update `success()` to inject `status: "success"` into context. Update `/api/client-logs` endpoint to extract well-known metadata keys (`action`, `status`, `worktreeId`, `projectName`, `runId`) into top-level ops-log fields. Then migrate all 20+ direct `opsLog.addEvent()` call sites to use logger sub-loggers with structured metadata.

**Tech Stack:** Go, TypeScript, Python, Zig, TinyGo WASM, Vitest

**Spec:** `docs/superpowers/specs/2026-03-17-unified-logger-design.md`

---

## Chunk 1: Logger bindings — add `started()` and inject status

### Task 1: Go logger — add `Started()` method and inject status in `Success()`

**Files:**

- Modify: `libs/logger/logger.go`
- Modify: `libs/logger/formatter.go` (add STARTED level rendering)

- [ ] **Step 1: Add `Started()` method to Go Logger**

In `libs/logger/logger.go`, add after the `Success` method:

```go
func (l *Logger) Started(message string, context map[string]any) {
	if context == nil {
		context = map[string]any{}
	}
	if _, ok := context["status"]; !ok {
		context["status"] = "started"
	}
	l.log("INFO", message, context)
}
```

- [ ] **Step 2: Update `Success()` to inject status**

```go
func (l *Logger) Success(message string, context map[string]any) {
	if context == nil {
		context = map[string]any{}
	}
	if _, ok := context["status"]; !ok {
		context["status"] = "success"
	}
	l.log("SUCCESS", message, context)
}
```

- [ ] **Step 3: Update formatter to handle STARTED display**

In `libs/logger/formatter.go`, the `DevFormatter.Format` method already handles `SUCCESS` specially (shows green bullet). Add similar handling for entries that have `status: "started"` in context — but since STARTED uses `INFO` level, the formatter doesn't need a new level. The status is carried in metadata only. No formatter change needed.

- [ ] **Step 4: Verify — the Go logger doesn't have its own tests (tested via bindings). Skip to next task.**

---

### Task 2: Go CGO exports — add `LoggerStarted`

**Files:**

- Modify: `libs/logger/cgo/exports.go`

- [ ] **Step 1: Add `LoggerStarted` export**

After the `LoggerSuccess` function:

```go
//export LoggerStarted
func LoggerStarted(id C.int, message, contextJSON *C.char) {
	l := getLogger(int(id))
	if l == nil {
		return
	}

	context := parseContext(C.GoString(contextJSON))
	l.Started(C.GoString(message), context)
}
```

- [ ] **Step 2: Rebuild the Go shared library**

```bash
cd libs/logger/cgo && ./build.sh
```

---

### Task 3: Node bindings — add `started()` and update `success()`

**Files:**

- Modify: `libs/logger/node/src/index.ts`
- Modify: `libs/logger/node/src/bindings.ts`
- Modify: `libs/logger/node/src/index.test.ts`

- [ ] **Step 1: Add `LoggerStarted` to bindings interface and native loader**

In `libs/logger/node/src/bindings.ts`, add `LoggerStarted: LogFn;` to the `LoggerBindings` interface and add to the native loader:

```typescript
LoggerStarted: lib.func("LoggerStarted", "void", ["int", "string", "string"]),
```

And add `LoggerStarted: noop,` to the fallback.

- [ ] **Step 2: Add `started()` method and update `success()` with status comments**

In `libs/logger/node/src/index.ts`, add after the `success()` method:

```typescript
  /** Convenience: level info, status started */
  started(message: string, context?: LogContext): void {
    const ctx = normalizeContext({ ...context, status: "started" });
    const bindings = getBindings();
    bindings.LoggerStarted(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(`▶ ${message}`, ...(ctx ? [ctx] : []));
    }

    this.dispatch("info", message, ctx);
  }
```

Update the existing method comments:

```typescript
  /** Convenience: level debug, status info */
  debug(message: string, context?: LogContext): void {

  /** Convenience: level info, status info */
  info(message: string, context?: LogContext): void {

  /** Convenience: level warn, status info */
  warn(message: string, context?: LogContext): void {

  /** Convenience: level error, status failed */
  error(message: string, context?: LogContext): void {

  /** Convenience: level info, status success (green ● prefix) */
  success(message: string, context?: LogContext): void {

  /** Convenience: level info, status info (no prefix) */
  plain(message: string, context?: LogContext): void {
```

Update `success()` to inject status:

```typescript
  /** Convenience: level info, status success (green ● prefix) */
  success(message: string, context?: LogContext): void {
    const ctx = normalizeContext({ ...context, status: "success" });
    const bindings = getBindings();
    bindings.LoggerSuccess(this.handle, message, JSON.stringify(ctx || {}));

    if (!this.native) {
      console.log(`● ${message}`, ...(ctx ? [ctx] : []));
    }

    this.dispatch("info", message, ctx);
  }
```

- [ ] **Step 3: Add tests for `started()` and status injection**

In `libs/logger/node/src/index.test.ts`, add test cases:

```typescript
it("started() dispatches with status: started", () => {
  const sink = vi.fn();
  const unsub = Logger.addSink(sink);
  const logger = new Logger("test");

  logger.started("Building project", { domain: "build" });

  expect(sink).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "info",
      message: "Building project",
      metadata: expect.objectContaining({ status: "started" }),
    }),
  );
  unsub();
});

it("success() dispatches with status: success", () => {
  const sink = vi.fn();
  const unsub = Logger.addSink(sink);
  const logger = new Logger("test");

  logger.success("Build complete", { domain: "build" });

  expect(sink).toHaveBeenCalledWith(
    expect.objectContaining({
      level: "info",
      message: "Build complete",
      metadata: expect.objectContaining({ status: "success" }),
    }),
  );
  unsub();
});
```

- [ ] **Step 4: Run tests**

```bash
pnpm nx run logger:test --skip-nx-cache
```

---

### Task 4: Browser bindings — add `started()`

**Files:**

- Modify: `libs/logger/browser/src/index.ts`

- [ ] **Step 1: Add `started()` method and update `success()`**

In the `Logger` class, add after `success()`:

```typescript
  /** Convenience: level info, status started */
  started(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerStarted(this.handle, message, JSON.stringify(normalizeContext({ ...context, status: "started" }) ?? {}));
  }
```

Update `success()` to inject status:

```typescript
  /** Convenience: level info, status success (green ● prefix) */
  success(message: string, context?: LogContext): void {
    this.ensureHandle();
    if (this.handle === 0) return;
    getApi().LoggerSuccess(this.handle, message, JSON.stringify(normalizeContext({ ...context, status: "success" }) ?? {}));
  }
```

Add `LoggerStarted` to the `WasmLoggerAPI` interface:

```typescript
LoggerStarted: (id: number, message: string, contextJSON: string) => void;
```

Add comments to all methods matching the Node bindings pattern.

---

### Task 5: WASM bridge — add `LoggerStarted`

**Files:**

- Modify: `libs/logger/wasm/main.go`

- [ ] **Step 1: Register `LoggerStarted` in the WASM API**

Add to the `main()` function:

```go
api.Set("LoggerStarted", js.FuncOf(loggerLog((*logger.Logger).Started)))
```

- [ ] **Step 2: Rebuild WASM**

```bash
cd libs/logger/wasm && ./build.sh
```

---

### Task 6: Python bindings — add `started()`

**Files:**

- Modify: `libs/logger/python/logger.py`
- Modify: `libs/logger/python/bindings.py`

- [ ] **Step 1: Add `LoggerStarted` to bindings**

In `libs/logger/python/bindings.py`, add the function binding following the existing pattern (check the file for the exact registration syntax).

- [ ] **Step 2: Add `started()` method**

In `libs/logger/python/logger.py`, after `success()`:

```python
def started(self, message: str, *, domain: str, **context: Any) -> None:
    """Log started message (INFO level, status: started). ``domain`` is required."""
    ctx = {**context, "status": "started"}
    lib.LoggerStarted(
        self.handle,
        message.encode("utf-8"),
        self._build_context(domain, ctx).encode("utf-8"),
    )
```

Update `success()` to inject status:

```python
def success(self, message: str, *, domain: str, **context: Any) -> None:
    """Log success message (green bullet, INFO level, status: success). ``domain`` is required."""
    ctx = {**context, "status": "success"}
    lib.LoggerSuccess(
        self.handle,
        message.encode("utf-8"),
        self._build_context(domain, ctx).encode("utf-8"),
    )
```

Also add `'started'` to the `__getattr__` guard list.

---

### Task 7: Zig bindings — add `started()`

**Files:**

- Modify: `libs/logger/zig/logger.zig`

- [ ] **Step 1: Add `started` symbol resolution**

In the `Symbols` struct, add:

```zig
started: LoggerLogFn,
```

In `resolveSymbols()`, add:

```zig
.started = @ptrCast(@alignCast(std.c.dlsym(handle, "LoggerStarted") orelse return null)),
```

- [ ] **Step 2: Add `started()` method**

```zig
pub fn started(self: *const Logger, msg: [*:0]const u8, context: [*:0]const u8) void {
    const syms = resolved orelse return;
    if (self.available) syms.started(self.handle, msg, context);
}
```

---

## Chunk 2: Server endpoint — extract well-known keys

### Task 8: Update `/api/client-logs` to extract well-known metadata keys

**Files:**

- Modify: `apps/server/src/routes/logs.ts`
- Test: `apps/server/src/routes/logs.test.ts` (create if not exists, or add to existing test)

- [ ] **Step 1: Update the entry processing loop**

In `apps/server/src/routes/logs.ts`, the `POST /api/client-logs` handler at line ~101 currently does:

```typescript
const metadata: Record<string, unknown> = { ...entry.metadata };
if (entry.domain) metadata.domain = entry.domain;

opsLog.addEvent({
  source: entry.subsystem ? `${entry.system}.${entry.subsystem}` : entry.system,
  action: "log",
  message: entry.message,
  level: entry.level === "warn" ? "warning" : (entry.level as OpsLogLevel),
  status: entry.level === "error" ? "failed" : "info",
  projectName,
  metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
});
```

Replace with:

```typescript
// Extract well-known keys from metadata into top-level ops-log fields.
// Everything else stays in the metadata bag.
const {
  action: metaAction,
  status: metaStatus,
  worktreeId: metaWorktreeId,
  projectName: metaProjectName,
  runId: metaRunId,
  ...rest
} = entry.metadata ?? {};

const cleanMetadata: Record<string, unknown> = { ...rest };
if (entry.domain) cleanMetadata.domain = entry.domain;

// Default status: error→failed, success→success, else info
const defaultStatus = entry.level === "error" ? "failed" : "info";

opsLog.addEvent({
  source: entry.subsystem ? `${entry.system}.${entry.subsystem}` : entry.system,
  action: typeof metaAction === "string" ? metaAction : "log",
  message: entry.message,
  level: entry.level === "warn" ? "warning" : (entry.level as OpsLogLevel),
  status: typeof metaStatus === "string" ? (metaStatus as OpsLogStatus) : defaultStatus,
  worktreeId: typeof metaWorktreeId === "string" ? metaWorktreeId : undefined,
  projectName: typeof metaProjectName === "string" ? metaProjectName : projectName,
  runId: typeof metaRunId === "string" ? metaRunId : undefined,
  metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
});
```

- [ ] **Step 2: Run server tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

## Chunk 3: Migrate server call sites

For each domain, replace `opsLog.addEvent()` with logger calls. Work one domain at a time and verify tests pass after each.

### Task 9: Migrate HTTP middleware and error handler

**Files:**

- Modify: `apps/server/src/index.ts`
- Modify: `apps/server/src/logger.ts` (add sub-loggers)

- [ ] **Step 1: Create sub-loggers in server logger.ts**

Check `apps/server/src/logger.ts` — it currently exports a root `log`. If sub-loggers aren't created there, create them in `index.ts` where they're used. The HTTP middleware and error handler need an `httpLog`:

```typescript
const httpLog = log.get("http");
```

- [ ] **Step 2: Replace HTTP middleware opsLog call**

The middleware in `index.ts` (~line 301) currently calls `manager.getOpsLog().addEvent(...)`. Replace with:

```typescript
httpLog.info(`${c.req.method} ${requestPath} -> ${statusCode}`, {
  domain: "http",
  action: "http.request",
  status: statusCode >= 400 ? "failed" : "success",
  ...{ method: c.req.method, path: requestPath, statusCode, durationMs: Date.now() - startedAt },
  ...(requestTransport ? { requestTransport } : {}),
  ...requestPayloadMetadata,
  ...responsePayloadMetadata,
});
```

Use `httpLog.warn()` for 4xx and `httpLog.error()` for 5xx instead of always `httpLog.info()`:

```typescript
const logMethod = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
httpLog[logMethod](`${c.req.method} ${requestPath} -> ${statusCode}`, {
  domain: "http",
  action: "http.request",
  status: statusCode >= 400 ? "failed" : "success",
  method: c.req.method,
  path: requestPath,
  statusCode,
  durationMs: Date.now() - startedAt,
  ...(requestTransport ? { requestTransport } : {}),
  ...requestPayloadMetadata,
  ...responsePayloadMetadata,
});
```

- [ ] **Step 3: Replace error handler opsLog call**

The `app.onError` handler currently calls `manager.getOpsLog().addEvent(...)`. Replace with:

```typescript
httpLog.error(`${c.req.method} ${c.req.path} -> 500 ${err.message}`, {
  domain: "http",
  action: "http.error",
  method: c.req.method,
  path: c.req.path,
  statusCode: 500,
  error: err.message,
  stack: err.stack,
});
return c.json({ error: err.message, stack: err.stack }, 500);
```

- [ ] **Step 4: Replace TerminalManager callback opsLog call**

The TerminalManager callback in `index.ts` (~line 209) calls `manager.getOpsLog().addEvent(...)`. Replace with appropriate sub-logger call.

- [ ] **Step 5: Run tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

### Task 10: Migrate task, terminal, and worktree route handlers

**Files:**

- Modify: `apps/server/src/routes/tasks.ts` — replace `logTaskEvent` helper
- Modify: `apps/server/src/routes/terminal.ts` — replace `logTerminalEvent` helper
- Modify: `apps/server/src/routes/worktrees.ts` — replace direct opsLog call

- [ ] **Step 1: Migrate `logTaskEvent` in tasks.ts**

The `logTaskEvent` helper wraps `opsLog.addEvent()`. Replace its implementation to use a sub-logger:

```typescript
import { log } from "../logger";
const taskLog = log.get("task");
```

Then update `logTaskEvent` to call `taskLog.info()` / `taskLog.error()` with the same metadata.

- [ ] **Step 2: Migrate `logTerminalEvent` in terminal.ts**

Same pattern — create `termLog = log.get("terminal")`, update the helper.

- [ ] **Step 3: Migrate worktrees.ts direct call**

The single `opsLog.addEvent()` in worktrees.ts — replace with a sub-logger call.

- [ ] **Step 4: Run tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

### Task 11: Migrate manager.ts call sites

**Files:**

- Modify: `apps/server/src/manager.ts` — replace all `this.opsLog.addEvent()` calls

- [ ] **Step 1: Add sub-loggers to manager**

Import logger and create sub-loggers for the domains used:

```typescript
import { log } from "./logger";
const portLog = log.get("port");
const worktreeLog = log.get("worktree");
const linearLog = log.get("linear");
```

- [ ] **Step 2: Migrate port manager callback** (~line 279)

Replace `this.opsLog.addEvent({ source: "port", ... })` with `portLog` calls.

- [ ] **Step 3: Migrate worktree delete logging** (~lines 1447, 1464)

Replace the delete phase and completion `opsLog.addEvent()` calls with `worktreeLog` calls.

- [ ] **Step 4: Migrate Linear worktree creation** (~lines 2434, 2546)

Replace with `linearLog` calls.

- [ ] **Step 5: Run tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

### Task 12: Migrate CLI execution logging

**Files:**

- Modify: `apps/server/src/routes/claude-plugins.ts` — replace 3 opsLog calls

- [ ] **Step 1: Create sub-logger and migrate**

```typescript
import { log } from "../logger";
const cliLog = log.get("claude-cli");
```

Replace the 3 `opsLog.addEvent()` calls (start, completion, error at ~lines 485, 532, 559) with `cliLog.started()`, `cliLog.success()`, `cliLog.error()`.

- [ ] **Step 2: Run tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

### Task 13: Remove OpsLog convenience methods

**Files:**

- Modify: `apps/server/src/ops-log.ts` — remove `addCommandEvent`, `addFetchEvent`, `addNotificationEvent`

- [ ] **Step 1: Check callers of convenience methods**

```bash
grep -rn "addCommandEvent\|addFetchEvent\|addNotificationEvent" apps/server/src/
```

These are called from runtime monitors and the notification system. Replace those callers with logger calls first (using sub-loggers like `log.get("command")`, `log.get("http-client")`, `log.get("notification")`).

- [ ] **Step 2: Remove the convenience methods from OpsLog**

- [ ] **Step 3: Run all tests**

```bash
pnpm nx run server:test --skip-nx-cache
```

---

## Chunk 4: Verification

### Task 14: Full verification

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

- [ ] **Step 4: Manual smoke test**

Start the server, load the web app, check the ops-log file to verify entries have proper `action`, `status`, `source` fields instead of generic `action: "log"`.

```bash
pnpm nx run server:build --skip-nx-cache && node apps/server/dist/standalone.js
# In another terminal:
tail -f .openkit/ops-log.jsonl | jq .
# Load the web app and verify structured entries appear
```

---

### Task 15: Update documentation

**Files:**

- Modify: `CLAUDE.md` — update Logging section to mention `started()` and status convention
- Modify: `AGENTS.md` — mirror CLAUDE.md changes
- Modify: `docs/ARCHITECTURE.md` — update logging architecture description

- [ ] **Step 1: Update docs**

In the Logging section of `CLAUDE.md`/`AGENTS.md`, add:

- `log.started()` for operations that have a start/end lifecycle
- Document that `success()` and `started()` inject `status` automatically
- Note that structured ops-log events should use `action` in metadata
- Remove any references to direct `opsLog.addEvent()` as the recommended approach
