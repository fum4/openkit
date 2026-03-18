#!/bin/bash
set -e

echo "Building WASM logger..."

DIST_DIR="../../../dist"
mkdir -p "$DIST_DIR"

tinygo build -o "$DIST_DIR/logger.wasm" -target=wasm -no-debug -opt=2 .

# Copy TinyGo's wasm_exec.js shim (needed to load the WASM module in browsers)
TINYGOROOT=$(tinygo env TINYGOROOT)
cp "$TINYGOROOT/targets/wasm_exec.js" "$DIST_DIR/wasm_exec.js"

echo "Built: $DIST_DIR/logger.wasm"
echo "Copied: $DIST_DIR/wasm_exec.js"
