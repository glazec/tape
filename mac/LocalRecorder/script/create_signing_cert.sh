#!/usr/bin/env bash
set -euo pipefail

# Creates a self-signed code signing certificate in the login keychain.
# Signing with a stable certificate keeps macOS microphone and screen
# capture grants valid across rebuilds; ad-hoc signatures invalidate the
# grants every time the binary changes.

CERT_NAME="Meeting Note Local Dev"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"

# Apple's LibreSSL produces a PKCS12 the keychain can import. Homebrew
# OpenSSL 3 defaults to AES/PBKDF2 encryption, which makes `security
# import` fail with "MAC verification failed".
OPENSSL_BIN="/usr/bin/openssl"

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Do not run with sudo: the certificate must go into your login keychain, not root's." >&2
  exit 1
fi

if security find-identity -v -p codesigning 2>/dev/null | grep -qF "$CERT_NAME"; then
  echo "Signing identity \"$CERT_NAME\" already exists."
  exit 0
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat >"$TMP_DIR/openssl.cnf" <<EOF
[req]
distinguished_name = dn
x509_extensions = ext
prompt = no
[dn]
CN = $CERT_NAME
[ext]
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
basicConstraints = critical,CA:false
EOF

"$OPENSSL_BIN" req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP_DIR/key.pem" -out "$TMP_DIR/cert.pem" \
  -config "$TMP_DIR/openssl.cnf" 2>/dev/null

"$OPENSSL_BIN" pkcs12 -export -out "$TMP_DIR/cert.p12" \
  -inkey "$TMP_DIR/key.pem" -in "$TMP_DIR/cert.pem" \
  -passout pass:meetingnote -name "$CERT_NAME"

security import "$TMP_DIR/cert.p12" -k "$KEYCHAIN" -P meetingnote \
  -T /usr/bin/codesign >/dev/null

# Trust the certificate for code signing. macOS may show a confirmation
# dialog asking for your password.
if ! security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$TMP_DIR/cert.pem"; then
  echo "Could not set trust automatically. Open Keychain Access, find" >&2
  echo "\"$CERT_NAME\", expand Trust, and set Code Signing to Always Trust." >&2
  exit 1
fi

echo "Created signing identity \"$CERT_NAME\"."
