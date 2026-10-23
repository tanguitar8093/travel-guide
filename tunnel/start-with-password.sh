#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
if [[ -z "${TUNNEL_USERNAME:-}" ]]; then
  read -r -p '登入帳號（預設 travel）：' TUNNEL_USERNAME
  TUNNEL_USERNAME="${TUNNEL_USERNAME:-travel}"
fi
if [[ -z "${TUNNEL_PASSWORD:-}" ]]; then
  read -r -s -p '登入密碼（不會顯示，留空自動產生）：' TUNNEL_PASSWORD
  echo
  if [[ -z "$TUNNEL_PASSWORD" ]]; then
    TUNNEL_PASSWORD="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))')"
    printf '本次隨機密碼：%s\n' "$TUNNEL_PASSWORD"
  fi
fi
export TUNNEL_USERNAME TUNNEL_PASSWORD
exec node tunnel/run.mjs protected
