#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
OUTPUT_FILE="$SCRIPT_DIR/claude-credentials.json"

# Pre-flight checks
if ! command -v docker &>/dev/null; then
  echo "ERROR: Docker is required but not installed."
  exit 1
fi

if ! command -v gh &>/dev/null; then
  echo "ERROR: GitHub CLI (gh) is required but not installed."
  echo "Install it from https://cli.github.com/"
  exit 1
fi

if ! gh auth status &>/dev/null; then
  echo "ERROR: GitHub CLI is not authenticated."
  echo "Run 'gh auth login' first."
  exit 1
fi

REPO_NAME="$(cd "$REPO_ROOT" && gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null)" || true
if [ -z "$REPO_NAME" ]; then
  echo "ERROR: Could not determine GitHub repository."
  echo "Make sure this repo has a GitHub remote and 'gh' can access it."
  exit 1
fi

echo "Building Claude Code Docker image..."
docker build -t claude-auth "$SCRIPT_DIR"

echo ""
echo "Starting Claude login..."
echo "A URL will appear — open it in your browser to authenticate."
echo ""

# Run interactive login, mount a volume to extract credentials after
docker run -it --rm \
  -v claude-auth-data:/root \
  claude-auth login

# Extract the credentials file from the volume
docker run --rm \
  -v claude-auth-data:/root \
  -v "$SCRIPT_DIR":/out \
  node:22-slim \
  sh -c 'cp /root/.claude.json /out/claude-credentials.json 2>/dev/null || echo "No credentials file found at ~/.claude.json"'

# Clean up the volume
docker volume rm claude-auth-data 2>/dev/null || true

if [ ! -f "$OUTPUT_FILE" ]; then
  echo ""
  echo "ERROR: Failed to extract credentials."
  echo "The OAuth token may be stored differently. Check ~/.claude.json inside the container."
  exit 1
fi

echo ""
echo "Credentials extracted successfully."
echo "Updating CLAUDE_AUTH_JSON secret on $REPO_NAME..."

gh secret set CLAUDE_AUTH_JSON --repo "$REPO_NAME" < "$OUTPUT_FILE"

# Clean up local credentials file
rm -f "$OUTPUT_FILE"

echo "Done — CLAUDE_AUTH_JSON secret updated on $REPO_NAME. Local credentials removed."
