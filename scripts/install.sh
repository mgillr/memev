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
embedded_runtime_spec() {
  cat <<'END_NODE_RUNTIME'
{
  "version": "22.23.4",
  "platforms": {
    "linux-x64": {"url": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.gz", "sha256": "b8492284c76a54baf58d61668dd0e41ee0fc98adabf9503d30f05d08f55b4406"},
    "linux-arm64": {"url": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-arm64.tar.gz", "sha256": "f7a1e486dbc8b286847815b477d4fb5e9fb963ed4489c3e1588853d685f589f9"},
    "darwin-arm64": {"url": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-darwin-arm64.tar.gz", "sha256": "c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428"},
    "darwin-x64": {"url": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-darwin-x64.tar.gz", "sha256": "efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819"},
    "win-x64": {"url": "https://nodejs.org/dist/v22.23.4/node-v22.23.4-win-x64.zip", "sha256": "cbc74b5e0982c9dbb41525fd8fb5dcd32fbee237863f7829072f4639a1ce5f20"}
  }
}
END_NODE_RUNTIME
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
if [ -n "${MEMEV_NODE_SPEC:-}" ]; then
  spec=$MEMEV_NODE_SPEC
else
  spec=""
  if [ -f "$0" ]; then
    here=$(cd "$(dirname "$0")" && pwd)
    if [ -f "$here/node-runtime.json" ]; then
      spec=$here/node-runtime.json
    fi
  fi
  if [ -z "$spec" ]; then
    spec=$work/node-runtime.json
    embedded_runtime_spec > "$spec"
  fi
fi
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
  version=$(sed -n 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$spec" | head -n 1)
  if [ -z "$version" ]; then
    echo "pinned Node runtime spec has no version" >&2
    exit 1
  fi
  pin_dir=$cfg/node/v$version
  if [ -x "$pin_dir/bin/node" ]; then
    have=$("$pin_dir/bin/node" --version 2>/dev/null || true)
    if [ "$have" = "v$version" ]; then
      printf '%s' "$pin_dir/bin/node"
      return 0
    fi
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
  if [ -e "$pin_dir" ]; then
    if ! mv "$pin_dir" "$pin_dir.old.$$"; then
      echo "pinned Node runtime is in use and could not be moved aside" >&2
      exit 1
    fi
  fi
  mv "$top" "$pin_dir"
  chmod +x "$pin_dir/bin/node"
  printf '%s' "$pin_dir/bin/node"
}
NODE=$(pick_node)
"$NODE" "$bin" init "$@"
launcher=$cfg/bin/memev
if [ ! -f "$launcher" ]; then
  echo "installed launcher is missing" >&2
  exit 1
fi
"$launcher" restart
