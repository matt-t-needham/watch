#!/usr/bin/env bash
# Builds and signs bix/out/materialious.apk (universal: arm64, armv7, x86_64).
# Signed with the same key as watch_tv's APK, kept outside the repo in
# ~/.config/bix/watch-tv-apk/; every later build must use it, or the TV
# refuses the update (uninstall first, which loses the app's sign-in).
set -euo pipefail
cd "$(dirname "$0")/.."

KEYDIR="$HOME/.config/bix/watch-tv-apk"
IMAGE=materialious-apk-build
VERSION_CODE=$(( $(date +%s) / 60 ))   # minutes since epoch: always increasing
UPSTREAM=$(git describe --tags --abbrev=0 2>/dev/null || echo unknown)
VERSION_NAME="$UPSTREAM-bix.$(date -u +%Y%m%d%H%M)"

[[ -f "$KEYDIR/release.jks" ]] || { echo "$(date -Is) materialious-apk: ERROR: no signing key in $KEYDIR (watch_tv/android/build.sh creates it)" >&2; exit 1; }

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
