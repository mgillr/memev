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
node "$bin" init "$@"
if [ -n "${MEMEV_CONFIG_DIR:-}" ]; then
  cfg=$MEMEV_CONFIG_DIR
elif [ -n "${XDG_CONFIG_HOME:-}" ]; then
  cfg=$XDG_CONFIG_HOME/memev
else
  cfg=${HOME:?}/.config/memev
fi
launcher=$cfg/bin/memev
if [ ! -f "$launcher" ]; then
  echo "installed launcher is missing" >&2
  exit 1
fi
"$launcher" restart
