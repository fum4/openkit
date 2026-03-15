#!/bin/bash
set -e

echo "Building WASM logger..."

tinygo build -o ../browser/src/logger.wasm -target=wasm -no-debug -opt=2 .

# Copy TinyGo's wasm_exec.js shim (needed to load the WASM module in browsers)
TINYGOROOT=$(tinygo env TINYGOROOT)
cp "$TINYGOROOT/targets/wasm_exec.js" ../browser/src/wasm_exec.js

echo "Built: ../browser/src/logger.wasm"
echo "Copied: ../browser/src/wasm_exec.js"
