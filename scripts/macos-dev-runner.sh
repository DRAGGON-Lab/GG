#!/usr/bin/env bash
# Cargo runner (macOS): re-sign the app binary with a stable identity before
# launching it. Without this, dev binaries are ad-hoc signed and every rebuild
# looks like a new app to the keychain, so access approvals never persist.
#
# An "Apple Development" identity (free Apple ID, created via Xcode) is
# preferred: its signature carries a team ID, so the keychain records a stable
# "teamid:" partition for items and approvals survive rebuilds. The
# self-signed "GG Circuit Dev Signing" identity (scripts/setup-dev-codesign.sh)
# is the fallback, but securityd pins keychain items to the exact build hash
# of non-Apple-signed apps, so the keychain still re-prompts after a rebuild.
# If neither identity is present, the binary launches unsigned as before.
set -euo pipefail

if [ -n "${GG_RUNNER_DEBUG:-}" ]; then echo "runner-invoked: $1" >&2; fi

BIN="$1"

pick_identity() {
  security find-identity -v -p codesigning |
    awk '/Apple Development/ {print $2; exit}'
}

pick_fallback_identity() {
  security find-identity -v -p codesigning |
    awk '/GG Circuit Dev Signing/ {print $2; exit}'
}

if [ "$(basename "$BIN")" = "gg-circuit" ]; then
  IDENTITY=$(pick_identity)
  if [ -z "$IDENTITY" ]; then IDENTITY=$(pick_fallback_identity); fi
  if [ -n "$IDENTITY" ]; then
    codesign --force --sign "$IDENTITY" --identifier org.draggonlab.gg "$BIN"
  fi
fi

exec "$@"
