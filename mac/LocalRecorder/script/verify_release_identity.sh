#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="${1:?usage: verify_release_identity.sh <app>}"
REQUIREMENT="$(cat "$ROOT_DIR/Resources/Release.requirement")"
# Satisfying the old requirement preserves existing grants. Keeping the new
# designated requirement identical also preserves grants made on first install.
codesign --verify --deep --strict --test-requirement "=$REQUIREMENT" "$APP_BUNDLE"
ACTUAL_REQUIREMENT="$(codesign -d -r- "$APP_BUNDLE" 2>&1 | sed -n 's/^designated => //p')"
if [[ "$ACTUAL_REQUIREMENT" != "$REQUIREMENT" ]]; then
  echo "App identity changed. Refusing a build that would invalidate saved permissions." >&2
  exit 1
fi
