#!/usr/bin/env bash
# Fetch a relocatable CPython (python-build-standalone) and the uv package
# manager into the Tauri runtime resource dir, so GG Circuit ships one
# self-contained interpreter that powers both the editor LSP (python-lsp-server
# + ruff) and script execution, plus the uv binary that creates and manages a
# per-workspace `.venv`. Re-runnable: it replaces the runtime in place.
#
# With --if-missing, skip the fetch when a working runtime is already present.
# This is the install-time path (pnpm postinstall); an explicit run always
# refetches from scratch.
set -euo pipefail

IF_MISSING=0
if [ "${1:-}" = "--if-missing" ]; then
  IF_MISSING=1
fi

PBS_TAG="20260610"
PY_VERSION="3.12.13"
LSP_PACKAGES=("python-lsp-server" "python-lsp-ruff" "ruff" "jedi")
# A specific tag pins the binary; UV_VERSION=latest tracks the newest release.
UV_VERSION="${UV_VERSION:-latest}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUNTIME_DIR="$REPO_ROOT/apps/desktop/src-tauri/runtime"
PYTHON_DIR="$RUNTIME_DIR/python"
UV_DIR="$RUNTIME_DIR/uv"

if [ "$IF_MISSING" -eq 1 ] \
  && "$PYTHON_DIR/bin/python3" -c "import pylsp, ruff" >/dev/null 2>&1 \
  && [ -x "$UV_DIR/uv" ]; then
  echo "Python runtime and uv already present at $RUNTIME_DIR — skipping fetch."
  exit 0
fi

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64)  TRIPLE="aarch64-apple-darwin" ;;
  Darwin-x86_64) TRIPLE="x86_64-apple-darwin" ;;
  Linux-x86_64)  TRIPLE="x86_64-unknown-linux-gnu" ;;
  Linux-aarch64) TRIPLE="aarch64-unknown-linux-gnu" ;;
  *) echo "Unsupported platform: $(uname -s)-$(uname -m)" >&2; exit 1 ;;
esac

ASSET="cpython-${PY_VERSION}+${PBS_TAG}-${TRIPLE}-install_only.tar.gz"
URL="https://github.com/astral-sh/python-build-standalone/releases/download/${PBS_TAG}/${ASSET}"

echo "Fetching ${ASSET}"
rm -rf "$PYTHON_DIR"
mkdir -p "$RUNTIME_DIR"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$URL" -o "$TMP/python.tar.gz"
# The archive extracts to a top-level `python/` directory.
tar -xzf "$TMP/python.tar.gz" -C "$RUNTIME_DIR"

PYTHON_BIN="$PYTHON_DIR/bin/python3"
if [ ! -x "$PYTHON_BIN" ]; then
  echo "Expected interpreter at $PYTHON_BIN was not found" >&2
  exit 1
fi

echo "Installing language-server stack: ${LSP_PACKAGES[*]}"
"$PYTHON_BIN" -m pip install --upgrade pip >/dev/null
"$PYTHON_BIN" -m pip install "${LSP_PACKAGES[@]}"

echo "Verifying..."
"$PYTHON_BIN" -c "import pylsp, ruff; print('python', '$PY_VERSION', '+ pylsp + ruff OK')"
echo "Runtime ready at $PYTHON_DIR"

# uv: the package/environment manager. It creates and manages each workspace's
# `.venv` from the bundled interpreter and installs packages into it.
if [ "$UV_VERSION" = "latest" ]; then
  UV_URL="https://github.com/astral-sh/uv/releases/latest/download/uv-${TRIPLE}.tar.gz"
else
  UV_URL="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/uv-${TRIPLE}.tar.gz"
fi

echo "Fetching uv (${UV_VERSION}) for ${TRIPLE}"
rm -rf "$UV_DIR"
mkdir -p "$UV_DIR"
# The archive extracts to a top-level `uv-${TRIPLE}/` directory holding `uv`
# and `uvx`; --strip-components flattens them into UV_DIR.
curl -fsSL "$UV_URL" -o "$TMP/uv.tar.gz"
tar -xzf "$TMP/uv.tar.gz" -C "$UV_DIR" --strip-components 1

if [ ! -x "$UV_DIR/uv" ]; then
  echo "Expected uv binary at $UV_DIR/uv was not found" >&2
  exit 1
fi

echo "uv ready: $("$UV_DIR/uv" --version)"
