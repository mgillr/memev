#!/bin/sh
# Docker persistence check (not run in CI; run it from the repository root). MEMEV_IMAGE names a
# published image to pull; without it the image is built locally. The script starts the container,
# waits for the health check with a deadline (MEMEV_SMOKE_HEALTH_TIMEOUT, default 60 seconds),
# writes a note through the CLI inside the container, restarts the container and reads the note
# back, then checks that compose down keeps the volume.
set -eu

fail() { echo "docker smoke: failed at $1" >&2; exit 1; }

HEALTH_TIMEOUT="${MEMEV_SMOKE_HEALTH_TIMEOUT:-60}"

if [ -n "${MEMEV_IMAGE:-}" ]; then
  docker pull "$MEMEV_IMAGE" || fail "pull $MEMEV_IMAGE"
else
  docker compose build || fail "build"
fi

trap 'docker compose down' EXIT

docker compose up -d || fail "up"

wait_healthy() {
  start=$(date +%s)
  while :; do
    state=$(docker compose ps --format json 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 | cut -d'"' -f4 || true)
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

docker compose exec -T memev memev remember "docker smoke note" --kind fact || fail "remember"

docker compose restart memev || fail "restart"

wait_healthy || fail "wait for healthy after restart"

out=$(docker compose exec -T memev memev recall "docker smoke note" 2>&1) || fail "recall"
echo "$out" | grep -q "docker smoke note" || fail "read the note back"

docker compose down || fail "down"

docker volume ls | grep -q memev-vault || fail "volume kept after down"

echo "docker smoke: ok"
