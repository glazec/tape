#!/usr/bin/env bash
set -euo pipefail

if [[ "${BUILD_CONFIGURATION:-debug}" == "release" ]]; then
  if [[ ! "${APP_VERSION:-}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    echo "Release builds require APP_VERSION in MAJOR.MINOR.PATCH format." >&2
    exit 1
  fi
fi

if [[ -n "${APP_VERSION:-}" ]]; then
  printf '%s\n' "$APP_VERSION"
  exit 0
fi

# Local rebuilds must not masquerade as an old published release.
RELEASE_TAG="$(git describe --tags --match 'mac-v[0-9]*.[0-9]*.[0-9]*' --abbrev=0 HEAD 2>/dev/null || true)"
RELEASE_VERSION="${RELEASE_TAG#mac-v}"
if [[ ! "$RELEASE_VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  RELEASE_VERSION="0.0.0"
fi
printf '%s-dev\n' "$RELEASE_VERSION"
