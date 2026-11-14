#!/usr/bin/env bash
# Web-vs-Rust theme comparison: renders each gallery schema under each theme in
# both renderers, writes out/<gallery>-<theme>-side.png (web left, rust right)
# and out/scores.json. Output lives in target/theme-compare/ — not committed.
#
# Usage: crates/renderer/scripts/theme-compare.sh [--skip-rust] [--skip-web]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
OUT="$ROOT/crates/renderer/target/theme-compare"
PORT="${WE_COMPARE_PORT:-3100}"
URL="http://localhost:$PORT"

mkdir -p "$OUT/rust" "$OUT/web"

if [[ "${1:-}" != "--skip-rust" ]]; then
  (cd "$ROOT/crates/renderer" &&
    WE_COMPARE_OUT="$OUT/rust" cargo test -p we-app --test theme_compare -- --nocapture)
fi

# The preview dev server serves theme-shot.html and the gallery JSON via /@fs/.
(cd "$ROOT" && pnpm --filter @we/app-preview dev --port "$PORT" --strictPort) &
DEV_PID=$!
trap 'kill $DEV_PID 2>/dev/null || true' EXIT
for i in $(seq 1 120); do
  curl -fsS "$URL/theme-shot.html" -o /dev/null 2>&1 && break
  sleep 1
done

node "$HERE/theme-compare.mjs" \
  --url "$URL" \
  --galleries "$ROOT/crates/renderer/we-app/gallery" \
  --rust "$OUT/rust" \
  --out "$OUT"
