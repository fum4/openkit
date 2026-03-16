#!/usr/bin/env bash

set -eu

# ── Colors ──────────────────────────────────────────────────────────────────

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

# ── Helpers ─────────────────────────────────────────────────────────────────

info()    { printf "${CYAN}▸${RESET} %s\n" "$1"; }
success() { printf "${GREEN}●${RESET} %s\n" "$1"; }
warn()    { printf "${YELLOW}!${RESET} %s\n" "$1"; }
error()   { printf "${RED}✖${RESET} %s\n" "$1" >&2; }

has_cmd() { command -v "$1" >/dev/null 2>&1; }

# ── Dependency checks ──────────────────────────────────────────────────────

DEPS="node pnpm go tinygo zig"
BREW_FORMULAS="node pnpm go tinygo zig"

missing=()
present=()

get_version() {
  local raw
  case "$1" in
    go)     raw=$("$1" version 2>/dev/null | head -1); echo "$raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 ;;
    tinygo) raw=$("$1" version 2>/dev/null | head -1); echo "$raw" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 ;;
    zig)    "$1" version 2>/dev/null | head -1 ;;
    *)      "$1" --version 2>/dev/null | head -1 | sed 's/^v//' ;;
  esac
}

for dep in $DEPS; do
  if has_cmd "$dep"; then
    version=$(get_version "$dep")
    present+=("$dep ($version)")
  else
    missing+=("$dep")
  fi
done

echo ""
printf "${BOLD}OpenKit Setup${RESET}\n"
echo ""

# Show what's already installed
if [ ${#present[@]} -gt 0 ]; then
  for item in "${present[@]}"; do
    printf "  ${GREEN}✔${RESET} %s\n" "$item"
  done
fi

# Show what's missing
if [ ${#missing[@]} -gt 0 ]; then
  for item in "${missing[@]}"; do
    printf "  ${RED}✖${RESET} %s ${DIM}— not found${RESET}\n" "$item"
  done
fi

echo ""

# ── Install missing dependencies ───────────────────────────────────────────

if [ ${#missing[@]} -gt 0 ]; then
  if ! has_cmd brew; then
    error "Homebrew is required to install missing dependencies."
    error "Install it from https://brew.sh and re-run this script."
    exit 1
  fi

  info "Select which missing tools to install via Homebrew:"
  echo ""

  # Build selection array — all selected by default
  selected=()
  for i in "${!missing[@]}"; do
    selected+=("1")
  done

  # Map dep names to brew formula names
  brew_formula_for() {
    case "$1" in
      node)    echo "node" ;;
      pnpm)    echo "pnpm" ;;
      go)      echo "go" ;;
      tinygo)  echo "tinygo-org/tools/tinygo" ;;
      zig)     echo "zig" ;;
      *)       echo "$1" ;;
    esac
  }

  # Interactive checklist
  print_checklist() {
    for i in "${!missing[@]}"; do
      if [ "${selected[$i]}" = "1" ]; then
        printf "  ${GREEN}[x]${RESET} %s\n" "${missing[$i]}"
      else
        printf "  ${DIM}[ ]${RESET} %s\n" "${missing[$i]}"
      fi
    done
    echo ""
    printf "  ${DIM}Toggle: type the number (1-%d) and press Enter${RESET}\n" "${#missing[@]}"
    printf "  ${DIM}Install selected: press Enter with no input${RESET}\n"
    printf "  ${DIM}Skip all: type 's' and press Enter${RESET}\n"
    echo ""
  }

  while true; do
    print_checklist
    printf "  ${BOLD}>${RESET} "
    read -r choice

    if [ -z "$choice" ]; then
      break
    fi

    if [ "$choice" = "s" ] || [ "$choice" = "S" ]; then
      for i in "${!selected[@]}"; do
        selected[$i]="0"
      done
      break
    fi

    # Validate numeric input in range
    if echo "$choice" | grep -qE '^[0-9]+$'; then
      idx=$((choice - 1))
      if [ "$idx" -ge 0 ] && [ "$idx" -lt "${#missing[@]}" ]; then
        if [ "${selected[$idx]}" = "1" ]; then
          selected[$idx]="0"
        else
          selected[$idx]="1"
        fi
      else
        warn "Invalid number. Pick 1-${#missing[@]}."
      fi
    else
      warn "Invalid input."
    fi

    # Move cursor up to redraw checklist (number of missing + 5 info lines)
    lines=$(( ${#missing[@]} + 5 ))
    printf "\033[%dA\033[J" "$lines"
  done

  # Install selected
  to_install=()
  for i in "${!missing[@]}"; do
    if [ "${selected[$i]}" = "1" ]; then
      to_install+=("$(brew_formula_for "${missing[$i]}")")
    fi
  done

  if [ ${#to_install[@]} -gt 0 ]; then
    echo ""
    info "Installing: ${to_install[*]}"
    echo ""
    brew install "${to_install[@]}"
    echo ""
    success "Dependencies installed."
  else
    warn "Skipped dependency installation."
  fi
else
  success "All dependencies are available."
fi

# ── Environment file ───────────────────────────────────────────────────────

echo ""

if [ ! -f ".env.example" ]; then
  error "Missing .env.example; cannot create .env.local."
  exit 1
fi

if [ -f ".env.local" ]; then
  success ".env.local already exists — no changes needed."
else
  cp ".env.example" ".env.local"
  success "Created .env.local from .env.example."
fi

# ── Install pnpm dependencies ─────────────────────────────────────────────

echo ""

if has_cmd pnpm; then
  info "Installing pnpm dependencies..."
  echo ""
  pnpm install
  echo ""
  success "Dependencies installed."
else
  warn "pnpm not available — skipping dependency installation."
  warn "Install pnpm and run 'pnpm install' manually."
fi

# ── Done ───────────────────────────────────────────────────────────────────

echo ""
success "Setup complete!"
echo ""
