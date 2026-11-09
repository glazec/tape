#!/usr/bin/env bash
set -euo pipefail
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Release asset downloads can fail transiently on hosted runners. Keep the
# successful downloads and retry resolution before compiling or running tests.
for attempt in 1 2 3 4; do
  if SWIFTPM_MAX_CONCURRENT_OPERATIONS=2 swift package --package-path "$PACKAGE_DIR" resolve --force-resolved-versions; then
    exit 0
  fi
  if [[ "$attempt" == 4 ]]; then exit 1; fi
  echo "Swift dependency resolution failed on attempt $attempt. Retrying." >&2
  sleep 5
done
