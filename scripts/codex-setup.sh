#!/usr/bin/env bash
# Prepare the GG Circuit monorepo for OpenAI Codex cloud tasks.
#
# Codex environment settings:
#   Setup script:       bash scripts/codex-setup.sh
#   Maintenance script: bash scripts/codex-setup.sh --maintenance
#
# The setup phase has internet access, so this script installs the Linux/Tauri
# build prerequisites, pins the toolchains used by CI, installs locked project
# dependencies, fetches the bundled Python runtime, and warms the build caches.
set -Eeuo pipefail

MODE="setup"
case "${1:-}" in
  "") ;;
  --maintenance) MODE="maintenance" ;;
  --verify) MODE="verify" ;;
  *)
    echo "Usage: $0 [--maintenance|--verify]" >&2
    exit 2
    ;;
esac

log() {
  printf '\n[codex-setup] %s\n' "$*"
}

fail() {
  printf '\n[codex-setup] ERROR: %s\n' "$*" >&2
  exit 1
}

run_as_root() {
  if [[ "${EUID}" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    fail "Root privileges are required to install system packages, but sudo is unavailable."
  fi
}

append_once() {
  local line="$1"
  local file="$2"
  mkdir -p "$(dirname "$file")"
  touch "$file"
  grep -Fqx "$line" "$file" || printf '%s\n' "$line" >> "$file"
}

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
cd "$REPO_ROOT"

NODE_MAJOR=24
PNPM_VERSION=10.12.1
RUST_TOOLCHAIN=1.96.0

install_system_dependencies() {
  if ! command -v apt-get >/dev/null 2>&1; then
    fail "This setup script currently supports the Ubuntu/Debian Codex cloud image (apt-get required)."
  fi

  log "Installing Tauri and native build dependencies"
  run_as_root apt-get update
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    cmake \
    curl \
    file \
    libayatana-appindicator3-dev \
    librsvg2-dev \
    libssl-dev \
    libwebkit2gtk-4.1-dev \
    libxdo-dev \
    pkg-config \
    wget
}

load_nvm() {
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    # shellcheck disable=SC1090
    source "$NVM_DIR/nvm.sh"
    return 0
  fi
  return 1
}

ensure_node() {
  local actual_major=""
  if command -v node >/dev/null 2>&1; then
    actual_major="$(node -p 'process.versions.node.split(".")[0]')"
  fi

  if [[ "$actual_major" == "$NODE_MAJOR" ]]; then
    log "Node.js $(node --version) already matches CI"
    return
  fi

  log "Selecting Node.js ${NODE_MAJOR}"
  if load_nvm; then
    nvm install "$NODE_MAJOR"
    nvm alias default "$NODE_MAJOR"
    nvm use "$NODE_MAJOR"
  elif command -v mise >/dev/null 2>&1; then
    mise install "node@${NODE_MAJOR}"
    mise use --global "node@${NODE_MAJOR}"
    eval "$(mise activate bash)"
    append_once 'eval "$(mise activate bash)"' "$HOME/.bashrc"
  else
    fail "Node.js ${NODE_MAJOR} is required. In Codex environment settings, set the Node.js package version to ${NODE_MAJOR}."
  fi

  actual_major="$(node -p 'process.versions.node.split(".")[0]')"
  [[ "$actual_major" == "$NODE_MAJOR" ]] || fail "Expected Node.js ${NODE_MAJOR}, found $(node --version)."
}

ensure_pnpm() {
  local actual=""
  if command -v pnpm >/dev/null 2>&1; then
    actual="$(pnpm --version)"
  fi

  if [[ "$actual" == "$PNPM_VERSION" ]]; then
    log "pnpm ${PNPM_VERSION} already available"
    return
  fi

  log "Installing pnpm ${PNPM_VERSION}"
  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare "pnpm@${PNPM_VERSION}" --activate
  else
    mkdir -p "$HOME/.local"
    npm install --global --prefix "$HOME/.local" "pnpm@${PNPM_VERSION}"
    export PATH="$HOME/.local/bin:$PATH"
    append_once 'export PATH="$HOME/.local/bin:$PATH"' "$HOME/.bashrc"
  fi

  [[ "$(pnpm --version)" == "$PNPM_VERSION" ]] || fail "Could not activate pnpm ${PNPM_VERSION}."
}

ensure_rust() {
  if ! command -v rustup >/dev/null 2>&1; then
    fail "rustup is required. In Codex environment settings, enable a Rust package version or use the universal image."
  fi

  log "Installing Rust ${RUST_TOOLCHAIN} with clippy and rustfmt"
  rustup toolchain install "$RUST_TOOLCHAIN" \
    --profile minimal \
    --component clippy \
    --component rustfmt

  cargo "+${RUST_TOOLCHAIN}" --version
  rustc "+${RUST_TOOLCHAIN}" --version
}

install_project_dependencies() {
  log "Installing locked JavaScript dependencies and bundled Python runtime"
  CI=1 HUSKY=0 pnpm install --frozen-lockfile

  log "Fetching locked Rust dependencies"
  cargo "+${RUST_TOOLCHAIN}" fetch --locked
}

warm_build_caches() {
  # tauri::generate_context! embeds apps/desktop/dist during Rust compilation.
  log "Building the desktop frontend required by the Tauri crate"
  pnpm --filter @gg/desktop build

  log "Compiling Rust tests without running them"
  cargo "+${RUST_TOOLCHAIN}" test --workspace --locked --no-run
}

run_verification() {
  log "Running the full repository verification suite"
  pnpm format:check
  pnpm --filter @gg/desktop lint
  pnpm --filter @gg/desktop build
  cargo "+${RUST_TOOLCHAIN}" fmt --all --check
  cargo "+${RUST_TOOLCHAIN}" clippy --workspace --all-targets --locked -- -D warnings
  cargo "+${RUST_TOOLCHAIN}" test --workspace --locked
}

if [[ "$MODE" != "maintenance" ]]; then
  install_system_dependencies
fi

ensure_node
ensure_pnpm
ensure_rust
install_project_dependencies
warm_build_caches

if [[ "$MODE" == "verify" ]]; then
  run_verification
fi

log "Environment ready"
printf '%s\n' \
  "Node:  $(node --version)" \
  "pnpm:  $(pnpm --version)" \
  "Rust:  $(rustc +${RUST_TOOLCHAIN} --version)" \
  "Python runtime: apps/desktop/src-tauri/runtime/python/bin/python3" \
  "Run all checks: bash scripts/codex-setup.sh --verify"
