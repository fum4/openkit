# Unified Logger Design

**Date:** 2026-03-17
**Status:** Draft

## Problem

The server has two parallel logging systems: the Go-based logger (`log.*()`) and direct `opsLog.addEvent()` calls. The logger produces generic `action: "log"` entries. Structured operational events (HTTP requests, command executions, task operations) bypass the logger entirely and call `opsLog.addEvent()` directly — 20+ call sites across routes and managers.

This means:

- Only the server can produce structured ops-log events (other apps/libs can't)
- Operational events don't go through the logger pipeline (no console output, no level filtering)
- Two APIs to learn, two code paths to maintain
- Error events logged via `opsLog.addEvent()` get no console output unless a redundant `log.error()` is also called

## Solution

Make the logger the single API for all operational logging. Replace all direct `opsLog.addEvent()` calls with `log.*()` calls carrying structured metadata. The Go logger transports entries to the server, which extracts well-known fields and writes to the ops-log.

ActivityLog (user-facing activity feed) is NOT affected — it stays separate.

## Logger API

### Sub-loggers for source

Each file creates a sub-logger scoped to its feature area:

```typescript
// apps/server/src/logger.ts — unchanged, creates root logger
const log = new Logger("server");

// In route handlers:
const httpLog = log.get("http"); // source: "server.http"
const taskLog = log.get("task"); // source: "server.task"
const termLog = log.get("terminal"); // source: "server.terminal"
```

The `system.subsystem` from the logger maps to `source` in the ops-log. This is the existing `Logger.get()` API — no changes needed.

### Convenience methods

Each method sets `level` and a default `status`. The default status can be overridden via metadata.

```typescript
// level: debug,  status: info
httpLog.debug(msg, meta?)

// level: info,   status: info
httpLog.info(msg, meta?)

// level: info,   status: started     [NEW]
httpLog.started(msg, meta?)

// level: info,   status: success
httpLog.success(msg, meta?)

// level: warn,   status: info
httpLog.warn(msg, meta?)

// level: error,  status: failed
httpLog.error(msg, meta?)

// level: info,   status: info  (no formatting prefix)
httpLog.plain(msg, meta?)
```

### Structured operational events

Pass well-known keys in metadata for rich ops-log entries:

```typescript
// HTTP request logging
httpLog.info("GET /api/config -> 200", {
  action: "http.request",
  status: "success",
  method: "GET",
  path: "/api/config",
  statusCode: 200,
  durationMs: 12,
});

// Command execution
cliLog.started("Starting: git status", {
  action: "command.exec",
  runId: "abc-123",
  command: { command: "git", args: ["status"], cwd: "/project" },
});

cliLog.success("Succeeded: git status (8ms)", {
  action: "command.exec",
  runId: "abc-123",
  command: { command: "git", args: ["status"], cwd: "/project", durationMs: 8, exitCode: 0 },
});

// Error with full context
httpLog.error("GET /api/foo -> 500 Something broke", {
  action: "http.error",
  method: "GET",
  path: "/api/foo",
  statusCode: 500,
  stack: err.stack,
});
```

## Well-known metadata keys

These keys are extracted from metadata into top-level ops-log fields by the server endpoint. Everything else stays in `metadata`.

| Key           | Ops-log field | Default                                       |
| ------------- | ------------- | --------------------------------------------- |
| `action`      | `action`      | `"log"`                                       |
| `status`      | `status`      | Derived from method (see convenience methods) |
| `worktreeId`  | `worktreeId`  | —                                             |
| `projectName` | `projectName` | From sink config                              |
| `runId`       | `runId`       | —                                             |

The `source` field is derived from the logger's `system.subsystem`, not from metadata.

## Transport

```
Any process (server, CLI, Python, browser)
  → log.info("msg", { action: "http.request", ... })
      → Go logger
           ├─ stdout (formatted, colored)
           └─ POST /api/client-logs (batched)
                → server endpoint
                     → extract well-known keys from metadata
                     → opsLog.addEvent({ source, action, level, status, message, ... })
                          → file (.openkit/ops-log.jsonl)
                          → real-time listeners → UI
```

The Go logger is a dumb transport — it passes metadata through faithfully. The server endpoint is the single place where well-known keys are extracted and the ops-log schema is enforced.

## Changes required

### 1. Go logger (`libs/logger/cgo/`)

Add `started()` convenience method:

- New exported function: `LoggerStarted(handle, message, context)`
- Internally calls `log()` with level `"info"` and injects `status: "started"` into the context
- The `success()` method should similarly inject `status: "success"` into the context (currently it doesn't)

Add `status` to the transport payload:

- When `status` is present in the context/metadata, include it in the batched POST payload
- The Go sink already sends `metadata` — `status` travels as part of it, extracted server-side

### 2. Node bindings (`libs/logger/node/src/`)

Add `started()` method to the `Logger` class:

```typescript
// Convenience: level info, status started
started(message: string, context?: LogContext): void {
  this.info(message, { ...context, status: "started" });
}
```

Update `success()` to inject status:

```typescript
success(message: string, context?: LogContext): void {
  // existing Go call + console fallback
  this.dispatch("info", message, { ...context, status: "success" });
}
```

Document level/status mapping with comments on each method.

### 3. Python bindings (`libs/logger/python/`)

Add `started()` method to the Python `Logger` class. Same pattern — calls `info()` with `status: "started"` injected.

### 4. Zig bindings (`libs/logger/zig/`)

Add `started()` function. Calls `info()` with status metadata.

### 5. Browser logger (`libs/logger/browser/src/`)

Add `started()` method. Same pattern as Node.

### 6. `/api/client-logs` endpoint (`apps/server/src/routes/logs.ts`)

Update the entry processing to extract well-known keys:

```typescript
// Before: all metadata dumped as-is
const metadata = { ...entry.metadata };
if (entry.domain) metadata.domain = entry.domain;

// After: extract well-known keys into top-level fields
const {
  action,
  status,
  worktreeId,
  projectName: metaProjectName,
  runId,
  ...rest
} = entry.metadata ?? {};
const cleanMetadata = { ...rest };
if (entry.domain) cleanMetadata.domain = entry.domain;

opsLog.addEvent({
  source: entry.subsystem ? `${entry.system}.${entry.subsystem}` : entry.system,
  action: typeof action === "string" ? action : "log",
  message: entry.message,
  level: entry.level === "warn" ? "warning" : (entry.level as OpsLogLevel),
  status:
    typeof status === "string"
      ? (status as OpsLogStatus)
      : entry.level === "error"
        ? "failed"
        : "info",
  worktreeId: typeof worktreeId === "string" ? worktreeId : undefined,
  projectName:
    typeof metaProjectName === "string" ? metaProjectName : (manager.getProjectName() ?? undefined),
  runId: typeof runId === "string" ? runId : undefined,
  metadata: Object.keys(cleanMetadata).length > 0 ? cleanMetadata : undefined,
});
```

### 7. Server code — replace all `opsLog.addEvent()` calls

Each of the 20+ direct `opsLog.addEvent()` call sites in `apps/server/src/` gets replaced with a `log.*()` call using the appropriate sub-logger and metadata.

**HTTP middleware** (`index.ts`):

```typescript
// Before:
manager.getOpsLog().addEvent({ source: "http", action: "http.request", ... });

// After:
httpLog.info(`${method} ${path} -> ${statusCode}`, {
  action: "http.request",
  status: statusCode >= 400 ? "failed" : "success",
  method, path, statusCode, durationMs,
  ...requestPayloadMetadata,
  ...responsePayloadMetadata,
});
```

**Error handler** (`index.ts`):

```typescript
// Before:
manager.getOpsLog().addEvent({ source: "http", action: "http.error", ... });

// After:
httpLog.error(`${method} ${path} -> 500 ${err.message}`, {
  action: "http.error",
  method, path, statusCode: 500,
  stack: err.stack,
});
```

**Route handlers** — same pattern. Replace `logTaskEvent()`, `logTerminalEvent()`, and direct `addEvent()` calls with sub-logger calls.

**OpsLog convenience methods** (`addCommandEvent`, `addFetchEvent`, `addNotificationEvent`) — replace callers with logger calls. These methods can then be removed from `OpsLog`.

### 8. OpsLog class cleanup

After migration:

- Remove `addCommandEvent()`, `addFetchEvent()`, `addNotificationEvent()` convenience methods
- `addEvent()` stays — it's called by the `/api/client-logs` endpoint (the single writer)
- The class becomes a storage/query layer only, not a logging API

## What doesn't change

- **ActivityLog** — separate system, untouched
- **Ops-log file format** — same JSONL, same fields, same schema
- **UI that reads ops-log events** — no changes needed
- **Go logger internals** — formatting, level filtering, batching all unchanged
- **Logger constructor/sink API** — `new Logger()`, `Logger.setSink()` unchanged
- **`/api/logs` POST endpoint** — stays for backward compat (external callers)

## Migration strategy

1. Add `started()` to all bindings (Go, Node, Python, Zig, browser)
2. Update `success()` to inject `status: "success"` in all bindings
3. Update `/api/client-logs` to extract well-known keys
4. Migrate server call sites one domain at a time (HTTP → commands → tasks → terminal → worktrees → ports)
5. Remove OpsLog convenience methods after all callers are migrated
6. Verify ops-log output is identical before/after for each domain
