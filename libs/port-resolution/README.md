# Native Port Hook (`libs/port-resolution`)

Runtime-agnostic port offsetting via libc symbol interposition. This shared library intercepts `bind()` and `connect()` at the POSIX level, allowing OpenKit to transparently remap ports for **any runtime** -- Python, Ruby, Java, Go (on macOS), and others -- not just Node.js.

## How It Works

The library uses `LD_PRELOAD` (Linux) or `DYLD_INSERT_LIBRARIES` (macOS) to inject itself into a process at startup. It interposes two POSIX functions:

### `bind(fd, addr, addrlen)`

Intercepts server listen calls. When the target port is in the known ports set, the port is rewritten to `port + offset` in a copied `sockaddr`. Handles both `AF_INET` (IPv4) and `AF_INET6` (IPv6).

### `connect(fd, addr, addrlen)`

Intercepts outgoing connections. Same port check as `bind`, plus a **localhost-only guard**: only connections to `127.0.0.1`, `::1`, `0.0.0.0`, `::`, or IPv4-mapped `::ffff:127.0.0.1` are offset. Remote connections pass through unmodified.

### Initialization (constructor)

On library load, a constructor function:

1. Resolves the real `bind`/`connect` via `dlsym(RTLD_NEXT, ...)`
2. Reads `__WM_PORT_OFFSET__` and `__WM_KNOWN_PORTS__` from the environment
3. Parses the known ports JSON array minimally (scans for digit sequences between `[` and `]`)

## Environment Variables

| Variable             | Type       | Description                                                |
| -------------------- | ---------- | ---------------------------------------------------------- |
| `__WM_PORT_OFFSET__` | integer    | The offset to add to known ports (e.g. `10`)               |
| `__WM_KNOWN_PORTS__` | JSON array | Base ports to intercept (e.g. `[3000,4000]`)               |
| `__WM_DEBUG__`       | any        | If set, logs every intercepted bind/connect call to stderr |

## Building

Requires the [Zig](https://ziglang.org/) toolchain.

```bash
cd libs/port-resolution

# Build for current architecture (development)
zig build -Doptimize=ReleaseFast

# Output: zig-out/lib/libport-hook.dylib (macOS) or libport-hook.so (Linux)
```

### Cross-compilation

```bash
# macOS ARM64
zig build -Dtarget=aarch64-macos -Doptimize=ReleaseFast

# macOS x86_64
zig build -Dtarget=x86_64-macos -Doptimize=ReleaseFast

# Universal binary (macOS)
lipo -create zig-out-arm64/lib/libport-hook.dylib zig-out-x64/lib/libport-hook.dylib -output libport-hook.dylib
```

### Nx integration

```bash
pnpm nx run port-resolution:build
```

## Testing

See `test/smoke.sh` for manual smoke tests covering Python, Ruby, Go, and Node.js double-offset safety.

Quick manual test:

```bash
# Python: should listen on 8010 instead of 8000
DYLD_INSERT_LIBRARIES=./zig-out/lib/libport-hook.dylib \
  __WM_PORT_OFFSET__=10 \
  __WM_KNOWN_PORTS__='[8000]' \
  __WM_DEBUG__=1 \
  python3 -m http.server 8000
```

## Interaction with Node.js Hook

Both the native hook and the Node.js `port-hook.cjs` run simultaneously when a Node.js process is spawned. There is **no double-offset risk**:

1. The native hook intercepts the `bind()` syscall and rewrites port `3000` -> `3010`
2. The Node.js hook sees the `listen(3010)` call, checks if `3010` is in `knownPortSet`
3. Since `3010` is NOT in the known ports set (only `3000` is), the JS hook is a no-op

## Interaction with Env Mapping

The native hook and env mapping are **complementary systems** that solve different problems:

| System          | What it catches                          | Example                                     |
| --------------- | ---------------------------------------- | ------------------------------------------- |
| **Native hook** | Ports passed as integers to socket calls | `server.listen(3000)`, `http.server(8000)`  |
| **Env mapping** | Ports embedded in string-valued env vars | `DATABASE_URL=postgres://localhost:3000/db` |

Both are needed because the native hook cannot see ports embedded inside URL strings that are never passed directly to `connect()` as integer port numbers (e.g. `VITE_API_URL` rendered into HTML).

When both systems offset the same port (e.g. env mapping changes `DATABASE_URL` to use port `3010`, and the app calls `connect(3010)`), the native hook sees `3010` which is NOT in the known ports set, so it's a no-op. No double-offset.

## Limitations

- **macOS SIP**: System Integrity Protection prevents `DYLD_INSERT_LIBRARIES` from affecting system binaries (e.g. `/usr/bin/python3`). Use a user-installed Python/Ruby/etc.
- **Go on Linux**: Go's runtime makes raw syscalls instead of going through libc, so `LD_PRELOAD` interposition does not work. Go on macOS uses libc and works fine.
- **Zig toolchain required**: Building the native hook requires Zig to be installed. The hook is optional -- if the built library is not found, only the Node.js hook is used.
- **Maximum 64 known ports**: The hook supports up to 64 discovered ports. This is a compile-time limit in the static array.

## Runtime Compatibility Matrix

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
