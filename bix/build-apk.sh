#!/usr/bin/env bash
# Builds and signs bix/out/materialious.apk (universal: arm64, armv7, x86_64).
# Signed with the key in ~/.config/bix/watch-tv-apk/ (named after the
# retired watch_tv app that first made it), kept outside the repo; every later build must use it, or the TV
# refuses the update (uninstall first, which loses the app's sign-in).
set -euo pipefail
cd "$(dirname "$0")/.."

KEYDIR="$HOME/.config/bix/watch-tv-apk"
IMAGE=materialious-apk-build
VERSION_CODE=$(( $(date +%s) / 60 ))   # minutes since epoch: always increasing
# Upstream's version, from its package.json (main has no upstream tags).
UPSTREAM=$(python3 -c 'import json; print(json.load(open("materialious/package.json"))["version"])')
VERSION_NAME="$UPSTREAM-bix.$(date -u +%Y%m%d%H%M)"

[[ -f "$KEYDIR/release.jks" ]] || { echo "$(date -Is) materialious-apk: ERROR: no signing key in $KEYDIR (release.jks + keystore.pass; a new key means uninstalling the app first)" >&2; exit 1; }

DOCKER_BUILDKIT=1 docker build -q -f bix/android.Dockerfile -t "$IMAGE" \
  --build-arg VERSION_CODE="$VERSION_CODE" --build-arg VERSION_NAME="$VERSION_NAME" materialious > /dev/null

mkdir -p bix/out
docker run --rm --user "$(id -u):$(id -g)" -v "$KEYDIR:/key:ro" -v "$PWD/bix/out:/out" "$IMAGE" sh -c '
  zipalign -p -f 4 /unsigned.apk /tmp/aligned.apk \
  && apksigner sign --ks /key/release.jks --ks-pass file:/key/keystore.pass \
       --out /out/materialious.apk /tmp/aligned.apk \
  && apksigner verify /out/materialious.apk'
rm -f bix/out/materialious.apk.idsig
echo "$(date -Is) materialious-apk: built bix/out/materialious.apk version $VERSION_NAME ($VERSION_CODE)"
