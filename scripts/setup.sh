#!/usr/bin/env sh

set -eu

if [ ! -f ".env.example" ]; then
  echo "Missing .env.example; cannot create .env.local." >&2
  exit 1
fi

if [ -f ".env.local" ]; then
  echo "No changes to the environment were made. Everything is already up to date."
  exit 0
fi

cp ".env.example" ".env.local"
echo "Created .env.local from .env.example."
