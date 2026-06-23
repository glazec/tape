#!/usr/bin/env sh
set -eu

if [ -z "${CLOUDFLARED_TOKEN:-}" ]; then
  echo "CLOUDFLARED_TOKEN is required" >&2
  exit 1
fi

export TUNNEL_TOKEN="$CLOUDFLARED_TOKEN"
exec cloudflared tunnel run
