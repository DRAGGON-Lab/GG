import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import type { OutputChunk } from "rollup";
import { defineConfig, type PluginOption } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

const CHUNK_SIZE_WARNING_LIMIT_KB = 4000;
const INITIAL_CHUNK_WARNING_LIMIT_KB = 500;
const pyodideBundledPackages = new Set(["mpmath", "sympy"]);

function trimPyodideLockfile(content: string) {
  const lockfile = JSON.parse(content) as {
    packages: Record<string, unknown>;
  };

  lockfile.packages = Object.fromEntries(
    Object.entries(lockfile.packages).filter(([name]) =>
      pyodideBundledPackages.has(name),
    ),
  );

  return `${JSON.stringify(lockfile)}\n`;
}

function isKnownPyodideBrowserExternalWarning(warning: {
  message: string;
  plugin?: string;
}) {
  return (
    warning.plugin === "vite:resolve" &&
    warning.message.includes(
      "has been externalized for browser compatibility",
    ) &&
    warning.message.includes("pyodide.mjs")
  );
}

function chunkMonacoModule(normalizedId: string) {
  return normalizedId.includes("/node_modules/monaco-editor/")
    ? "vendor-monaco"
    : undefined;
}

function chunkViteRuntimeModule(normalizedId: string) {
  return normalizedId.includes("vite/preload-helper")
    ? "vite-runtime"
    : undefined;
}

function manualChunks(id: string) {
  const normalizedId = id.split("\\").join("/");
  const viteRuntimeChunk = chunkViteRuntimeModule(normalizedId);

  if (viteRuntimeChunk) {
    return viteRuntimeChunk;
  }

  const monacoChunk = chunkMonacoModule(normalizedId);

  if (monacoChunk) {
    return monacoChunk;
  }

  if (!normalizedId.includes("/node_modules/")) {
    return undefined;
  }

  if (
    normalizedId.includes("/node_modules/react/") ||
    normalizedId.includes("/node_modules/react-dom/") ||
    normalizedId.includes("/node_modules/scheduler/")
  ) {
    return "vendor-react";
  }

  if (
    normalizedId.includes("/node_modules/dockview/") ||
    normalizedId.includes("/node_modules/dockview-core/") ||
    normalizedId.includes("/node_modules/dockview-react/")
  ) {
    return "vendor-dockview";
  }

  if (
    normalizedId.includes("/node_modules/@base-ui/") ||
    normalizedId.includes("/node_modules/@floating-ui/")
  ) {
    return "vendor-ui-primitives";
  }

  if (
    normalizedId.includes("/node_modules/@xyflow/") ||
    normalizedId.includes("/node_modules/d3-") ||
    normalizedId.includes("/node_modules/zustand/")
  ) {
    return "vendor-react-flow";
  }

  if (normalizedId.includes("/node_modules/katex/")) {
    return "vendor-katex";
  }

  if (normalizedId.includes("/node_modules/lucide-react/")) {
    return "vendor-icons";
  }

  if (normalizedId.includes("/node_modules/@tauri-apps/")) {
    return "vendor-tauri";
  }

  return undefined;
}

function isOutputChunk(bundleItem: unknown): bundleItem is OutputChunk {
  return (
    typeof bundleItem === "object" &&
    bundleItem !== null &&
    "type" in bundleItem &&
    bundleItem.type === "chunk"
  );
}

function collectInitialChunkFileNames(
  chunk: OutputChunk,
  chunksByFileName: Map<string, OutputChunk>,
  initialChunkFileNames: Set<string>,
) {
  if (initialChunkFileNames.has(chunk.fileName)) {
    return;
  }

  initialChunkFileNames.add(chunk.fileName);

  for (const importedFileName of chunk.imports) {
    const importedChunk = chunksByFileName.get(importedFileName);

    if (importedChunk) {
      collectInitialChunkFileNames(
        importedChunk,
        chunksByFileName,
        initialChunkFileNames,
      );
    }
  }
}

function initialChunkBudgetPlugin(): PluginOption {
  return {
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle).filter(isOutputChunk);
      const chunksByFileName = new Map(
        chunks.map((chunk) => [chunk.fileName, chunk]),
      );
      const initialChunkFileNames = new Set<string>();

      for (const chunk of chunks) {
        if (chunk.isEntry) {
          collectInitialChunkFileNames(
            chunk,
            chunksByFileName,
            initialChunkFileNames,
          );
        }
      }

      for (const fileName of initialChunkFileNames) {
        const chunk = chunksByFileName.get(fileName);

        if (!chunk) {
          continue;
        }

        const sizeInKiB =
          new TextEncoder().encode(chunk.code).byteLength / 1024;

        if (sizeInKiB > INITIAL_CHUNK_WARNING_LIMIT_KB) {
          this.warn(
            `Initial chunk ${fileName} is ${sizeInKiB.toFixed(
              1,
            )} KiB, above the ${INITIAL_CHUNK_WARNING_LIMIT_KB} KiB budget.`,
          );
        }
      }
    },
    name: "bioeng-initial-chunk-budget",
  };
}

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [
    tailwindcss(),
    react(),
    initialChunkBudgetPlugin(),
    viteStaticCopy({
      targets: [
        {
          dest: "assets/pyodide",
          rename: {
            stripBase: true,
          },
          src: [
            "node_modules/pyodide/pyodide.asm.js",
            "node_modules/pyodide/pyodide.asm.wasm",
            "node_modules/pyodide/python_stdlib.zip",
          ],
        },
        {
          dest: "assets/pyodide",
          rename: {
            stripBase: true,
          },
          src: "node_modules/pyodide/pyodide-lock.json",
          transform: trimPyodideLockfile,
        },
        {
          dest: "assets/pyodide",
          rename: {
            stripBase: true,
          },
          src: "vendor/pyodide/*.whl",
        },
      ],
    }),
  ],
  optimizeDeps: {
    exclude: ["pyodide"],
  },
  resolve: {
    alias: {
      "@": new URL("./src", import.meta.url).pathname,
      "@protocol": new URL(
        "../../crates/bioeng-agent/bindings/agent-protocol.ts",
        import.meta.url,
      ).pathname,
    },
  },
  worker: {
    format: "es",
  },
  build: {
    chunkSizeWarningLimit: CHUNK_SIZE_WARNING_LIMIT_KB,
    rollupOptions: {
      output: {
        manualChunks,
      },
      onwarn(warning, defaultHandler) {
        if (isKnownPyodideBrowserExternalWarning(warning)) {
          return;
        }

        defaultHandler(warning);
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
