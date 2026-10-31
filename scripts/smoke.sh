#!/bin/sh
# CLI smoke: what a person or an agent runs after any install (tarball, source checkout, container).
# It works in a fresh HOME, takes its port from the operating system, and runs four steps:
# version, init, doctor, status. It exits non-zero and names the step when any step fails.
# Usage: scripts/smoke.sh [path-to-memev]
# With no argument, memev comes from MEMEV_BIN, then from PATH, then from bin/memev.mjs in the
# checkout this script lives in.
set -u

fail() { echo "smoke: FAIL at step $1" >&2; exit 1; }

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)

BIN=${1:-${MEMEV_BIN:-}}
if [ -z "$BIN" ] && command -v memev >/dev/null 2>&1; then BIN=$(command -v memev); fi
if [ -n "$BIN" ]; then
  memev_cmd() { "$BIN" "$@"; }
elif [ -f "$ROOT/bin/memev.mjs" ]; then
  memev_cmd() { node "$ROOT/bin/memev.mjs" "$@"; }
else
  fail "find-memev"
fi

# A fresh HOME, so the smoke never touches a real vault.
HOME_=$(mktemp -d) || fail "home"
trap 'rm -rf "$HOME_"' EXIT
export HOME="$HOME_"
export XDG_CONFIG_HOME="$HOME_/.config"
export MEMEV_CONFIG_DIR="$HOME_/.config/memev"
export MEMEV_ROOT="$HOME_/memev"
export MEMEV_NO_SERVICE=1 MEMEV_NO_TUNNEL=1 MEMEV_NO_DOWNLOAD=1 MEMEV_NO_BACKGROUND=1
export MEMEV_MACHINE_NAME=smoke
export GIT_CONFIG_NOSYSTEM=1

# A port the operating system hands out, nothing listening on it.
PORT=$(node -e 'const s=require("net").createServer();s.listen(0,"127.0.0.1",()=>{process.stdout.write(String(s.address().port));s.close()})' 2>/dev/null) || fail "port"
case ${PORT:-} in ''|*[!0-9]*) fail "port";; esac

EXPECT=${MEMEV_EXPECT_VERSION:-}
if [ -z "$EXPECT" ] && [ -f "$ROOT/package.json" ]; then
  EXPECT=$(node -p 'JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version' "$ROOT/package.json" 2>/dev/null) || fail "version"
fi

V=$(memev_cmd --version 2>&1) || fail "version"
[ -n "$V" ] || fail "version"
if [ -n "$EXPECT" ]; then
  [ "$V" = "$EXPECT" ] || fail "version"
fi

memev_cmd init --port "$PORT" --local-only --no-connect >/dev/null 2>&1 || fail "init"

D=$(memev_cmd doctor --json 2>/dev/null) || fail "doctor"
BAD=$(node -e 'const c=JSON.parse(process.argv[1]);if(!Array.isArray(c))process.exit(2);process.stdout.write(String(c.filter((x)=>x.status==="fail").length))' "$D" 2>/dev/null) || fail "doctor"
[ "$BAD" = "0" ] || fail "doctor"

S=$(memev_cmd status 2>&1) || fail "status"
[ -n "$S" ] || fail "status"

memev_cmd stop >/dev/null 2>&1 || true
echo "smoke: ok (memev $V)"
