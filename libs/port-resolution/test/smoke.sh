#!/usr/bin/env bash
# Manual smoke tests for the native port hook.
#
# Prerequisites:
#   cd libs/port-resolution && zig build -Doptimize=ReleaseFast
#
# Usage:
#   ./test/smoke.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
LIB_DIR="$SCRIPT_DIR/../zig-out/lib"

if [[ "$(uname)" == "Darwin" ]]; then
  DYLIB="$LIB_DIR/libport-hook.dylib"
  PRELOAD_VAR="DYLD_INSERT_LIBRARIES"
else
  DYLIB="$LIB_DIR/libport-hook.so"
  PRELOAD_VAR="LD_PRELOAD"
fi

if [[ ! -f "$DYLIB" ]]; then
  echo "ERROR: Native hook not found at $DYLIB"
  echo "Run: cd libs/port-resolution && zig build -Doptimize=ReleaseFast"
  exit 1
fi

echo "=== Native Port Hook Smoke Tests ==="
echo "Library: $DYLIB"
echo ""

# ── Test 1: Python HTTP server ─────────────────────────────────────────
echo "--- Test 1: Python http.server (port 8000 -> 8010) ---"
echo "Run manually:"
echo "  $PRELOAD_VAR=$DYLIB __WM_PORT_OFFSET__=10 __WM_KNOWN_PORTS__='[8000]' __WM_DEBUG__=1 python3 -m http.server 8000"
echo "  # Should listen on 8010 instead of 8000"
echo ""

# ── Test 2: Ruby TCP server ────────────────────────────────────────────
echo "--- Test 2: Ruby TCP server (port 3000 -> 3010) ---"
echo "Run manually:"
echo "  $PRELOAD_VAR=$DYLIB __WM_PORT_OFFSET__=10 __WM_KNOWN_PORTS__='[3000]' __WM_DEBUG__=1 ruby -e 'require \"socket\"; s=TCPServer.new(\"0.0.0.0\",3000); puts \"Listening on #{s.local_address.ip_port}\"; s.close'"
echo "  # Should print: Listening on 3010"
echo ""

# ── Test 3: Node.js (both hooks) ──────────────────────────────────────
echo "--- Test 3: Node.js double-offset safety ---"
echo "Run manually:"
echo "  $PRELOAD_VAR=$DYLIB __WM_PORT_OFFSET__=10 __WM_KNOWN_PORTS__='[3000]' __WM_DEBUG__=1 node -e 'require(\"net\").createServer().listen(3000, () => { const a = require(\"net\").createServer().address; console.log(\"done\"); process.exit(0); })'"
echo "  # Native hook rewrites 3000 -> 3010. Node hook sees 3010, not in known set, no-op."
echo ""

# ── Test 4: Go (macOS only) ───────────────────────────────────────────
if [[ "$(uname)" == "Darwin" ]]; then
  echo "--- Test 4: Go HTTP server (port 8080 -> 8090, macOS only) ---"
  echo "Run manually:"
  echo "  $PRELOAD_VAR=$DYLIB __WM_PORT_OFFSET__=10 __WM_KNOWN_PORTS__='[8080]' __WM_DEBUG__=1 go run -c 'package main; import (\"net/http\"; \"fmt\"); func main() { fmt.Println(http.ListenAndServe(\":8080\", nil)) }'"
  echo "  # Note: Go on macOS uses libc, so the hook works. Go on Linux uses raw syscalls — hook won't work."
  echo ""
fi

echo "=== End of smoke tests ==="
