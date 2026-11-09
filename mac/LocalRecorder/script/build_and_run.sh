#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-run}"
PRODUCT_NAME="MeetingNoteLocalRecorder"
APP_NAME="$PRODUCT_NAME"
APP_DISPLAY_NAME="Tape Desktop"
BUNDLE_ID="tech.inevitable.meeting-note.local-recorder"
MIN_SYSTEM_VERSION="15.0"
APP_VERSION="${APP_VERSION:-0.2.0}"
BUILD_VERSION="${BUILD_VERSION:-$(date -u +%Y%m%d%H%M%S)}"
BUILD_CONFIGURATION="${BUILD_CONFIGURATION:-debug}"
LOGIN_SCHEME="meetingnote-local-recorder"
AUTOMATIC_UPDATES=true
if [[ "$BUILD_CONFIGURATION" != "release" ]]; then
  APP_NAME="MeetingNoteLocalRecorderDev"
  APP_DISPLAY_NAME="Tape Desktop Dev"
  BUNDLE_ID="tech.inevitable.meeting-note.local-recorder.dev"
  LOGIN_SCHEME="meetingnote-local-recorder-dev"
  AUTOMATIC_UPDATES=false
fi
SENTRY_DSN="${SENTRY_DSN:-${NEXT_PUBLIC_SENTRY_DSN:-}}"
if [[ "$BUILD_CONFIGURATION" == "release" ]]; then
  SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-production}"
  if [[ ! "$SENTRY_DSN" =~ ^https://[^[:space:]]+@[^[:space:]]+/[0-9]+$ ]]; then
    echo "Release builds require a valid HTTPS SENTRY_DSN for desktop error reporting." >&2
    exit 1
  fi
else
  SENTRY_ENVIRONMENT="${SENTRY_ENVIRONMENT:-development}"
fi
SPARKLE_FEED_URL="https://github.com/glazec/tape/releases/download/macos-appcast/appcast.xml"
SPARKLE_PUBLIC_KEY="C+6MwGr+m9w8H9o0A6dX6epFkSNcf5OOdT70ir8SVFA="

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIST_DIR="$ROOT_DIR/dist"
APP_BUNDLE="$DIST_DIR/$APP_DISPLAY_NAME.app"
LEGACY_APP_BUNDLE="$DIST_DIR/$APP_NAME.app"
APP_CONTENTS="$APP_BUNDLE/Contents"
APP_MACOS="$APP_CONTENTS/MacOS"
APP_RESOURCES="$APP_CONTENTS/Resources"
APP_FRAMEWORKS="$APP_CONTENTS/Frameworks"
APP_BINARY="$APP_MACOS/$APP_NAME"
INFO_PLIST="$APP_CONTENTS/Info.plist"
APP_ICON_SOURCE="$ROOT_DIR/Resources/AppIcon.icns"
NODE_ENTITLEMENTS="$ROOT_DIR/Resources/Node.entitlements"
ADHOC_APP_ENTITLEMENTS="$ROOT_DIR/Resources/AdHocApp.entitlements"
SIDECAR_SOURCE="$ROOT_DIR/Sidecar"
SIDECAR_DEST="$APP_RESOURCES/RecallDesktopSDKSidecar"

# Check identity before stopping an app or replacing a bundle. The certificate
# name is insufficient: a newly created certificate can reuse that name.
if [[ "$BUILD_CONFIGURATION" == "release" ]]; then
  RELEASE_CERT_SHA1="$(sed -n 's/.*certificate leaf = H"\([^" ]*\)".*/\1/p' "$ROOT_DIR/Resources/Release.requirement" | tr '[:lower:]' '[:upper:]')"
  CODESIGN_IDENTITY="$(printf '%s' "${CODESIGN_IDENTITY:-$RELEASE_CERT_SHA1}" | tr '[:lower:]' '[:upper:]')"
  if [[ "$CODESIGN_IDENTITY" != "$RELEASE_CERT_SHA1" ]]; then
    echo "Refusing a different signing identity for the production app. Use the existing release certificate fingerprint." >&2
    exit 1
  fi
  if ! security find-identity -v -p codesigning | grep -qF "$RELEASE_CERT_SHA1"; then
    echo "The existing release certificate and private key are required. No app or permission was changed." >&2
    exit 1
  fi
else
  CODESIGN_IDENTITY="${CODESIGN_IDENTITY:-Meeting Note Local Dev}"
  if ! security find-identity -v -p codesigning | grep -qF "$CODESIGN_IDENTITY"; then
    echo "A stable development signing identity is required. Run script/create_signing_cert.sh once." >&2
    exit 1
  fi
fi

cd "$ROOT_DIR"
if [[ "$MODE" != "--package" && "$MODE" != "package" ]]; then
  pkill -x "$APP_NAME" >/dev/null 2>&1 || true
fi

swift build -c "$BUILD_CONFIGURATION"
BUILD_DIR="$(swift build -c "$BUILD_CONFIGURATION" --show-bin-path)"
BUILD_BINARY="$BUILD_DIR/$PRODUCT_NAME"
SPARKLE_FRAMEWORK="$BUILD_DIR/Sparkle.framework"

rm -rf "$APP_BUNDLE"
if [[ "$BUILD_CONFIGURATION" == "release" ]]; then rm -rf "$LEGACY_APP_BUNDLE"; fi
mkdir -p "$APP_MACOS" "$APP_RESOURCES" "$APP_FRAMEWORKS"
cp "$BUILD_BINARY" "$APP_BINARY"
chmod +x "$APP_BINARY"
if [[ ! -d "$SPARKLE_FRAMEWORK" ]]; then
  echo "Sparkle.framework was not produced by the Swift build." >&2
  exit 1
fi
cp -R "$SPARKLE_FRAMEWORK" "$APP_FRAMEWORKS/Sparkle.framework"
install_name_tool -add_rpath "@executable_path/../Frameworks" "$APP_BINARY"
if [[ -f "$APP_ICON_SOURCE" ]]; then
  cp "$APP_ICON_SOURCE" "$APP_RESOURCES/AppIcon.icns"
fi
if [[ -d "$ROOT_DIR/Resources/Fonts" ]]; then
  cp -R "$ROOT_DIR/Resources/Fonts" "$APP_RESOURCES/Fonts"
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
  <key>CFBundleDisplayName</key>
  <string>$APP_DISPLAY_NAME</string>
  <key>CFBundleName</key>
  <string>$APP_DISPLAY_NAME</string>
  <key>CFBundleShortVersionString</key>
  <string>$APP_VERSION</string>
  <key>CFBundleVersion</key>
  <string>$BUILD_VERSION</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>SUFeedURL</key>
  <string>$SPARKLE_FEED_URL</string>
  <key>SUPublicEDKey</key>
  <string>$SPARKLE_PUBLIC_KEY</string>
  <key>SUEnableAutomaticChecks</key>
  <$AUTOMATIC_UPDATES/>
  <key>SUAutomaticallyUpdate</key>
  <$AUTOMATIC_UPDATES/>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>LSMinimumSystemVersion</key>
  <string>$MIN_SYSTEM_VERSION</string>
  <key>NSPrincipalClass</key>
  <string>NSApplication</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>$APP_DISPLAY_NAME records your microphone for local meeting recordings.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>$APP_DISPLAY_NAME prepares your browser or Zoom for background meeting capture when you enable it.</string>
  <key>NSScreenCaptureUsageDescription</key>
  <string>$APP_DISPLAY_NAME records meeting audio so local recordings include other speakers.</string>
  <key>NSAudioCaptureUsageDescription</key>
  <string>$APP_DISPLAY_NAME records meeting audio so local recordings include other speakers.</string>
  <key>CFBundleURLTypes</key>
  <array>
    <dict>
      <key>CFBundleURLName</key>
      <string>$BUNDLE_ID.login</string>
      <key>CFBundleURLSchemes</key>
      <array>
        <string>$LOGIN_SCHEME</string>
      </array>
    </dict>
  </array>
</dict>
</plist>
PLIST
/usr/libexec/PlistBuddy -c "Add :SentryDSN string $SENTRY_DSN" "$INFO_PLIST"
/usr/libexec/PlistBuddy -c "Add :SentryEnvironment string $SENTRY_ENVIRONMENT" "$INFO_PLIST"


sign_code() {
  local target="$1"
  shift
  local arguments=(--force --options runtime --timestamp --sign "$CODESIGN_IDENTITY")
  codesign "${arguments[@]}" "$@" "$target"
}

# codesign --deep only discovers nested code in standard bundle locations.
# The Node and Recall SDK binaries live under Resources, so sign every Mach-O
# there explicitly before sealing the app bundle.
while IFS= read -r -d '' target; do
  if /usr/bin/file "$target" | /usr/bin/grep -q "Mach-O"; then
    if [[ "$target" == "$APP_RESOURCES/node/bin/node" ]]; then
      sign_code "$target" --entitlements "$NODE_ENTITLEMENTS"
    elif [[ "$(basename "$target")" == "desktop_sdk_macos_exe" ]]; then
      # Locally signed helpers have no Apple Team ID. Like the app, the SDK
      # executable must be allowed to load its bundled, locally signed dylibs.
      sign_code "$target" --entitlements "$ADHOC_APP_ENTITLEMENTS"
    else
      sign_code "$target"
    fi
  fi
done < <(find "$APP_RESOURCES" -type f -print0)

codesign \
  --force \
  --deep \
  --options runtime \
  --timestamp \
  --entitlements "$ADHOC_APP_ENTITLEMENTS" \
  --sign "$CODESIGN_IDENTITY" \
  "$APP_BUNDLE"
if [[ "$BUILD_CONFIGURATION" == "release" ]]; then
  "$ROOT_DIR/script/verify_release_identity.sh" "$APP_BUNDLE"
else
  codesign --verify --deep --strict "$APP_BUNDLE"
fi

if [[ "$MODE" == "--package" || "$MODE" == "package" ]]; then
  printf '%s\n' "$APP_BUNDLE"
  exit 0
fi

# Never reset macOS permissions as a side effect of building or launching.
# A missing worktree cache does not mean the installed app identity changed.
# Explicit recovery in the app resets only the permission the user selects.


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
    echo "usage: $0 [run|--debug|--logs|--telemetry|--verify|--package]" >&2
    exit 2
    ;;
esac
