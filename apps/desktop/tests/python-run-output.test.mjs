// Run with: node --experimental-strip-types --test apps/desktop/tests/python-run-output.test.mjs
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { afterEach, beforeEach, test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";

import { pythonRunScript } from "../src/features/editor/core/python-service.ts";

// Resolve the same source alias as tsconfig without adding a test dependency.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      specifier = new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url)
        .href;
    }
    return nextResolve(specifier, context);
  },
});

const { runCircuitScript } =
  await import("../src/features/circuit/core/circuit-run.ts");
const { runAnalysis } =
  await import("../src/features/flapjack/core/analysis-run.ts");
const { FLAPJACK_CHARACTERIZATION_MIME } =
  await import("../src/features/flapjack/core/flapjack-types.ts");

beforeEach(() => {
  globalThis.window = { crypto: globalThis.crypto };
});

afterEach(() => {
  clearMocks();
  delete globalThis.window;
});

function mockPython() {
  const pending = [];
  let nextRunId = 1;
  let notify;
  mockIPC(
    (command, args) => {
      switch (command) {
        case "python_run_script": {
          const result = Promise.withResolvers();
          const runId = nextRunId++;
          let index = 0;
          const deliver = (message) => {
            window.__TAURI_INTERNALS__.runCallback(args.onOutput.id, message);
          };
          const run = {
            args,
            runId,
            result,
            deliver,
            output(stream, line) {
              deliver({ index: index++, message: { runId, stream, line } });
            },
            finish(exitCode = 0) {
              deliver({ index: index++, message: null });
              deliver({ index, end: true });
              result.resolve({ runId, exitCode });
            },
            fail(error) {
              deliver({ index, end: true });
              result.reject(error);
            },
          };
          pending.push(run);
          notify?.();
          return result.promise;
        }
        // Exercise the real Circuit/Flapjack entry points while keeping their
        // environment and database setup independent of the host machine.
        case "flapjack_db_path":
          return "/test/flapjack.sqlite";
        case "plugin:path|resolve_directory":
          return "/test";
        case "plugin:path|join":
          return args.paths.join("/");
        case "python_env_status":
          return { hasVenv: true };
        case "python_packages_list":
          return [];
        case "python_packages_install":
          return { runId: 0, exitCode: 0 };
        case "plugin:fs|read_text_file":
          throw new Error("No environment marker yet");
        case "plugin:fs|write_text_file":
        case "plugin:fs|mkdir":
          return;
        default:
          throw new Error(`Unexpected command: ${command}`);
      }
    },
    { shouldMockEvents: true },
  );
  return async function nextRun() {
    if (!pending.length) {
      await new Promise((resolve) => {
        notify = resolve;
      });
      notify = undefined;
    }
    return pending.shift();
  };
}

function characterization(name) {
  return {
    analysisType: "Mean Expression",
    name,
    paramsHash: name,
    spec: {},
    data: [],
  };
}

function display(payload) {
  return JSON.stringify({
    data: { [FLAPJACK_CHARACTERIZATION_MIME]: payload },
  });
}

test(
  "overlapping Editor, Circuit and Flapjack runs only consume their own output",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    const editorLines = [];
    const circuitLines = [];
    const editor = pythonRunScript(
      "editor",
      (line) => editorLines.push(line),
      "/test/editor.py",
      "/test/editor",
    );
    const editorRun = await nextRun();
    const circuit = runCircuitScript("circuit", "/test/circuit", (line) =>
      circuitLines.push(line),
    );
    const circuitRun = await nextRun();
    const analysis = runAnalysis(1, "Mean Expression", () => {});
    const analysisRun = await nextRun();
    assert.equal(editorRun.args.path, "/test/editor.py");
    assert.equal(editorRun.args.workspaceRoot, "/test/editor");
    assert.equal(circuitRun.args.workspaceRoot, "/test/circuit");

    const own = characterization("analysis result");
    const foreign = display(characterization("unrelated editor result"));
    analysisRun.output("display", display(own));
    editorRun.output("stdout", "editor output");
    circuitRun.output("stderr", "circuit warning");
    editorRun.output("display", foreign);
    circuitRun.output("display", '{"data":{"text/plain":"circuit plot"}}');
    analysisRun.output("stderr", "analysis warning");

    // Finish in a different order from startup while other runs remain active.
    circuitRun.finish(2);
    assert.deepEqual(await circuit, { exitCode: 2 });
    editorRun.output("stderr", "editor warning");
    analysisRun.finish();
    assert.deepEqual(await analysis, own);
    editorRun.finish();
    assert.deepEqual(await editor, { runId: editorRun.runId, exitCode: 0 });
    assert.deepEqual(
      editorLines.map(({ stream, line }) => ({ stream, line })),
      [
        { stream: "stdout", line: "editor output" },
        { stream: "display", line: foreign },
        { stream: "stderr", line: "editor warning" },
      ],
    );
    assert.deepEqual(circuitLines, [
      { stream: "stderr", text: "circuit warning" },
      { stream: "display", text: '{"data":{"text/plain":"circuit plot"}}' },
    ]);
    assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0);
  },
);

test(
  "a foreign characterization cannot turn a failed analysis into a success",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    const analysis = runAnalysis(1, "Mean Expression", () => {});
    const analysisRun = await nextRun();
    const unrelated = pythonRunScript("unrelated", () => {});
    const unrelatedRun = await nextRun();
    unrelatedRun.output("display", display(characterization("foreign result")));
    unrelatedRun.output("stderr", "foreign error");
    analysisRun.output("stderr", "analysis error");
    const rejected = assert.rejects(analysis, { message: "analysis error" });
    analysisRun.finish(1);
    await rejected;
    unrelatedRun.finish();
    await unrelated;
  },
);

test(
  "overlapping analyses return their respective characterizations",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    const first = runAnalysis(1, "Mean Expression", () => {});
    const firstRun = await nextRun();
    const second = runAnalysis(2, "Mean Expression", () => {});
    const secondRun = await nextRun();
    const firstResult = characterization("study 1");
    const secondResult = characterization("study 2");
    firstRun.output("display", display(firstResult));
    secondRun.output("display", display(secondResult));
    secondRun.finish();
    firstRun.finish();
    assert.deepEqual(await Promise.all([first, second]), [
      firstResult,
      secondResult,
    ]);
  },
);

test(
  "analysis waits for delayed rich output even after the command resolves",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    const analysis = runAnalysis(1, "Mean Expression", () => {});
    const run = await nextRun();
    let settled = false;
    void analysis.then(() => {
      settled = true;
    });
    // Large channel payloads use a separate fetch. The completion message and
    // command response can arrive before an earlier output message does.
    run.deliver({ index: 1, message: null });
    run.deliver({ index: 2, end: true });
    run.result.resolve({ runId: run.runId, exitCode: 0 });
    await setImmediate();
    assert.equal(settled, false);
    const own = characterization("delayed result");
    run.deliver({
      index: 0,
      message: { runId: run.runId, stream: "display", line: display(own) },
    });
    assert.deepEqual(await analysis, own);
    assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0);
  },
);

test(
  "startup failure rejects without waiting for an output completion marker",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    const result = pythonRunScript("invalid", () =>
      assert.fail("Unexpected output"),
    );
    const run = await nextRun();
    const rejected = assert.rejects(result, {
      message: "Python runtime missing",
    });
    run.fail(new Error("Python runtime missing"));
    await rejected;
    assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0);
  },
);

test(
  "runs without output still return their exit status",
  { timeout: 3000 },
  async () => {
    const nextRun = mockPython();
    for (const exitCode of [0, 1, null]) {
      const result = pythonRunScript("pass", () =>
        assert.fail("Unexpected output"),
      );
      const run = await nextRun();
      run.finish(exitCode);
      assert.deepEqual(await result, { runId: run.runId, exitCode });
    }
    assert.equal(window.__TAURI_INTERNALS__.callbacks.size, 0);
  },
);
