# GG Circuit agent guide

## Repository shape

GG Circuit is a pnpm and Cargo monorepo containing a React/TypeScript frontend and a Tauri/Rust backend.

- Frontend: `apps/desktop/src`
- Tauri application: `apps/desktop/src-tauri`
- Reusable Rust crates: `crates/gg-*`
- Runtime and developer helpers: `scripts`

Use Node.js 24, pnpm 10.12.1, and the Rust toolchain pinned in `rust-toolchain.toml`.

## Codex environment

For Codex cloud, configure:

- Setup script: `bash scripts/codex-setup.sh`
- Maintenance script: `bash scripts/codex-setup.sh --maintenance`

The setup installs the Linux dependencies required by Tauri, installs locked pnpm and Cargo dependencies, fetches the bundled Python runtime used by the application, builds the frontend, and precompiles the Rust tests.

Do not skip the root `pnpm install` postinstall step: it populates `apps/desktop/src-tauri/runtime`, which is intentionally not committed.

## Validation

Use locked dependency resolution. Do not run `pnpm test`; this repository does not currently define a JavaScript test script.

For frontend-only changes, run:

```sh
pnpm format:check
pnpm --filter @gg/desktop lint
pnpm --filter @gg/desktop build
```

For Rust changes, first ensure `apps/desktop/dist` exists because `tauri::generate_context!` embeds the frontend output, then run:

```sh
pnpm --filter @gg/desktop build
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
```

For cross-stack, dependency, build-system, or release changes, run the complete suite:

```sh
bash scripts/codex-setup.sh --verify
```

When only documentation changes, run Prettier against the changed Markdown files at minimum.

## Generated and downloaded content

Do not commit generated or downloaded directories such as:

- `node_modules`
- `apps/desktop/dist`
- `target`
- `apps/desktop/src-tauri/runtime`

Do not hand-edit lockfiles unless a dependency change requires it. Keep `package.json`, `pnpm-lock.yaml`, `Cargo.toml`, and `Cargo.lock` synchronized.

## Change discipline

- Keep frontend service calls and matching Tauri commands consistent across the TypeScript/Rust boundary.
- Put durable backend behavior in the relevant `crates/gg-*` crate rather than directly in a Tauri command wrapper.
- Add or update Rust tests near the affected crate behavior.
- Prefer the smallest relevant validation set while iterating, then run the required final checks before reporting completion.
- Report every command run and any check that could not be executed.
