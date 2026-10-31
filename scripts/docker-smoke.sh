#!/bin/sh
# Docker persistence check (not run in CI; run it from the repository root). MEMEV_IMAGE names a
# published image to pull; without it the image is built locally. The script starts the container,
# waits for the health check with a deadline (MEMEV_SMOKE_HEALTH_TIMEOUT, default 60 seconds),
# checks that an MCP call without a token is refused with 401 through the published port, writes a
# note unique to this run through the CLI inside the container, restarts the container and reads
# the note back, then checks that compose down keeps the volume.
#
# Everything runs in a compose project of its own (memev-smoke), so a memev deployed from this
# checkout keeps its container and its vault volume; the smoke project's volume is removed at the
# end. The port is the one compose.yaml publishes (MEMEV_PORT, default 7787): if a memev on this
# machine already publishes it, run the smoke with MEMEV_PORT set to a free port.
set -eu

fail() { echo "docker smoke: failed at $1" >&2; exit 1; }

HEALTH_TIMEOUT="${MEMEV_SMOKE_HEALTH_TIMEOUT:-60}"
PROJECT=memev-smoke
VOLUME="${PROJECT}_memev-vault"
PORT="${MEMEV_PORT:-7787}"
# A note no earlier run wrote: reading it back proves this run's write survived the restart, and
# the write gate never takes it for a duplicate of an earlier run's note.
NOTE="docker smoke note $(date +%s)-$$"

dc() { docker compose -p "$PROJECT" "$@"; }

if [ -n "${MEMEV_IMAGE:-}" ]; then
  docker pull "$MEMEV_IMAGE" || fail "pull $MEMEV_IMAGE"
else
  dc build || fail "build"
fi

trap 'dc down -v' EXIT

dc up -d || fail "up"

wait_healthy() {
  start=$(date +%s)
  while :; do
    state=$(dc ps --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
    if [ "$state" = "healthy" ]; then
      echo "container is healthy"
      return 0
    fi
    now=$(date +%s)
    if [ $((now - start)) -ge "$HEALTH_TIMEOUT" ]; then
      return 1
    fi
    sleep 1
  done
}

wait_healthy || fail "wait for healthy"

# LAB-TEST-PLAN T-INS-04: an MCP call without a token through the published port is refused
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "http://127.0.0.1:$PORT/mcp" -d '{}' || true)
[ "$code" = "401" ] || fail "401 without a token (got ${code:-no answer})"

dc exec -T memev memev remember "$NOTE" --kind fact || fail "remember"

dc restart memev || fail "restart"

wait_healthy || fail "wait for healthy after restart"

out=$(dc exec -T memev memev recall "$NOTE" 2>&1) || fail "recall"
echo "$out" | grep -qF "$NOTE" || fail "read the note back"

dc down || fail "down"

docker volume inspect "$VOLUME" >/dev/null 2>&1 || fail "volume $VOLUME kept after down"

echo "docker smoke: ok"
