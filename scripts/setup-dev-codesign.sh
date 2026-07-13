#!/usr/bin/env bash
# One-time developer setup (macOS): install a signing identity so dev builds
# carry a stable code signature (see scripts/macos-dev-runner.sh).
#
# The preferred identity is an "Apple Development" certificate — its signature
# carries a team ID, which is the only way keychain access approvals fully
# survive rebuilds (securityd pins items to the exact build hash of
# non-Apple-signed apps). Create one with any free Apple ID: Xcode → Settings
# → Accounts → add your Apple ID → Manage Certificates… → + → Apple
# Development. The runner picks it up automatically. If such a cert is present
# but macOS can't validate it — commonly because the WWDR G3 intermediate that
# issued it is missing, leaving only the legacy G1 (expired Feb 2023) — this
# script installs that intermediate so the cert becomes usable.
#
# Failing that, this script installs a self-signed "GG Circuit Dev Signing"
# identity as a fallback. It keeps the signature stable, but the keychain
# will still re-prompt once after each rebuild.
set -euo pipefail

IDENTITY="GG Circuit Dev Signing"
KEYCHAIN="$HOME/Library/Keychains/login.keychain-db"
WWDR_G3_URL="https://www.apple.com/certificateauthority/AppleWWDRCAG3.cer"

# True when an "Apple Development" cert is installed AND trusted for code
# signing. `find-identity -v` lists only valid identities, so a cert whose
# chain doesn't validate is excluded here even though its key is present.
apple_dev_valid() {
  security find-identity -v -p codesigning | grep -q "Apple Development"
}

if apple_dev_valid; then
  echo "An 'Apple Development' identity is installed; dev builds will use it."
  echo "No further setup is needed."
  exit 0
fi

# An "Apple Development" cert may be present yet fail to validate because the
# WWDR G3 intermediate that issued it is missing (many machines carry only the
# legacy G1, expired Feb 2023). The cert is then hidden from `find-identity -v`
# and the runner silently falls back to the self-signed identity. Install the
# intermediate and re-check before giving up on the real cert. `-p` (without
# `-v`) lists identities regardless of trust, so it sees the present cert.
if security find-identity -p codesigning | grep -q "Apple Development"; then
  echo "An 'Apple Development' cert is present but not trusted for code signing"
  echo "(its WWDR G3 intermediate is missing). Installing the intermediate..."
  TMP_G3=$(mktemp -d)
  if curl -fsSL -o "$TMP_G3/g3.cer" "$WWDR_G3_URL"; then
    security import "$TMP_G3/g3.cer" -k "$KEYCHAIN" >/dev/null 2>&1 || true
  else
    echo "Could not download the WWDR G3 intermediate from Apple."
  fi
  rm -rf "$TMP_G3"
  if apple_dev_valid; then
    echo "Installed WWDR G3; the 'Apple Development' identity is now valid."
    echo "Dev builds will use it. No further setup is needed."
    exit 0
  fi
  echo "The 'Apple Development' cert still won't validate; falling back to the"
  echo "self-signed identity below."
fi

echo "No usable 'Apple Development' identity. For prompt-free keychain access,"
echo "create one (free Apple ID): Xcode → Settings → Accounts → add your"
echo "Apple ID → Manage Certificates… → + → Apple Development."
echo
echo "Installing the self-signed fallback identity instead..."

if security find-identity -v -p codesigning "$KEYCHAIN" | grep -q "$IDENTITY"; then
  echo "'$IDENTITY' is already installed."
  exit 0
fi

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
  -keyout "$TMP/key.pem" -out "$TMP/cert.pem" \
  -subj "/CN=$IDENTITY" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=critical,codeSigning"

# macOS `security import` cannot parse OpenSSL 3's default PKCS12 encryption;
# pin the legacy SHA1/3DES algorithms it understands.
openssl pkcs12 -export -out "$TMP/identity.p12" \
  -inkey "$TMP/key.pem" -in "$TMP/cert.pem" -passout pass:gg-dev \
  -certpbe PBE-SHA1-3DES -keypbe PBE-SHA1-3DES -macalg sha1

security import "$TMP/identity.p12" -k "$KEYCHAIN" -P gg-dev -T /usr/bin/codesign

# Mark the certificate trusted for code signing (macOS asks for your login
# password once).
security add-trusted-cert -p codeSign -k "$KEYCHAIN" "$TMP/cert.pem"

echo "Installed '$IDENTITY'."
echo "The first build may show a 'codesign wants to sign' dialog — click Always Allow."
