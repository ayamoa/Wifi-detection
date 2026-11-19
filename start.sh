#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"
URL="http://127.0.0.1:7373"
NODE_BIN="${NODE:-node}"

if ! command -v "$NODE_BIN" >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20+ from https://nodejs.org and try again."
  exit 1
fi

open_url() {
  if command -v open >/dev/null 2>&1; then
    open "$URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$URL" >/dev/null 2>&1 || true
  else
    echo "Open $URL"
  fi
}

if "$NODE_BIN" -e "fetch('$URL/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))" >/dev/null 2>&1; then
  open_url
  exit 0
fi

( sleep 2; open_url ) &
exec "$NODE_BIN" server.mjs
