# Bio Eng Studio 🧬

Bio Eng Studio is a desktop IDE for biological engineers. It combines a React/Tauri workbench, a Rust service layer, local Python execution, AI-assisted editing, SQLite-backed persistence, and backup tooling so users can write Python for biological simulations, inspect project data, and iterate with an assistant in one native application.

## Get started

```sh
pnpm install
pnpm tauri dev
```


## What you can do with Bio Eng Studio

- **Edit scientific code and notes** in a Monaco-powered workspace editor with file exploration, tabs, splits, Python language support, diagnostics, output, and history panels.
- **Run Python locally** in two ways:
  - a lightweight browser-worker REPL powered by Pyodide for quick calculations and package experiments;
  - a desktop Python runner for workspace scripts, including captured matplotlib figures in the editor output panel.
- **Use AI assistance** through conversation threads, contextual attachments, permission prompts, tool-call transcripts, provider credentials, long-term memory, skills, and MCP server integrations.
- **Inspect the app database** from the UI with table browsing, schema views, SQL console execution, query history, CSV/JSON result copying, editable cells, and row deletion controls.
- **Manage application settings** for AI providers, backup and recovery, AI memory, skills, MCP servers, text-editor appearance/keymaps, activity-bar ordering, and light/dark/system themes.
- **Create and restore backups** using the Rust backup engine and desktop settings surfaces.

## File tree orientation

This repository is a pnpm + Cargo monorepo. The most important directories are:

```text
bioeng-studio/
├── apps/
│   └── desktop/                 # Tauri desktop app package
│       ├── src/                 # React/TypeScript frontend
│       │   ├── app/             # Application root, providers, global CSS
│       │   ├── commands/        # Command palette items and filtering
│       │   ├── features/        # Product areas: AI, editor, Python, DB, settings, backup
│       │   ├── lib/             # Shared frontend helpers
│       │   ├── pages/           # Page registry, lazy loading, activity metadata
│       │   ├── shell/           # Activity bar and top bar
│       │   ├── ui/              # Design-system primitives, icons, theme, Monaco setup
│       │   └── workbench/       # Dockview tab/split orchestration
│       ├── src-tauri/           # Rust Tauri backend for the desktop app
│       │   ├── src/agent/       # Agent runtime, tools, permissions, prompts, sessions
│       │   ├── src/ai/          # AI conversation and memory commands
│       │   ├── src/backup/      # Backup commands and scheduler hooks
│       │   ├── src/inspector/   # Database-inspector commands
│       │   ├── src/mcp/         # MCP registry and command bridge
│       │   ├── src/python/      # Desktop Python runtime commands
│       │   ├── src/secrets/     # Credential storage and provider key commands
│       │   ├── src/settings/    # App settings commands
│       │   ├── src/skills/      # Skill CRUD and loading
│       │   └── src/workspace/   # Workspace history bridge
│       └── vendor/pyodide/      # Vendored Pyodide wheels used by the frontend REPL
├── crates/
│   ├── bioeng-agent/            # Provider client, streaming parser, shared agent protocol
│   ├── bioeng-backup/           # Backup manifests, stores, encryption, restore engine
│   ├── bioeng-data/             # SQLite database, migrations, settings, AI memory, MCP storage
│   ├── bioeng-pyenv/            # Python runtime helpers and matplotlib-capturing runner
│   ├── bioeng-python-lsp/       # Python LSP protocol/client helpers
│   └── bioeng-workspace/        # Workspace snapshots, staging, retention, restore history
├── scripts/                     # Developer/runtime helper scripts
├── Cargo.toml                   # Rust workspace definition
├── package.json                 # Root pnpm scripts and JS tooling
├── pnpm-workspace.yaml          # pnpm workspace packages
└── README.md                    # This guide
```

## Technologies used

### Application architecture

- **Tauri 2** provides the native desktop shell and secure command bridge between the web UI and Rust backend.
- **React 19 + TypeScript** implement the frontend UI as a feature-oriented single-page application.
- **Vite 7** builds and serves the desktop webview frontend during development.
- **Rust Cargo workspace** organizes backend/domain code into reusable crates plus the Tauri app crate.
- **pnpm workspaces** manage JavaScript packages and scripts across the monorepo.

### UI and frontend engineering

- **Monaco Editor** powers the code editors for Python, SQL, and workspace files.
- **Dockview** provides draggable tabs, persistent panels, and split layouts across pages.
- **Tailwind CSS 4 utility classes** and local CSS variables define the app theme and layout styling.
- **Base UI**, **lucide-react**, and custom primitives in `apps/desktop/src/ui` form the component system.
- **React Markdown + remark/rehype + KaTeX** render AI responses with GitHub-flavored Markdown and math.

### Backend, data, and runtime

- **Rust + Tauri commands** expose database, settings, backup, AI, MCP, secret, skill, workspace, and Python operations to the frontend.
- **SQLite via `bioeng-data`** stores settings, AI conversations/memory, MCP configuration, and app data.
- **Pyodide** runs a persistent in-browser Python REPL in a web worker for fast offline evaluations.
- **Local Python runtime support** runs workspace scripts from the desktop side and captures matplotlib figures as base64 PNG output.
- **MCP support** lets configured Model Context Protocol servers contribute external tools to the assistant.
- **Secret storage** stores AI provider credentials without keeping raw keys in normal settings.

### Developer tooling

- **ESLint** checks frontend code quality.
- **Prettier** formats JS/TS/Markdown/CSS and other supported files.
- **rustfmt** formats Rust code.
- **Husky + lint-staged** format staged files before commits.

## Feature walkthrough

### Workbench, navigation, and commands

The app starts in a desktop workbench with an activity bar, top bar, command palette, and Dockview-powered tab area. Pages are registered in `apps/desktop/src/pages/page-registry.ts` and currently include **AI**, **Editor**, **Python**, **Database**, and **Settings**. Users can open pages normally, split pages to the right or below, move active tabs between split positions, and switch appearance modes from the command palette.

Useful interactions:

- Activity bar buttons open top-level pages.
- `Cmd/Ctrl + number` activates ordered activity-bar items.
- The command palette exposes page navigation, split actions, Python access, and theme commands.
- Settings can reorder or hide activity-bar items.

### Editor page

The Editor page is the workspace-centered development surface. It supports:

- choosing/opening a workspace folder;
- browsing files in an explorer;
- opening supported text files in Monaco tabs;
- saving file changes through Tauri filesystem APIs;
- running Python scripts;
- viewing stdout/stderr and generated matplotlib figures;
- Python runtime status and environment information;
- diagnostics from the Python service/LSP integration;
- assistant and checkpoint-review panels;
- proposed AI edits and inline diff/review flows;
- workspace history snapshots and file restore operations.

The editor frontend lives mainly in `apps/desktop/src/features/editor`, while workspace snapshot/restore logic lives in `crates/bioeng-workspace` and the Tauri bridge under `apps/desktop/src-tauri/src/workspace`.

### Python page

The Python page is a persistent REPL-like scratchpad for quick calculations. It runs Pyodide in a web worker and keeps Python globals alive across evaluations until the session is reset.

Existing capabilities include:

- evaluating snippets with `Cmd/Ctrl + Enter`;
- preserving variables between cells;
- resetting the Python session;
- displaying stdout, stderr, warnings, errors, result text, repr, type names, elapsed time, runtime version, and loaded packages;
- copying result values;
- installing packages from Python through the provided `bioeng_packages.install(...)` helper when supported by Pyodide/micropip;
- using vendored/offline Pyodide assets from `apps/desktop/vendor/pyodide`.

For longer workspace scripts, use the Editor page runner rather than the scratchpad.

### AI page and assistant surfaces

The AI page provides general conversation threads and the Editor page embeds an assistant panel for workspace-aware help. The backend agent stack is split between `crates/bioeng-agent` and `apps/desktop/src-tauri/src/agent`.

Existing capabilities include:

- creating, listing, opening, renaming, and deleting AI conversations;
- streaming responses from configured providers;
- switching conversation modes;
- attaching context to a conversation or opening AI with context from another page;
- showing tool-call cards and assistant transcripts;
- interrupting an active agent run;
- responding to permission prompts and workspace requests;
- storing and editing AI memory conclusions;
- adding custom skills and exposing them to the agent;
- connecting MCP servers and routing MCP tools through the assistant.

AI provider keys are configured in Settings and stored through the secret-management commands.

### Database page

The Database page is an internal SQLite inspector for the app database. It is useful for understanding what the app is storing and for debugging data-driven features.

Existing capabilities include:

- overview of database path, size, schema version, and tables;
- filtering tables in the sidebar;
- toggling internal table visibility;
- browsing table rows with pagination;
- sorting rows by columns;
- viewing table schema, columns, indexes, foreign keys, triggers, and DDL;
- running SQL in a console;
- keeping SQL query history;
- copying query results as CSV or JSON;
- entering edit mode to update cells;
- deleting selected rows with confirmation.

The frontend service layer is in `apps/desktop/src/features/database/core`, and the Rust inspector implementation is in `crates/bioeng-data/src/database/inspector.rs` with Tauri command wrappers under `apps/desktop/src-tauri/src/inspector`.

### Settings page

Settings centralizes app configuration. It currently covers:

- AI provider key status, saving, and deletion;
- backup/recovery configuration;
- AI memory review, editing, enable/disable, and deletion;
- skill creation/editing/deletion;
- MCP server configuration;
- text-editor font, font size, theme, and keymap preferences;
- activity-bar ordering and visibility;
- light, dark, and system appearance through the theme toggle/commands.

Settings are persisted by the Rust data layer and consumed by frontend providers.

### Backup and restore

Backup support is implemented as both a Rust crate and a Settings UI section. The backup engine includes manifest handling, local filesystem stores, encryption, retention, attachment handling, restore planning, restore execution, task status, activity history, and scheduler hooks.

### Skills and MCP

Bio Eng Studio includes two extension mechanisms for AI work:

- **Skills** are local instructions/files managed by the app and loaded by the assistant when relevant.
- **MCP servers** are external tool providers configured in settings and connected by the Tauri backend.

These are useful places to teach the assistant domain-specific lab workflows, project conventions, or integrations with external services.

## How the pieces fit together

1. `apps/desktop/src/app/main.tsx` boots React and app providers.
2. `apps/desktop/src/app/App.tsx` renders the shell, command palette, activity bar, and workbench.
3. `apps/desktop/src/pages/page-registry.ts` defines available pages and lazy-loads feature entry points.
4. Feature components call frontend service modules such as `database-service.ts`, `python-service.ts`, or `agent-client.ts`.
5. Service modules call Tauri commands exposed by `apps/desktop/src-tauri/src/*/commands.rs`.
6. Tauri commands delegate durable work to crates under `crates/bioeng-*`.
7. Persistent data is stored in SQLite; credentials go through secret storage; workspace files are accessed through Tauri filesystem APIs.

## Getting started as a user

### Prerequisites

Install the following on your machine:

- Node.js compatible with the workspace tooling;
- pnpm `10.12.1` or newer matching `package.json`;
- Rust with the toolchain in `rust-toolchain.toml`;
- platform-specific Tauri prerequisites for your OS;
- Python runtime support if you want to run desktop-side workspace scripts.

### Install dependencies

```sh
pnpm install
```

The root `postinstall` script fetches the Python runtime assets if they are missing.

### Run the desktop app in development

```sh
pnpm dev
```

This delegates to the desktop package and starts Tauri development mode.

### Run only the web frontend preview/dev server

```sh
pnpm desktop:web:dev
```

This is useful for frontend layout work, but desktop-only Tauri commands will not work outside the Tauri runtime.

### Build

```sh
pnpm build
```

For a packaged desktop bundle, run:

```sh
pnpm desktop:bundle
```

## Development commands

From the repository root:

```sh
pnpm install          # install JS dependencies and fetch missing runtime assets
pnpm dev              # run the Tauri desktop app in development
pnpm build            # build all workspace packages
pnpm desktop:build    # type-check and build the desktop frontend
pnpm desktop:bundle   # build a Tauri desktop bundle
pnpm format           # format supported files with Prettier
pnpm format:check     # verify formatting
```

Useful package-specific checks:

```sh
pnpm --filter @bioeng/desktop lint
cargo check --workspace
cargo test --workspace
```

## Suggested learning path

If you are new to the repo, follow this order:

1. **Read the root manifests**: `package.json`, `pnpm-workspace.yaml`, `Cargo.toml`, and `apps/desktop/package.json` explain the monorepo boundaries and scripts.
2. **Trace app startup**: start with `apps/desktop/src/app/main.tsx`, `DesktopProviders.tsx`, and `App.tsx`.
3. **Understand navigation**: read `apps/desktop/src/pages/page-registry.ts`, `activity-items.ts`, and `apps/desktop/src/workbench`.
4. **Pick one feature**:
   - Editor: `apps/desktop/src/features/editor/EditorPage.tsx`
   - AI: `apps/desktop/src/features/ai/AiPage.tsx`
   - Python: `apps/desktop/src/features/python/PythonPage.tsx`
   - Database: `apps/desktop/src/features/database/DatabasePage.tsx`
   - Settings: `apps/desktop/src/features/settings/SettingsPage.tsx`
5. **Follow frontend-to-backend calls**: open the feature's `core/*service.ts` or `agent-client.ts`, then find the matching Tauri command in `apps/desktop/src-tauri/src`.
6. **Read the domain crate**: inspect the corresponding `crates/bioeng-*` crate for durable logic and tests.
7. **Run checks after changes**: at minimum run the relevant pnpm script and `cargo check --workspace` for backend changes.

## Where to add new work

- Add a new top-level page in `apps/desktop/src/features/<feature>` and register it in `apps/desktop/src/pages/page-registry.ts`.
- Add reusable UI components under `apps/desktop/src/ui` only when they are broadly useful; otherwise keep components inside the feature directory.
- Add frontend service wrappers in the feature's `core` directory.
- Add Tauri command wrappers under `apps/desktop/src-tauri/src/<domain>/commands.rs`.
- Add durable Rust logic to the most relevant crate under `crates/bioeng-*`.
- Add database schema/storage logic to `crates/bioeng-data`.
- Add backup behavior to `crates/bioeng-backup`.

## Troubleshooting

- If desktop commands fail in a browser-only Vite session, run the full Tauri app with `pnpm dev`.
- If Python REPL startup fails, reinstall dependencies and verify the vendored Pyodide assets are present under `apps/desktop/vendor/pyodide`.
- If workspace script execution fails, check the Python runtime setup scripts in `scripts/` and the Environment panel in the Editor page.
- If AI calls fail, verify provider keys in Settings and confirm MCP servers/skills are valid if the run depends on them.
- If database inspection shows errors, refresh the Database page and verify app data migrations completed successfully.

## License

No license file is currently included in this repository. Add one before distributing Bio Eng Studio outside the project team.
