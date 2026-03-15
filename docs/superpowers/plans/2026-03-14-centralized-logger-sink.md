# Centralized Logger Sink — Implementation Plan

**Spec:** `docs/superpowers/specs/2026-03-14-centralized-logger-sink-design.md`

## Prerequisites

- [x] Install TinyGo (`brew install tinygo-org/tools/tinygo`) — v0.40.1 installed

## Phase 1: Go HTTP Sink

All changes in `libs/logger/`.

### 1.1 Add sink to `logger.go`

Add module-level sink state:

```go
var (
    sinkURL         string
    sinkProjectName string
    sinkBuffer      []LogEntry
    sinkMu          sync.Mutex
    sinkTicker      *time.Ticker
    sinkDone        chan struct{}
)

const sinkFlushInterval = time.Second
const sinkMaxBuffer = 50
```

Add `SetSink(serverUrl, projectName string)`:

- Stores URL and project name
- Starts a background goroutine that flushes the buffer every `sinkFlushInterval`

Add `CloseSink()`:

- Flushes remaining buffer
- Stops the background goroutine

Add `bufferEntry(entry LogEntry)`:

- Appends to buffer under lock
- If buffer >= sinkMaxBuffer, flush immediately

Add `flushSink()`:

- Takes buffer snapshot under lock, clears buffer
- POSTs JSON to `{sinkURL}/api/client-logs` with `{ entries: [...] }`
- Best-effort — failures are logged to stderr, not fatal

### 1.2 Update `log()` method

After `fmt.Println(l.formatter.Format(entry))`, add:

```go
if sinkURL != "" {
    bufferEntry(entry)
}
```

Same for `Plain()`.

### 1.3 Add C exports to `cgo/exports.go`

```go
//export LoggerSetSink
func LoggerSetSink(serverUrl, projectName *C.char) {
    logger.SetSink(C.GoString(serverUrl), C.GoString(projectName))
}

//export LoggerCloseSink
func LoggerCloseSink() {
    logger.CloseSink()
}
```

### 1.4 Build and test

```bash
cd libs/logger/cgo && ./build.sh
```

Verify `LoggerSetSink` and `LoggerCloseSink` appear in `liblogger.h`.

## Phase 2: Update Language Bindings

### 2.1 Node (`libs/logger/node/src/`)

**bindings.ts:** Add `LoggerSetSink` and `LoggerCloseSink` to the interface and `loadNative()`.

**index.ts:** Add static methods:

```ts
static setSink(serverUrl: string, projectName: string): void {
    const bindings = getBindings();
    bindings.LoggerSetSink(serverUrl, projectName);
}

static closeSink(): void {
    const bindings = getBindings();
    bindings.LoggerCloseSink();
}
```

### 2.2 Python (`libs/logger/python/`)

**bindings.py:** Add `LoggerSetSink(c_char_p, c_char_p)` and `LoggerCloseSink()`.

**logger.py:**

```python
@staticmethod
def set_sink(server_url: str, project_name: str) -> None:
    lib.LoggerSetSink(server_url.encode("utf-8"), project_name.encode("utf-8"))

@staticmethod
def close_sink() -> None:
    lib.LoggerCloseSink()
```

### 2.3 Zig (`libs/logger/zig/logger.zig`)

Add `LoggerSetSink` and `LoggerCloseSink` to symbols and expose as `setSink`/`closeSink`.

## Phase 3: Server Integration

**File:** `apps/server/src/index.ts`

At startup (after the server port is known):

```ts
Logger.setSink(`http://localhost:${actualPort}`, manager.getProjectName() ?? "unknown");
```

Remove the existing `Logger.addSink(...)` callback that writes to ops-log (lines ~498-511).

On shutdown:

```ts
Logger.closeSink();
```

The `POST /api/client-logs` endpoint (already exists in `routes/logs.ts`) handles receiving entries and calling `opsLog.addEvent()`.

## Phase 4: TinyGo WASM Browser Logger

### 4.1 Conditional compilation — split platform-specific code

**`libs/logger/output_native.go`** (`//go:build !wasip1`):

```go
func output(formatter Formatter, entry LogEntry) {
    fmt.Println(formatter.Format(entry))
}
```

**`libs/logger/output_wasm.go`** (`//go:build wasip1`):

```go
//go:wasmimport env consoleLog
func jsConsoleLog(level, message, context *byte, levelLen, msgLen, ctxLen uint32)

func output(formatter Formatter, entry LogEntry) {
    // Call JS host function for console output
}
```

**`libs/logger/sink_native.go`** (`//go:build !wasip1`):

- HTTP POST implementation using `net/http`
- Background goroutine for batched flushing

**`libs/logger/sink_wasm.go`** (`//go:build wasip1`):

```go
//go:wasmimport env sinkDispatch
func jsSinkDispatch(json *byte, jsonLen uint32)

func flushSink() {
    // Serialize entries and call JS host function
}
```

### 4.2 WASM build entry point

**`libs/logger/wasm/main.go`:**

Exports logger functions using `//go:wasmexport`:

- `LoggerNew`, `LoggerInfo`, `LoggerWarn`, `LoggerError`, `LoggerDebug`
- `LoggerSuccess`, `LoggerPlain`, `LoggerFree`
- `LoggerSetSink`, `LoggerCloseSink`

### 4.3 Build script

**`libs/logger/wasm/build.sh`:**

```bash
#!/bin/bash
set -e
tinygo build -o ../browser/src/logger.wasm -target=wasip1 -no-debug -opt=2 .
echo "Built: ../browser/src/logger.wasm"
```

### 4.4 Browser TS bindings (WASM loader)

**`libs/logger/browser/src/index.ts`:**

Replaces the current pure-TS Logger. Loads the WASM module and provides:

- JS host functions: `consoleLog(level, message, context)`, `sinkDispatch(entriesJSON)`
- The `sinkDispatch` host function batches entries and POSTs to `/api/client-logs`
- Exported `Logger` class wraps the WASM function calls
- Same public API: `new Logger(system)`, `log.info(msg, context)`, `Logger.setSink(url, project)`

### 4.5 Update Nx build target

**`libs/logger/project.json`:**

```json
"commands": [
    "cd cgo && ./build.sh",
    "cd wasm && ./build.sh"
]
```

### 4.6 Update web-app config

**`apps/web-app/vite.config.ts`:** Alias `@openkit/logger` → `libs/logger/browser/src/index.ts`

**`apps/web-app/tsconfig.json`:** Path alias → browser logger

Remove koffi stubs, `optimizeDeps.exclude`, and other Node-module workarounds from Vite config.

## Phase 5: Cleanup

1. Remove `libs/logger/node/src/.gitignore`
2. Remove `rm -f ../../libs/logger/node/src/*.js ...` from desktop-app build script
3. Remove TypeScript `normalizeContext` from Node logger (Go normalizes before sending)
4. Remove TypeScript `LogSink` ops-log callback from server startup
5. Update CLAUDE.md / AGENTS.md with new architecture
6. Update docs/ARCHITECTURE.md

## Build Order

```
Phase 1 (Go sink)
  ├─ Phase 2 (bindings) — after Go build succeeds
  ├─ Phase 3 (server integration) — after Phase 2 Node bindings
  └─ Phase 4 (WASM) — after Phase 1 (needs conditional compilation)
       └─ Phase 5 (cleanup) — after everything works
```

Phases 2.1, 2.2, 2.3 are independent (parallel).
Phase 3 depends on Phase 2.1 (Node bindings).
Phase 4 can start after Phase 1 since it shares the Go source.
