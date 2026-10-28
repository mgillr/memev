#!/bin/bash
# Install Memev from a release tarball. The URL is an argument. No address is built in.
set -eu
if [ "${1:-}" = "" ]; then
  echo "usage: install.sh <tarball-url> [checksum-url]" >&2
  exit 2
fi
url=$1
shift
sumurl="${url}.sha256"
if [ "${1:-}" != "" ]; then
  case "$1" in
    -*) ;;
    *) sumurl=$1; shift ;;
  esac
fi
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fetch() {
  dest=$1
  from=$2
  low=$(printf '%s' "$from" | tr '[:upper:]' '[:lower:]')
  case "$low" in
    file://*)
      cp "${from:7}" "$dest"
      ;;
    https://*)
      curl --proto '=https' --tlsv1.2 -fsSL "$from" -o "$dest"
      ;;
    *)
      echo "URL must be https or a file URL" >&2
      exit 1
      ;;
  esac
}
fetch "$work/pkg.tgz" "$url"
fetch "$work/pkg.sha256" "$sumurl"
expected=$(awk 'NR==1 { print $1; exit }' "$work/pkg.sha256")
if command -v sha256sum >/dev/null 2>&1; then
  actual=$(sha256sum "$work/pkg.tgz" | awk '{ print $1; exit }')
else
  actual=$(shasum -a 256 "$work/pkg.tgz" | awk '{ print $1; exit }')
fi
if [ "$actual" != "$expected" ]; then
  echo "SHA-256 does not match" >&2
  exit 1
fi
mkdir -p "$work/src"
tar -xzf "$work/pkg.tgz" -C "$work/src"
bin=""
for f in "$work/src"/package/bin/memev.mjs "$work/src"/bin/memev.mjs; do
  if [ -f "$f" ]; then
    bin=$f
    break
  fi
done
if [ -z "$bin" ]; then
  echo "tarball has no bin/memev.mjs" >&2
  exit 1
fi
here=$(cd "$(dirname "$0")" && pwd)
spec=${MEMEV_NODE_SPEC:-$here/node-runtime.json}
if [ -n "${MEMEV_CONFIG_DIR:-}" ]; then
  cfg=$MEMEV_CONFIG_DIR
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  cfg=$XDG_CONFIG_HOME/memev
else
  cfg=${HOME:?}/.config/memev
fi
pick_node() {
  if command -v node >/dev/null 2>&1; then
    found=$(command -v node)
    ver=$("$found" --version 2>/dev/null || true)
    ver=${ver#v}
    major=${ver%%.*}
    case "$major" in
      ''|*[!0-9]*) ;;
      *)
        if [ "$major" -ge 22 ]; then
          printf '%s' "$found"
          return 0
        fi
        ;;
    esac
  fi
  if [ ! -f "$spec" ]; then
    echo "pinned Node runtime spec is missing" >&2
    exit 1
  fi
  os=$(uname -s)
  arch=$(uname -m)
  case "$os-$arch" in
    Linux-x86_64) key=linux-x64 ;;
    Linux-aarch64) key=linux-arm64 ;;
    Darwin-arm64) key=darwin-arm64 ;;
    Darwin-x86_64) key=darwin-x64 ;;
    *)
      echo "no pinned Node runtime for $os $arch" >&2
      exit 1
      ;;
  esac
  line=$(grep -F "\"$key\"" "$spec" | head -n 1)
  url=$(printf '%s\n' "$line" | sed -n 's/.*"url"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  sha=$(printf '%s\n' "$line" | sed -n 's/.*"sha256"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  if [ -z "$url" ] || [ -z "$sha" ]; then
    echo "pinned Node runtime has no entry for $key" >&2
    exit 1
  fi
  archive=$work/node.pkg
  if [ -n "${MEMEV_NODE_FETCH:-}" ]; then
    "$MEMEV_NODE_FETCH" "$url" "$archive"
  else
    low=$(printf '%s' "$url" | tr '[:upper:]' '[:lower:]')
    case "$low" in
      file://*) cp "${url:7}" "$archive" ;;
      https://*) curl --proto '=https' --tlsv1.2 -fsSL "$url" -o "$archive" ;;
      *) echo "URL must be https or a file URL" >&2; exit 1 ;;
    esac
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$archive" | awk '{ print $1; exit }')
  else
    actual=$(shasum -a 256 "$archive" | awk '{ print $1; exit }')
  fi
  if [ "$actual" != "$sha" ]; then
    echo "SHA-256 does not match" >&2
    exit 1
  fi
  ndir=$work/node-src
  mkdir -p "$ndir"
  tar -xzf "$archive" -C "$ndir"
  top=""
  for d in "$ndir"/*; do
    if [ -d "$d" ]; then top=$d; break; fi
  done
  if [ -z "$top" ] || [ ! -f "$top/bin/node" ]; then
    echo "runtime archive has no bin/node" >&2
    exit 1
  fi
  mkdir -p "$cfg/node"
  rm -rf "$cfg/node/pinned"
  mv "$top" "$cfg/node/pinned"
  chmod +x "$cfg/node/pinned/bin/node"
  printf '%s' "$cfg/node/pinned/bin/node"
}
NODE=$(pick_node)
"$NODE" "$bin" init "$@"
launcher=$cfg/bin/memev
if [ ! -f "$launcher" ]; then
  echo "installed launcher is missing" >&2
  exit 1
fi
"$launcher" restart
