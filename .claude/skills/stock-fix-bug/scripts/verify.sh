#!/usr/bin/env bash
set -euo pipefail

run_build=1
if [[ "${1:-}" == "--quick" ]]; then
  run_build=0
fi

if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
  runner=(pnpm)
elif [[ -f package-lock.json ]] && command -v npm >/dev/null 2>&1; then
  runner=(npm)
else
  echo "No supported package manager found. Expected pnpm or npm." >&2
  exit 1
fi

echo "== git diff --check =="
git diff --check

echo "== typecheck =="
"${runner[@]}" run typecheck

echo "== lint =="
"${runner[@]}" run lint

if [[ "$run_build" -eq 1 ]]; then
  echo "== build =="
  "${runner[@]}" run build
else
  echo "== build skipped (--quick) =="
fi
