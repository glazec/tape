#!/usr/bin/env bash
set -euo pipefail
PACKAGE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT
CACHE_DIR="$HOME/Library/Caches/org.swift.swiftpm/artifacts"

for attempt in 1 2 3; do
  if swift package --package-path "$PACKAGE_DIR" resolve --force-resolved-versions 2>&1 | tee "$WORK_DIR/resolve.log"; then
    exit 0
  fi
  if [[ "$attempt" == 3 ]]; then exit 1; fi

  # Retry failed release asset downloads through GitHub's API. SwiftPM still
  # validates the archive against the dependency manifest before using it.
  if [[ -n "${GH_TOKEN:-}" ]]; then
    mkdir -p "$CACHE_DIR"
    while IFS= read -r url; do
      release_path="${url#https://github.com/}"
      repo="${release_path%%/releases/download/*}"
      tag_and_asset="${release_path#*/releases/download/}"
      tag="${tag_and_asset%%/*}"
      asset="${tag_and_asset#*/}"
      cache_key="$(printf '%s' "$url" | LC_ALL=C tr -c '[:alnum:]_' '_')"
      echo "Fetching $repo $tag $asset through the release asset API."
      if gh release download "$tag" --repo "$repo" --pattern "$asset" --output "$WORK_DIR/asset.zip" --clobber; then
        mv -f "$WORK_DIR/asset.zip" "$CACHE_DIR/$cache_key"
      fi
    done < <(sed -nE "s#.*failed downloading '(https://github\.com/(getsentry/sentry-cocoa|sparkle-project/Sparkle)/releases/download/[0-9.]+/[A-Za-z0-9.-]+\.zip)'.*#\1#p" "$WORK_DIR/resolve.log" | sort -u)
  fi
  sleep 5
done
