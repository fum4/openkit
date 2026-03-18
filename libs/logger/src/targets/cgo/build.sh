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

mkdir -p ../../../dist
go build -buildmode=c-shared -o "../../../dist/$OUTPUT" .

echo "Built: ../../../dist/$OUTPUT"
