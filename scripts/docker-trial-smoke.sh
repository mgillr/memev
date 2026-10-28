#!/bin/sh
set -eu

# Build the image
docker compose -f compose.trial.yaml build

# Start the container
docker compose -f compose.trial.yaml up -d

# Wait for healthy
for i in $(seq 1 30); do
  state=$(docker compose -f compose.trial.yaml ps --format json | grep -o '"Health":"[^"]*"' | cut -d'"' -f4)
  if [ "$state" = "healthy" ]; then
    echo "container is healthy"
    break
  fi
  sleep 2
done

# Run the doctor
docker compose -f compose.trial.yaml exec memev memev doctor

# Install a throwaway test licence
docker compose -f compose.trial.yaml exec memev sh -c "echo '{}' > /vault/trial.license.json"
docker compose -f compose.trial.yaml exec memev memev license install /vault/trial.license.json

# Stop and remove volumes
docker compose -f compose.trial.yaml down -v

echo "trial smoke complete"
