# @openkit/port-offset

Port offset system for running multiple dev server instances simultaneously. Transparently offsets ports per worktree using two complementary hooks and an adapter pattern for framework-specific behavior.

## Architecture

- **`src/`** — TypeScript infrastructure: offset allocation, env mapping, port discovery, hook resolution, env building, and the PortManager facade
- **`src/adapters/`** — Framework adapters (React Native, Expo, generic) with a shared abstract base class
- **`hooks/libc/`** — Zig-compiled native hook that intercepts `bind()`/`connect()` at the POSIX level via `DYLD_INSERT_LIBRARIES`/`LD_PRELOAD`
- **`hooks/node/`** — TypeScript Node.js hook (compiled to CJS) that patches `net.Server.listen`/`net.Socket.connect` via `--require`

## Building

```bash
pnpm nx run port-offset:build
```

This runs both hooks in parallel:

- **Node hook**: `tsup` compiles `hooks/node/port-hook.ts` → `hooks/node/dist/port-hook.cjs`
- **Native hook**: `zig build` compiles `hooks/libc/` → `hooks/libc/zig-out/lib/libport-hook.{dylib,so}`

## Testing

```bash
pnpm nx run port-offset:test
```
