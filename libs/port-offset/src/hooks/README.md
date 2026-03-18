# Port Interception Hooks

Two hooks intercept port bindings to transparently offset ports per worktree. Both read the same environment variables (`__WM_PORT_OFFSET__`, `__WM_KNOWN_PORTS__`, `__WM_DEBUG__`). When both are active (Node.js processes), there is no double-offset risk — see "Interaction" below.

| Variable             | Type       | Description                                                |
| -------------------- | ---------- | ---------------------------------------------------------- |
| `__WM_PORT_OFFSET__` | integer    | The offset to add to known ports (e.g. `10`)               |
| `__WM_KNOWN_PORTS__` | JSON array | Base ports to intercept (e.g. `[3000,4000]`)               |
| `__WM_DEBUG__`       | any        | If set, logs every intercepted bind/connect call to stderr |

## libc (preferred)

Zig-compiled `.dylib`/`.so` that intercepts `bind()` and `connect()` at the POSIX libc level via `DYLD_INSERT_LIBRARIES` (macOS) / `LD_PRELOAD` (Linux). Works for **any runtime** that uses libc: Node.js, Python, Ruby, Java, Rust, Deno, Bun. Go on macOS uses libc and works; Go on Linux makes raw syscalls and is not intercepted.

On macOS, `interpose.c` provides the `DYLD_INTERPOSE` table that maps `hooked_bind`/`hooked_connect` (Zig) to the real libc symbols.

### Building

```bash
cd libs/port-offset/hooks/libc && zig build -Doptimize=ReleaseFast
# or via Nx:
pnpm nx run port-offset:build
```

### Runtime Compatibility

| Runtime | macOS           | Linux           | Notes                                |
| ------- | --------------- | --------------- | ------------------------------------ |
| Node.js | Yes (+ JS hook) | Yes (+ JS hook) | Both hooks run, no double-offset     |
| Python  | Yes             | Yes             | Use non-system Python on macOS (SIP) |
| Ruby    | Yes             | Yes             | Use non-system Ruby on macOS (SIP)   |
| Java    | Yes             | Yes             | JVM uses libc for sockets            |
| Go      | Yes             | **No**          | Go on Linux uses raw syscalls        |
| Rust    | Yes             | Yes             | Uses libc by default                 |
| Deno    | Yes             | Yes             | Uses libc for network calls          |
| Bun     | Yes             | Yes             | Uses libc for network calls          |

### Limitations

- **macOS SIP** prevents injection into system binaries (`/usr/bin/python3`). Use user-installed runtimes.
- **Zig toolchain required** to build. The hook is optional — if not found, only the Node.js hook is used.
- **Maximum 64 known ports** (compile-time limit).

## node (fallback)

Pure CJS file loaded via `NODE_OPTIONS="--require ..."`. Patches `net.Server.prototype.listen` and `net.Socket.prototype.connect`. Only needed when the native hook is unavailable (Zig not installed, macOS SIP blocking system binaries). Zero dependencies — works with any Node.js version.

The Node.js hook handles three `connect()` calling conventions:

1. `connect(port, host, cb)` — port as number
2. `connect([options, cb])` — Node.js HTTP agent internal call (array wrapper)
3. `connect(options, cb)` — plain options object

## Interaction

Both hooks coexist safely in Node.js processes:

1. The native hook intercepts `bind()` and rewrites port `3000` → `3010`
2. The Node.js hook sees `listen(3010)`, checks if `3010` is in `knownPortSet`
3. Since `3010` is NOT in the known set (only `3000` is), the JS hook is a no-op

The native hook and env mapping are **complementary**: the native hook catches ports passed as integers to socket calls, while env mapping catches ports embedded in string-valued env vars (e.g. `DATABASE_URL`). No double-offset when both are active.
