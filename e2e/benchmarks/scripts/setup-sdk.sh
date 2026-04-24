#!/usr/bin/env bash
# setup-sdk.sh — Build the AD4M TypeScript SDK from the current branch and
# install it into the benchmark workspace via pnpm link.
#
# Usage:
#   ./scripts/setup-sdk.sh                       # auto-detect ad4m repo
#   ./scripts/setup-sdk.sh --ad4m /path/to/ad4m  # explicit path
#   BENCH_AD4M_DIR=/path/to/ad4m ./scripts/setup-sdk.sh
#
# Also builds the Rust executor (release) so benchmark fixtures can spawn it.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BENCH_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WE_DIR="$(cd "$BENCH_DIR/../.." && pwd)"

# Resolve ad4m directory
AD4M_DIR="${BENCH_AD4M_DIR:-""}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --ad4m) AD4M_DIR="$2"; shift 2 ;;
    --skip-rust) SKIP_RUST=1; shift ;;
    *) echo "Unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$AD4M_DIR" ]]; then
  # Auto-detect: look for ad4m/ next to the we/ workspace
  if [[ -d "$WE_DIR/../ad4m/core" ]]; then
    AD4M_DIR="$(cd "$WE_DIR/../ad4m" && pwd)"
  else
    echo "ERROR: Cannot find ad4m repo. Pass --ad4m /path/to/ad4m"
    exit 1
  fi
fi

CORE_DIR="$AD4M_DIR/core"
BRANCH="$(cd "$AD4M_DIR" && git branch --show-current 2>/dev/null || echo 'unknown')"
COMMIT="$(cd "$AD4M_DIR" && git rev-parse --short HEAD 2>/dev/null || echo 'unknown')"

echo "=== AD4M SDK Setup ==="
echo "  ad4m repo:  $AD4M_DIR"
echo "  branch:     $BRANCH"
echo "  commit:     $COMMIT"
echo "  core:       $CORE_DIR"
echo "  benchmarks: $BENCH_DIR"
echo ""

# 1. Build the TypeScript SDK
echo "[1/3] Building @coasys/ad4m (TypeScript SDK)..."
(cd "$CORE_DIR" && pnpm install --frozen-lockfile 2>/dev/null || pnpm install && pnpm run build)
echo "  ✓ SDK built"

# 2. Build the Rust executor (unless --skip-rust)
if [[ "${SKIP_RUST:-0}" != "1" ]]; then
  echo "[2/3] Building ad4m-executor (Rust, release)..."
  (cd "$AD4M_DIR" && cargo build --release -p ad4m-executor 2>&1 | tail -3)
  echo "  ✓ Executor built"
else
  echo "[2/3] Skipping Rust executor build (--skip-rust)"
fi

# 3. Install benchmark deps via pnpm (which resolves workspace:* → local core)
echo "[3/3] Installing benchmark dependencies..."
# Remove stale npm lockfile if present (we use pnpm now)
rm -f "$BENCH_DIR/package-lock.json"
(cd "$WE_DIR" && pnpm install --filter @we/sparql-benchmarks --ignore-scripts)
echo "  ✓ Dependencies installed"

# Verify the link
RESOLVED=$(node -e "try { const p = require.resolve('@coasys/ad4m/package.json', { paths: ['$BENCH_DIR'] }); console.log(p); } catch(e) { console.log('NOT FOUND'); }" 2>/dev/null || echo "NOT FOUND")
echo ""
echo "=== Verification ==="
echo "  @coasys/ad4m resolved to: $RESOLVED"
echo "  Executor binary: $AD4M_DIR/target/release/ad4m-executor"
echo ""

# Export paths for convenience
echo "To run benchmarks:"
echo "  cd $BENCH_DIR"
echo "  BENCH_EXECUTOR_PATH=$AD4M_DIR/target/release/ad4m-executor \\"
echo "    npx vitest run"
