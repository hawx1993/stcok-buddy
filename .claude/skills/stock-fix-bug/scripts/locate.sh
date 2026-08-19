#!/usr/bin/env bash
set -euo pipefail

query="${1:-}"
limit="${LOCATE_LIMIT:-20}"

if [[ -z "$query" ]]; then
  echo "Usage: bash .claude/skills/stock-fix-bug/scripts/locate.sh <error-text|symbol|keyword>" >&2
  exit 2
fi

if command -v rg >/dev/null 2>&1; then
  rg --line-number --column --smart-case --hidden \
    --glob '!node_modules/**' \
    --glob '!dist/**' \
    --glob '!dist-electron/**' \
    --glob '!coverage/**' \
    --glob '!release/**' \
    --glob '!*.log' \
    --max-count 3 \
    "$query" . | head -n "$limit"
else
  grep -RIn --exclude-dir=node_modules --exclude-dir=dist --exclude-dir=dist-electron --exclude-dir=coverage --exclude='*.log' "$query" . | head -n "$limit"
fi
