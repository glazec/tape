#!/usr/bin/env bash
# Renders the recorder window states to PNGs for design review.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:?usage: snapshot.sh <output-dir>}"
cd "$ROOT_DIR"
swift build -c debug >/dev/null
TAPE_DESKTOP_SNAPSHOT_DIR="$OUT_DIR" "$(swift build -c debug --show-bin-path)/MeetingNoteLocalRecorder"
