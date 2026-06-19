# Bio Eng Studio 🧬

Bio Eng Studio is a desktop IDE for biological engineers. Write Python to simulate
engineered proteins, DNA, and RNA, and design genetic networks.

## Development

```sh
pnpm install
pnpm tauri dev
```

The desktop app lives in `apps/desktop` (React + Vite frontend, Tauri/Rust
backend) over a Cargo workspace of `bioeng-*` crates.
