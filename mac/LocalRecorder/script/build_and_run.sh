#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
APP_NAME="MeetingNoteLocalRecorder"
BUNDLE_ID="tech.inevitable.meeting-note.local-recorder"
MIN_SYSTEM_VERSION="15.0"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
APP_ICON_SOURCE="$ROOT_DIR/Resources/AppIcon.icns"
SIDECAR_SOURCE="$ROOT_DIR/Sidecar"
SIDECAR_DEST="$APP_RESOURCES/RecallDesktopSDKSidecar"

cd "$ROOT_DIR"
pkill -x "$APP_NAME" >/dev/null 2>&1 || true

swift build
BUILD_BINARY="$(swift build --show-bin-path)/$APP_NAME"

rm -rf "$APP_BUNDLE"
mkdir -p "$APP_MACOS" "$APP_RESOURCES"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
if [[ -f "$APP_ICON_SOURCE" ]]; then
  cp "$APP_ICON_SOURCE" "$APP_RESOURCES/AppIcon.icns"
fi
if [[ -f "$SIDECAR_SOURCE/package.json" ]]; then
  npm install --prefix "$SIDECAR_SOURCE" --omit=dev
  rm -rf "$SIDECAR_DEST"
  mkdir -p "$SIDECAR_DEST"
  cp "$SIDECAR_SOURCE/package.json" "$SIDECAR_DEST/package.json"
  cp "$SIDECAR_SOURCE/package-lock.json" "$SIDECAR_DEST/package-lock.json"
  cp -R "$SIDECAR_SOURCE/src" "$SIDECAR_DEST/src"
  cp -R "$SIDECAR_SOURCE/node_modules" "$SIDECAR_DEST/node_modules"
fi
"$ROOT_DIR/script/bundle_node_runtime.sh" "$APP_RESOURCES/node"

cat >"$INFO_PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>$APP_NAME</string>
  <key>CFBundleIdentifier</key>
  <string>$BUNDLE_ID</string>
  <key>CFBundleName</key>
  <string>$APP_NAME</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Meeting Note records your microphone for local meeting recordings.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>Meeting Note records meeting audio so local recordings include other speakers.</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>$BUNDLE_ID.login</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>meetingnote-local-recorder</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST

# Prefer a stable signing certificate: TCC pins grants to the certificate,
# so microphone and screen capture stay granted across rebuilds. Create one
# with script/create_signing_cert.sh. Ad-hoc fallback pins grants to the
# per-build cdhash, which invalidates them silently on every binary change.
LOCAL_CERT_NAME="Meeting Note Local Dev"
if [[ -z "${CODESIGN_IDENTITY:-}" ]]; then
  if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$LOCAL_CERT_NAME"; then
    CODESIGN_IDENTITY="$LOCAL_CERT_NAME"
  else
    CODESIGN_IDENTITY="-"
    echo "No signing certificate found; using ad-hoc signing." >&2
    echo "Run script/create_signing_cert.sh once to stop macOS from dropping mic/screen permissions on every rebuild." >&2
  fi
fi
codesign --force --deep --sign "$CODESIGN_IDENTITY" --identifier "$BUNDLE_ID" "$APP_BUNDLE"

# Reset stale TCC grants when the signature identity changes, or on every
# binary change while ad-hoc signed. Otherwise macOS keeps the old grant for
# the bundle id and silently denies capture instead of prompting again.
SIGNATURE_CACHE="$ROOT_DIR/.build/last-app-signature"
NEW_CDHASH="$(codesign --display -vvv "$APP_BUNDLE" 2>&1 | awk -F= '/^CDHash=/ { print $2 }')"
if [[ "$CODESIGN_IDENTITY" == "-" ]]; then
  NEW_SIGNATURE="adhoc:$NEW_CDHASH"
else
  NEW_SIGNATURE="cert:$CODESIGN_IDENTITY"
fi
OLD_SIGNATURE="$(cat "$SIGNATURE_CACHE" 2>/dev/null || true)"
if [[ -n "$NEW_SIGNATURE" && "$NEW_SIGNATURE" != "$OLD_SIGNATURE" ]]; then
  echo "App signature changed; resetting microphone and screen capture permissions so macOS prompts again."
  tccutil reset Microphone "$BUNDLE_ID" >/dev/null 2>&1 || true
  tccutil reset ScreenCapture "$BUNDLE_ID" >/dev/null 2>&1 || true
fi
mkdir -p "$(dirname "$SIGNATURE_CACHE")"
printf '%s' "$NEW_SIGNATURE" >"$SIGNATURE_CACHE"

open_app() {
  /usr/bin/open -n "$APP_BUNDLE"
}

case "$MODE" in
  run)
    open_app
    ;;
  --debug|debug)
    lldb -- "$APP_BINARY"
    ;;
  --logs|logs)
    open_app
    /usr/bin/log stream --info --style compact --predicate "process == \"$APP_NAME\""
    ;;
  --telemetry|telemetry)
    open_app
    /usr/bin/log stream --info --style compact --predicate "subsystem == \"$BUNDLE_ID\""
    ;;
  --verify|verify)
    open_app
    sleep 1
    pgrep -x "$APP_NAME" >/dev/null
    ;;
  *)
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify]" >&2
    exit 2
    ;;
esac
