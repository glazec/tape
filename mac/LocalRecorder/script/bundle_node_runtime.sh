#!/usr/bin/env bash
set -euo pipefail

DESTINATION="${1:?usage: bundle_node_runtime.sh <destination>}"
NODE_VERSION="${MEETING_NOTE_NODE_VERSION:-v24.18.0}"
NODE_ARCH="${MEETING_NOTE_NODE_ARCH:-$(uname -m)}"
DIST_BASE_URL="${MEETING_NOTE_NODE_DIST_BASE_URL:-https://nodejs.org/dist}"
CACHE_ROOT="${MEETING_NOTE_NODE_CACHE_DIR:-$HOME/Library/Caches/MeetingNoteLocalRecorder/node}"

if [[ "$NODE_ARCH" != "arm64" ]]; then
  echo "Recall Desktop SDK for macOS requires Apple Silicon; found $NODE_ARCH." >&2
  exit 1
fi

ARCHIVE_NAME="node-$NODE_VERSION-darwin-$NODE_ARCH.tar.gz"
ARCHIVE_PATH="$CACHE_ROOT/$ARCHIVE_NAME"
EXTRACTED_NAME="node-$NODE_VERSION-darwin-$NODE_ARCH"
EXTRACTED_PATH="$CACHE_ROOT/$EXTRACTED_NAME"
VERSION_URL="$DIST_BASE_URL/$NODE_VERSION"

mkdir -p "$CACHE_ROOT"

if [[ ! -f "$ARCHIVE_PATH" ]]; then
  curl -fsSL "$VERSION_URL/$ARCHIVE_NAME" -o "$ARCHIVE_PATH"
fi

EXPECTED_CHECKSUM="$(curl -fsSL "$VERSION_URL/SHASUMS256.txt" | awk -v archive="$ARCHIVE_NAME" '$2 == archive { print $1; exit }')"
ACTUAL_CHECKSUM="$(shasum -a 256 "$ARCHIVE_PATH" | awk '{ print $1 }')"

if [[ -z "$EXPECTED_CHECKSUM" || "$ACTUAL_CHECKSUM" != "$EXPECTED_CHECKSUM" ]]; then
  rm -f "$ARCHIVE_PATH"
  echo "Official Node archive checksum verification failed." >&2
  exit 1
fi

rm -rf "$EXTRACTED_PATH"
tar -xzf "$ARCHIVE_PATH" -C "$CACHE_ROOT"

rm -rf "$DESTINATION"
mkdir -p "$DESTINATION/bin"
cp "$EXTRACTED_PATH/bin/node" "$DESTINATION/bin/node"
cp "$EXTRACTED_PATH/LICENSE" "$DESTINATION/LICENSE"
chmod +x "$DESTINATION/bin/node"
