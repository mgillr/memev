#!/bin/sh
set -eu

# Build the image
docker compose -f compose.trial.yaml build

# Start the container
docker compose -f compose.trial.yaml up -d

# Clean up on any exit so every run removes the container and volumes
trap 'docker compose -f compose.trial.yaml down -v' EXIT

# Wait for healthy; exit 1 when the container is not healthy within the wait
healthy=0
for i in $(seq 1 30); do
  state=$(docker compose -f compose.trial.yaml ps --format json | grep -o '"Health":"[^"]*"' | cut -d'"' -f4)
  if [ "$state" = "healthy" ]; then
    healthy=1
    echo "container is healthy"
    break
  fi
  sleep 2
done
if [ "$healthy" != "1" ]; then
  echo "container is not healthy after 60s" >&2
  exit 1
fi

# Run the doctor
docker compose -f compose.trial.yaml exec memev memev doctor

# Install a throwaway test licence: the person passes a real trial licence file,
# or an empty file to check that an unsigned licence is refused with the
# "not installed: ..." line.
if [ -n "${1:-}" ]; then
  docker compose -f compose.trial.yaml cp "$1" memev:/vault/trial.license.json
  docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json
else
  docker compose -f compose.trial.yaml exec memev sh -c "echo '{}' > /vault/trial.license.json"
  docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json || true
fi

# Stop and remove volumes (the trap also runs this; it is idempotent)
docker compose -f compose.trial.yaml down -v

echo "trial smoke complete"
