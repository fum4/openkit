#!/bin/bash
set -e

echo "Building Go shared library..."

OS=$(uname -s)

if [ "$OS" == "Linux" ]; then
    OUTPUT="liblogger.so"
elif [ "$OS" == "Darwin" ]; then
    OUTPUT="liblogger.dylib"
else
    echo "Unsupported OS: $OS"
    exit 1
fi

# Output to parent libs/logger/ directory so FFI adapters find it
go build -buildmode=c-shared -o "../$OUTPUT" .

echo "Built: ../$OUTPUT"
