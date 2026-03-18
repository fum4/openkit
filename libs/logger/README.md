# @openkit/logger

Go-based structured logging library with FFI bindings for Node.js (koffi), Browser (WASM), Python (ctypes), and Zig (dlopen).

## How it works

**Go is the single source of truth.** All logging — level filtering, formatting, output — is implemented in Go. Each language binding is a thin FFI wrapper that calls into the compiled Go binary.

```
┌──────────────────────────────────────────┐
│           Go core (src/*.go)             │
│  Level filtering, formatting, output     │
│                                          │
│  targets/cgo → liblogger.dylib/.so       │
│  targets/wasm → logger.wasm             │
└──────┬───────────┬──────────┬────────────┘
       │           │          │
   ┌───┴────┐  ┌───┴───┐  ┌──┴───┐  ┌────────┐
   │ Node   │  │Browser│  │  Zig │  │ Python │
   │ koffi  │  │ WASM  │  │dlopen│  │ ctypes │
   └────────┘  └───────┘  └──────┘  └────────┘
```

## Structure

```
libs/logger/
  src/
    *.go, go.mod              # Go source — logger, formatter, colors, sink
    console.go / _wasm.go     # Platform-specific console output
    transport.go / _wasm.go   # Platform-specific HTTP transport (sink)
    targets/
      cgo/                    # Builds → dist/liblogger.{dylib,so,h}
      wasm/                   # Builds → dist/logger.wasm, wasm_exec.js
    bindings/
      ts_utils.ts             # Shared TS base class (Logger, types)
      node/                   # Node.js — bindings.ts (koffi) + logger.ts
      browser/                # Browser — bindings.ts (WASM) + logger.ts
      python/                 # Python — bindings.py (ctypes) + logger.py
      zig/                    # Zig — bindings.zig (dlopen) + logger.zig
  dist/                       # Build artifacts (gitignored)
```

## Building

Requires **Go >= 1.23**.

```bash
pnpm nx run logger:build    # Builds both CGo shared lib and WASM
```

## C API

All language bindings call these exported functions:

| Function          | Signature                                 | Description               |
| ----------------- | ----------------------------------------- | ------------------------- |
| `LoggerNew`       | `(system, subsystem, level, format) → id` | Create logger instance    |
| `LoggerInfo`      | `(id, message, contextJSON)`              | Log at INFO level         |
| `LoggerWarn`      | `(id, message, contextJSON)`              | Log at WARN level         |
| `LoggerError`     | `(id, message, contextJSON)`              | Log at ERROR level        |
| `LoggerDebug`     | `(id, message, contextJSON)`              | Log at DEBUG level        |
| `LoggerSuccess`   | `(id, message, contextJSON)`              | INFO with green prefix    |
| `LoggerStarted`   | `(id, message, contextJSON)`              | INFO with started status  |
| `LoggerPlain`     | `(id, message, contextJSON)`              | Raw output, no formatting |
| `LoggerFree`      | `(id)`                                    | Release logger instance   |
| `LoggerSetSink`   | `(serverUrl, projectName)`                | Configure HTTP log sink   |
| `LoggerCloseSink` | `()`                                      | Flush and stop sink       |

## Adding new functionality

1. Implement in Go (`src/logger.go`, `src/formatter.go`, `src/colors.go`)
2. Add CGo export in `src/targets/cgo/exports.go`
3. Rebuild: `pnpm nx run logger:build`
4. Update all bindings:
   - `src/bindings/node/bindings.ts` + `logger.ts`
   - `src/bindings/browser/bindings.ts` + `logger.ts`
   - `src/bindings/python/bindings.py` + `logger.py`
   - `src/bindings/zig/bindings.zig` + `logger.zig`
   - `src/bindings/ts_utils.ts` (if adding to the shared TS interface)
