# Centralized Logger Sink Design

**Date:** 2026-03-14
**Status:** Draft

## Problem

The logger has language bindings for Node (koffi FFI), Python (ctypes), Zig (dlopen), and a browser-only TS implementation. But the sink system (writing to ops-log so logs appear in the UI) is implemented only in the server's TypeScript layer. This means:

- Python services can't sink logs to the UI
- Zig code can't sink logs to the UI
- CLI logs don't appear in the UI
- The browser logger needs its own HTTP transport sink
- Each new language binding would need its own sink implementation

The whole point of the Go shared library is that it's the single implementation all languages call. The sink should live there too.

## Current Architecture

```
                        Go Logger (logger.go)
                        ├─ Level filtering
                        ├─ Formatting (DevFormatter: colored, ProdFormatter: JSON)
                        └─ fmt.Println → stdout
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
         Node (koffi)    Python (ctypes)  Zig (dlopen)
              │
              ▼
    TypeScript Logger (index.ts)
    ├─ Calls Go via FFI for stdout output
    ├─ console.* fallback when Go unavailable
    └─ LogSink dispatch (TS-only)
         └─ Server registers sink at startup
              └─ Writes to ops-log → UI

    Browser Logger (browser/src/index.ts)
    ├─ console.* output
    └─ HTTP transport sink → POST /api/client-logs → server → ops-log
```

**Problems with this:**

- The sink system is TypeScript-only — Python/Zig/CLI get no sink support
- The Go logger and TS sink process the same data independently (Go formats for stdout, TS re-extracts domain for the sink)
- Two separate Logger implementations (Node TS + Browser TS) that must stay in sync
- Browser needs stubs/hacks to avoid importing Node-only dependencies

## Proposed Architecture

```
Every process (server, CLI, Python, browser)
  → Go logger (native or WASM)
       ├─ stdout (formatted, colored)      ← terminal output
       └─ POST /api/client-logs            ← structured entry to server
            → server receives
                 → opsLog.addEvent()
                      → file (.openkit/ops-log.jsonl)
                      → real-time listeners → UI
```

**The server is the single ops-log writer.** Every process (including the server itself) POSTs log entries to the server endpoint. This means:

- No direct file writes from Go — no file locking or concurrent write concerns
- Real-time listeners always fire (entries go through `addEvent()`)
- Uniform code path — no conditional logic for "am I the server?"
- ~1ms localhost HTTP overhead per batch (entries are batched, not per-call)

### Go Changes

**New function: `LoggerSetSink`**

```go
//export LoggerSetSink
func LoggerSetSink(serverUrl, projectName *C.char)
```

Called once at process startup. Configures the Go logger to POST structured entries to the server's `/api/client-logs` endpoint.

**Updated `log()` method:**

```go
func (l *Logger) log(level, message string, context map[string]any) {
    if !l.shouldLog(level) {
        return
    }

    entry := LogEntry{...}

    // 1. Terminal output (existing)
    l.mu.Lock()
    fmt.Println(l.formatter.Format(entry))
    l.mu.Unlock()

    // 2. HTTP sink — POST to server (new)
    if sinkURL != "" {
        bufferEntry(entry)  // batched, flushed periodically
    }
}
```

**Batching strategy:** Entries are buffered in memory and flushed every ~1s or when the buffer exceeds 50 entries. A background goroutine handles the HTTP POST. Log calls never block on network I/O.

### Binding Changes

All bindings expose `setSink`:

**Node (`@openkit/logger`):**

```ts
static setSink(serverUrl: string, projectName: string): void
```

**Python:**

```python
Logger.set_sink(server_url: str, project_name: str) -> None
```

**Zig:**

```zig
pub fn setSink(server_url: [*:0]const u8, project_name: [*:0]const u8) void
```

### Server Changes

At startup, the server calls:

```ts
const serverUrl = `http://localhost:${actualPort}`;
Logger.setSink(serverUrl, projectName);
```

The existing TypeScript `Logger.addSink()` callback that writes to ops-log is **removed** — Go POSTs to the server endpoint, which calls `opsLog.addEvent()`.

### Consumer Setup

Any process that wants its logs to appear in the UI:

```python
# Python service
from logger import Logger
log = Logger("my-service")
Logger.set_sink("http://localhost:6969", "my-project")
log.info("Starting", domain="my-service")  # → stdout + POST to server → ops-log
```

```ts
// CLI command
const log = new Logger("cli");
Logger.setSink("http://localhost:6969", "my-project");
log.info("Running task", { domain: "cli" }); // → stdout + POST to server → ops-log
```

No per-language sink implementation needed. Call `setSink` and you're done.

## Browser: TinyGo WASM

The browser is the one environment where Go can't run natively. We compile the Go logger to WASM using TinyGo.

```
Browser
  └─ Go Logger (TinyGo WASM)
       ├─ Level filtering, formatting, entry construction (Go)
       ├─ JS callback → console.log (for devtools)
       └─ JS callback → POST /api/client-logs (for ops-log)
```

The WASM module exports the same functions as the C API (`LoggerNew`, `LoggerInfo`, etc.). JS provides host functions for console output and HTTP transport (since WASM can't access browser APIs directly).

**Why WASM over a separate TS implementation:**

- True single implementation — any Go logger changes automatically apply to the browser
- Zero risk of browser/native divergence
- Consistent with "Go is the source of truth" philosophy

**Overhead:**

- ~200-400KB WASM bundle (TinyGo), ~60-100KB gzipped
- ~10-50ms cold start on first log call
- Acceptable for a web app

### Conditional Compilation

The Go logger uses build tags for platform-specific behavior:

- `sink_native.go` (`//go:build !wasip1`) — HTTP POST via `net/http`
- `sink_wasm.go` (`//go:build wasip1`) — calls JS host function for transport
- `output_native.go` — `fmt.Println` to stdout
- `output_wasm.go` — calls JS host function for console output

## Migration Plan

### Phase 1: Go HTTP Sink

1. Add sink globals (`sinkURL`, `sinkProjectName`, entry buffer, flush goroutine)
2. Add `SetSink(serverUrl, projectName)` and `CloseSink()`
3. Add `bufferEntry()` and `flushSink()` (batched HTTP POST)
4. Update `log()` to call `bufferEntry` after stdout output
5. Add C exports in `cgo/exports.go`
6. Rebuild `liblogger.dylib`

### Phase 2: Update Bindings

1. Node: add `Logger.setSink(serverUrl, projectName)` via FFI
2. Python: add `Logger.set_sink(server_url, project_name)`
3. Zig: add `setSink(server_url, project_name)`
4. Update C header

### Phase 3: Server Integration

1. Server calls `Logger.setSink()` at startup
2. Remove TypeScript `Logger.addSink()` ops-log callback
3. Verify entries match existing ops-log format

### Phase 4: TinyGo WASM Browser Logger

1. Create `libs/logger/wasm/` — WASM build entry point
2. Conditional compilation: `sink_native.go` / `sink_wasm.go`, `output_native.go` / `output_wasm.go`
3. Build script: `tinygo build -o browser/src/logger.wasm -target=wasip1`
4. Create `libs/logger/browser/src/index.ts` — WASM loader + JS host functions
5. Update web-app Vite alias to browser logger
6. Update Nx build target

### Phase 5: Cleanup

1. Remove `.gitignore` in `logger/node/src/`
2. Remove `rm -f` cleanup from desktop-app build script
3. Remove TypeScript `normalizeContext` from Node logger (Go handles it)
4. Update CLAUDE.md / AGENTS.md / docs/ARCHITECTURE.md

## Open Questions

1. **`setSink` timing:** Log calls before `setSink` go to stdout only. This is fine — startup logs before the server URL is known don't need the ops-log.

2. **Server availability:** If the server isn't running when an external process calls `setSink`, the HTTP POSTs will fail silently (best-effort). Logs still go to stdout. When the server comes up, subsequent flushes succeed.

3. **Multiple projects:** The desktop app manages multiple projects, each with its own server. Each project's server has its own port and ops-log. External processes (CLI, Python) target a specific server URL, so they automatically log to the right project's ops-log.
