#!/usr/bin/env bash
set -euo pipefail

# Use the Linux x64 archive selected by ffmpeg-static. Fetch it through the
# release asset API because direct release downloads can time out on runners.
FFMPEG_BIN="$RUNNER_TEMP/tape-ci-ffmpeg"
gh release download b6.1.1 --repo eugeneware/ffmpeg-static --pattern ffmpeg-linux-x64.gz --output "$FFMPEG_BIN.gz"
echo "bfe8a8fc511530457b528c48d77b5737527b504a3797a9bc4866aeca69c2dffa  $FFMPEG_BIN.gz" | sha256sum --check
gzip -dc "$FFMPEG_BIN.gz" > "$FFMPEG_BIN"
chmod 755 "$FFMPEG_BIN"
FFMPEG_BIN="$FFMPEG_BIN" npm ci
install -m 755 "$FFMPEG_BIN" node_modules/ffmpeg-static/ffmpeg
