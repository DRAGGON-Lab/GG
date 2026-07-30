#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DESTINATION="$REPO_ROOT/apps/desktop/src-tauri/runtime/grn-lean/analyze"

if [[ -n "${GG_GRN_LEAN_BIN:-}" ]]; then
  SOURCE="$GG_GRN_LEAN_BIN"
elif [[ -x "$REPO_ROOT/../../marpaia/grn-lean/.lake/build/bin/analyze" ]]; then
  SOURCE="$REPO_ROOT/../../marpaia/grn-lean/.lake/build/bin/analyze"
elif [[ -x "$REPO_ROOT/../grn-lean/.lake/build/bin/analyze" ]]; then
  SOURCE="$REPO_ROOT/../grn-lean/.lake/build/bin/analyze"
else
  echo "grn-lean analyzer not found. Build it with 'lake build analyze' or set GG_GRN_LEAN_BIN." >&2
  exit 1
fi

mkdir -p "$(dirname "$DESTINATION")"
install -m 755 "$SOURCE" "$DESTINATION"
echo "Staged grn-lean analyzer at $DESTINATION"
