#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."
export TRIPMAP_DIST="$PWD/dist"
export STATIC_PORT="${STATIC_PORT:-4173}"
export OSM_UPSTREAM="${OSM_UPSTREAM:-127.0.0.1:3000}"
CADDY_BIN="${CADDY_BIN:-$HOME/.local/bin/caddy}"
[[ -x "$CADDY_BIN" ]] || { echo "找不到 Caddy：$CADDY_BIN" >&2; exit 1; }
[[ -f dist/index.html ]] || { echo '請先執行 npm run build:static' >&2; exit 1; }
osm_pid=''
caddy_pid=''
cleanup() {
  trap - EXIT INT TERM
  if [[ -n "$caddy_pid" ]]; then kill "$caddy_pid" 2>/dev/null || true; wait "$caddy_pid" 2>/dev/null || true; fi
  if [[ -n "$osm_pid" ]]; then kill "$osm_pid" 2>/dev/null || true; wait "$osm_pid" 2>/dev/null || true; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
healthy() {
  curl --fail --silent --max-time 2 "http://$OSM_UPSTREAM/api/health" |
    python3 -c 'import sys,json; d=json.load(sys.stdin); sys.exit(not (d.get("ok") is True and d.get("dataset")=="Okinawa OSM"))' 2>/dev/null
}
"$CADDY_BIN" validate --config deploy/Caddyfile --adapter caddyfile
if healthy; then
  echo "沿用現有 OSM 後端 $OSM_UPSTREAM；結束時不會停止它。"
else
  [[ "$OSM_UPSTREAM" == '127.0.0.1:3000' ]] || { echo '指定的 OSM 後端無法連線。' >&2; exit 1; }
  (cd osm && exec env PYTHONUNBUFFERED=1 HOST=127.0.0.1 PORT=3000 python3 server.py) &
  osm_pid=$!
  ready=false
  for ((i=0; i<120; i++)); do
    if healthy; then ready=true; break; fi
    kill -0 "$osm_pid" 2>/dev/null || { echo 'OSM 後端啟動失敗。' >&2; exit 1; }
    sleep 0.5
  done
  "$ready" || { echo 'OSM 後端啟動逾時。' >&2; exit 1; }
fi
echo "靜態網站：http://127.0.0.1:$STATIC_PORT（Ctrl+C 停止本次服務）"
"$CADDY_BIN" run --config deploy/Caddyfile --adapter caddyfile &
caddy_pid=$!
wait "$caddy_pid"
