# libs/logger

A Go-based structured logging library compiled as a C-shared library (`liblogger.dylib`/`.so`) with FFI bindings for TypeScript (koffi), Python (ctypes), and Zig (dlopen).

## How it works

**Go is the single source of truth.** All logging functionality — level filtering, formatting, output — is implemented in Go and compiled to a C-shared library (`liblogger.dylib`/`.so`). Each language binding is a thin FFI wrapper that calls into the compiled Go binary. When adding new log methods or features, implement them in Go first, then expose through all language bindings.

```
┌──────────────────────────────────────────┐
│           Go core (logger.go)            │
│  Level filtering, formatting, output     │
│           ↓ cgo build ↓                  │
│     liblogger.dylib / liblogger.so       │
│           (flat C API)                   │
└──────┬──────────┬──────────┬─────────────┘
       │          │          │
   ┌───┴───┐  ┌──┴─────┐  ┌──┴───┐
   │ Node  │  │ Python │  │  Zig │
   │ koffi │  │ ctypes │  │dlopen│
   └───────┘  └────────┘  └──────┘
```

## Architecture

```
libs/logger/
├── logger.go        # Go core — Logger struct, level filtering, auto-detect system
├── formatter.go     # Dev (colored terminal) and Prod (JSON) formatters
├── colors.go        # ANSI color constants and level/system color maps
├── go.mod           # module github.com/fum4/openkit/libs/logger
├── cgo/             # C-shared library build (package main)
│   ├── exports.go   # cgo exports wrapping package logger
│   ├── build.sh     # Build script → liblogger.dylib / liblogger.so
│   └── go.mod
├── node/            # Node.js bindings (koffi FFI)
│   └── src/
│       ├── bindings.ts  # Dynamic koffi loading with console fallback
│       ├── index.ts     # Logger class + sink dispatch
│       └── types.ts     # LogLevel, LogFormat, LogContext types
├── python/          # Python bindings (ctypes)
│   ├── bindings.py  # ctypes function signatures
│   └── logger.py    # Logger class
├── zig/             # Zig bindings (dlopen at runtime)
│   └── logger.zig   # Logger struct with dlopen fallback
└── project.json     # Nx project config
```

Go files live at the root because Go is the source language — everything else derives from it. The root is `package logger`, directly importable by Go applications. The `cgo/` subdirectory is `package main` — it wraps the logger package into cgo exports and compiles to the C-shared library used by all FFI bindings.

## Building

Requires **Go >= 1.23**.

```bash
cd libs/logger/cgo && ./build.sh
```

This produces `liblogger.dylib` (macOS) or `liblogger.so` (Linux) in the `libs/logger/` directory.

Or via Nx:

```bash
pnpm nx run logger:build
```

This builds both the Go shared library and the Node.js bindings.

## C API

The Go core exports a flat C API. All language bindings call these functions:

```c
int  LoggerNew(char* system, char* subsystem, char* level, char* format);
void LoggerInfo(int id, char* message, char* contextJSON);
void LoggerWarn(int id, char* message, char* contextJSON);
void LoggerError(int id, char* message, char* contextJSON);
void LoggerDebug(int id, char* message, char* contextJSON);
void LoggerSuccess(int id, char* message, char* contextJSON);
void LoggerPlain(int id, char* message, char* contextJSON);
void LoggerFree(int id);
```

### LoggerNew

Creates a logger instance. Returns an integer handle for subsequent calls.

- **system**: Service/app name (e.g. `"server"`, `"cli"`). Auto-detected from cwd if empty.
- **subsystem**: Optional sub-component (e.g. `"port-manager"`, `"nats"`). Pass `""` for none.
- **level**: Minimum log level — `"debug"`, `"info"`, `"warn"`, `"error"`. Falls back to `LOG_LEVEL` env var, then `"info"`.
- **format**: `"dev"` (colored terminal) or `"prod"` (JSON). Falls back to `NODE_ENV=production` → `"prod"`, else `"dev"`.

### Log methods

| Method          | Level | Output                                                  |
| --------------- | ----- | ------------------------------------------------------- |
| `LoggerDebug`   | DEBUG | Gray text, filtered by level                            |
| `LoggerInfo`    | INFO  | Standard structured output                              |
| `LoggerWarn`    | WARN  | Yellow highlighted                                      |
| `LoggerError`   | ERROR | Red highlighted                                         |
| `LoggerSuccess` | INFO  | Green `●` prefix, INFO-level filtering                  |
| `LoggerPlain`   | —     | Raw message, no prefix/color/timestamp. Always outputs. |

All methods take `(handle, message, contextJSON)`. Context is JSON-encoded key-value pairs (pass `""` or `"{}"` for none).

### LoggerFree

Removes the logger instance from the Go runtime registry.

## Adding new functionality

1. Implement in Go (`logger.go` for methods, `formatter.go` for output, `colors.go` for colors)
2. Add cgo export in `cgo/exports.go`
3. Rebuild: `cd cgo && ./build.sh`
4. Update ALL language bindings:
   - `node/src/bindings.ts` — add FFI binding
   - `node/src/index.ts` — add method to Logger class
   - `python/bindings.py` — add ctypes signature
   - `python/logger.py` — add method to Logger class
   - `zig/logger.zig` — add symbol to Symbols struct + method to Logger

## Configuration

| Environment Variable | Effect                                                                           |
| -------------------- | -------------------------------------------------------------------------------- |
| `LOG_LEVEL`          | Default level when none is passed to `LoggerNew` (`debug`/`info`/`warn`/`error`) |
| `NODE_ENV`           | When `production`, defaults format to `prod` (JSON output)                       |

## Output Examples

### Dev format

```
14:32:45.123 | SERVER | INFO  |  port discovery completed {"ports":[3000,4000]}
14:32:45.456 | SERVER | INFO  | PORT-MANAGER | allocating offset {"offset":10}
14:32:45.789 | SERVER | INFO  | ● Project initialized
```

Colored output: timestamps in gray, system name in bold blue, level color-coded (green=INFO, yellow=WARN, red=ERROR, gray=DEBUG), context in gray. Success messages get a green `●` prefix.

### Prod format (JSON)

```json
{
  "timestamp": "2025-03-12T14:32:45.123Z",
  "system": "server",
  "level": "info",
  "message": "port discovery completed",
  "ports": [3000, 4000]
}
```

## Language Usage

### Go

The package is directly importable by any Go application:

```go
import logger "github.com/fum4/openkit/libs/logger"

log := logger.NewLogger("my-service", "", "info", "dev")
log.Info("started", map[string]any{"port": 8080})
log.Success("ready", nil)
log.Plain("usage: my-service [flags]", nil)

// Subsystem loggers are just new instances
dbLog := logger.NewLogger("my-service", "db", "debug", "dev")
dbLog.Debug("query executed", map[string]any{"duration_ms": 42})
```

### TypeScript

```typescript
import { Logger } from "@openkit/logger";

const log = new Logger("server");
log.info("started", { port: 6969 });
log.success("ready");
log.plain("Available commands: init, add, task");
log.get("port-manager").debug("allocating offset", { offset: 10 });
```

The Node bindings load koffi dynamically — if koffi or the Go library isn't available, log calls fall back to `console.*`. This allows the logger to work in environments like Vitest where native FFI isn't loaded.

### Sinks (TypeScript only)

The Node bindings support sinks — callbacks that receive every log entry. This is a bindings-level concern (not in Go) because sinks are host-language callbacks (e.g. routing to OpsLog):

```typescript
import { Logger, type LogEntry } from "@openkit/logger";

Logger.addSink((entry: LogEntry) => {
  opsLog.addEvent({ source: entry.system, message: entry.message });
});
```

### Python

```python
from logger import Logger

log = Logger("server")
log.info("started", port=6969)
log.success("ready")
log.plain("Available commands: init, add, task")
```

### Zig

```zig
const logger = @import("logger");

var log = logger.Logger.init("port-hook", "", "debug", "dev");
defer log.deinit();

log.info("bind intercepted", "{\"port\":3000,\"newPort\":3010}");
log.success("ready", "{}");
log.plain("hook loaded", "{}");
```

The Zig bindings use `dlopen` at runtime — if `liblogger.dylib`/`.so` is not found, all log calls become no-ops. This makes it safe for `DYLD_INSERT_LIBRARIES` contexts where the Go runtime may not be desirable.
