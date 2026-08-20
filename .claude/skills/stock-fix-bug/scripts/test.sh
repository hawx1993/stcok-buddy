#!/usr/bin/env bash
set -euo pipefail

if [[ -f pnpm-lock.yaml ]] && command -v pnpm >/dev/null 2>&1; then
  runner=(pnpm)
elif [[ -f package-lock.json ]] && command -v npm >/dev/null 2>&1; then
  runner=(npm)
else
  echo "No supported package manager found. Expected pnpm or npm." >&2
  exit 1
fi

if [[ "$#" -gt 0 ]]; then
  "${runner[@]}" test -- "$@"
else
  "${runner[@]}" test
fi
