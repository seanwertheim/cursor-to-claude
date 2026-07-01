import assert from "node:assert/strict";
import test from "node:test";
import { parseArgs, runCli } from "../src/cli.js";

function capture() {
  let value = "";
  return {
    stream: { write: (chunk) => (value += chunk) },
    value: () => value,
  };
}

test("parseArgs accepts root and dry-run", () => {
  assert.deepEqual(parseArgs(["--root", "/tmp/project", "--dry-run"]), {
    root: "/tmp/project",
    dryRun: true,
    help: false,
  });
});

test("CLI returns an error for unknown options", async () => {
  const stdout = capture();
  const stderr = capture();
  assert.equal(
    await runCli(["--wat"], { stdout: stdout.stream, stderr: stderr.stream }),
    1,
  );
  assert.match(stderr.value(), /Unknown option/);
});

test("CLI help is available", async () => {
  const stdout = capture();
  const stderr = capture();
  assert.equal(
    await runCli(["--help"], { stdout: stdout.stream, stderr: stderr.stream }),
    0,
  );
  assert.match(stdout.value(), /Usage: cursor-to-claude/);
  assert.equal(stderr.value(), "");
});
