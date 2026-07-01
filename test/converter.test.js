import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ConversionError,
  convertProject,
  convertRule,
  splitGlobString,
} from "../src/converter.js";

const mdc = (frontmatter, body = "# Rule\n\nKeep this body.\n") =>
  `---\n${frontmatter}\n---\n${body}`;

async function temporaryProject(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "cursor-to-claude-"));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

async function write(root, relative, content) {
  const filename = path.join(root, relative);
  await fs.mkdir(path.dirname(filename), { recursive: true });
  await fs.writeFile(filename, content);
}

test("always-applied rules preserve the Markdown body without frontmatter", () => {
  const body = "# Global\n\nAlways do this.\n";
  const result = convertRule(mdc("alwaysApply: true", body));
  assert.deepEqual(result, { kind: "converted", content: body });
});

test("path rules convert strings, arrays, comma lists, and brace expansion", () => {
  assert.deepEqual(splitGlobString("docs/**/*.md, src/**/*.{ts,tsx}"), [
    "docs/**/*.md",
    "src/**/*.{ts,tsx}",
  ]);

  const result = convertRule(
    mdc('globs:\n  - "src/**/*.{ts,tsx}"\n  - "lib/**/*.ts, tests/**/*.ts"\nalwaysApply: false'),
  );
  assert.equal(result.kind, "converted");
  assert.match(result.content, /paths:\n  - src\/\*\*\/\*\.\{ts,tsx\}/);
  assert.match(result.content, /  - lib\/\*\*\/\*\.ts/);
  assert.match(result.content, /  - tests\/\*\*\/\*\.ts/);
  assert.match(result.content, /# Rule\n\nKeep this body\.\n$/);
});

test("intelligent and manual rules are classified for skipping", () => {
  assert.equal(
    convertRule(mdc("description: Backend conventions\nalwaysApply: false")).kind,
    "skipped-intelligent",
  );
  assert.equal(convertRule(mdc("alwaysApply: false")).kind, "skipped-manual");
});

test("alwaysApply true overrides globs and description", () => {
  const result = convertRule(
    mdc('description: Ignore me\nglobs: "**/*.ts"\nalwaysApply: true'),
  );
  assert.equal(result.content, "# Rule\n\nKeep this body.\n");
});

test("nested rules mirror into the managed output and stale files are removed", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/frontend/react.mdc", mdc('globs: "src/**/*.tsx"\nalwaysApply: false'));
  await write(root, ".cursor/rules/global.mdc", mdc("alwaysApply: true"));
  await write(root, ".claude/rules/native.md", "native");
  await write(root, ".claude/rules/cursor/stale.md", "stale");

  const result = await convertProject({ root });
  assert.equal(result.converted, 2);
  assert.equal(
    await fs.readFile(path.join(root, ".claude/rules/native.md"), "utf8"),
    "native",
  );
  assert.equal(
    await fs.readFile(path.join(root, ".claude/rules/cursor/global.md"), "utf8"),
    "# Rule\n\nKeep this body.\n",
  );
  await fs.access(path.join(root, ".claude/rules/cursor/frontend/react.md"));
  await assert.rejects(fs.access(path.join(root, ".claude/rules/cursor/stale.md")));
});

test("dry-run reports without changing existing output", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/new.mdc", mdc("alwaysApply: true"));
  await write(root, ".claude/rules/cursor/existing.md", "existing");

  const result = await convertProject({ root, dryRun: true });
  assert.equal(result.converted, 1);
  assert.equal(
    await fs.readFile(path.join(root, ".claude/rules/cursor/existing.md"), "utf8"),
    "existing",
  );
  await assert.rejects(fs.access(path.join(root, ".claude/rules/cursor/new.md")));
});

test("invalid input fails before existing output is replaced", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/broken.mdc", "---\nalwaysApply: [\n---\nbody");
  await write(root, ".claude/rules/cursor/existing.md", "existing");

  await assert.rejects(convertProject({ root }), ConversionError);
  assert.equal(
    await fs.readFile(path.join(root, ".claude/rules/cursor/existing.md"), "utf8"),
    "existing",
  );
});

test("missing source directory produces an empty managed mirror", async (t) => {
  const root = await temporaryProject(t);
  const result = await convertProject({ root });
  assert.equal(result.discovered, 0);
  assert.deepEqual(
    await fs.readdir(path.join(root, ".claude/rules/cursor")),
    [],
  );
});
