#!/bin/sh
# Local Docker check (not run in CI): build, self-test, compose up, MCP with a token, 401 without.
set -eu
docker build -t memev:local .
docker run --rm --entrypoint memev memev:local selftest
docker compose up -d --build
trap 'docker compose down -v' EXIT
for i in $(seq 1 30); do curl -fs http://127.0.0.1:7787/healthz && break; sleep 1; done
TOKEN=$(docker compose exec -T memev memev token issue smoke-host | tail -1)
curl -fs -X POST http://127.0.0.1:7787/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"memev_remember","arguments":{"text":"compose smoke test memory","kind":"fact"}}}' | grep -q '"seq"'
curl -fs -X POST http://127.0.0.1:7787/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"memev_recall","arguments":{"query":"compose smoke test"}}}' | grep -q 'compose smoke test memory'
test "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://127.0.0.1:7787/mcp -d '{}')" = 401
echo "docker smoke: ok"
