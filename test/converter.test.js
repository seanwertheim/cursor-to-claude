import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  ConversionError,
  convertProject,
  convertRule,
  renderSkill,
  skillNameFor,
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

test("intelligent and manual rules are classified as skills", () => {
  assert.deepEqual(
    convertRule(mdc("description: Backend conventions\nalwaysApply: false")),
    { kind: "intelligent", description: "Backend conventions", body: "# Rule\n\nKeep this body.\n" },
  );
  assert.equal(convertRule(mdc("alwaysApply: false")).kind, "manual");
  assert.equal(convertRule(mdc('description: Has globs\nglobs: []')).kind, "intelligent");
});

test("skill names are prefixed, flattened, and limited to 64 characters", () => {
  assert.equal(skillNameFor("build-test.mdc"), "cursor-build-test");
  assert.equal(skillNameFor(path.join("Backend", "API_rules.mdc")), "cursor-backend-api-rules");
  const long = skillNameFor(`${"a".repeat(80)}.mdc`);
  assert.equal(long.length, 64);
  assert.ok(long.startsWith("cursor-"));
});

test("intelligent skills are model-only and manual skills are user-only", () => {
  const intelligent = renderSkill(
    convertRule(mdc('description: "Finding sprints: board IDs"')),
    "cursor-sprint",
    ".cursor/rules/sprint.mdc",
  );
  assert.match(intelligent, /^---\nname: cursor-sprint\ndescription: "Finding sprints: board IDs"\nuser-invocable: false\n---\n\n# Rule/);

  const manual = renderSkill(
    convertRule(mdc("alwaysApply: false")),
    "cursor-manual",
    ".cursor/rules/manual.mdc",
  );
  assert.match(manual, /description: Cursor rule \.cursor\/rules\/manual\.mdc, applied manually\n/);
  assert.match(manual, /disable-model-invocation: true\n---\n\n# Rule/);
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

test("skills are generated with a marker, stale generated skills are removed, others are kept", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/sprint.mdc", mdc("description: Sprint lookup\nglobs: []"));
  await write(root, ".cursor/rules/team/manual.mdc", mdc("alwaysApply: false"));
  await write(root, ".claude/skills/cursor-old/SKILL.md", "old");
  await write(root, ".claude/skills/cursor-old/.cursor-to-claude", "marker");
  await write(root, ".claude/skills/cursor-handmade/SKILL.md", "handmade");
  await write(root, ".claude/skills/other/SKILL.md", "other");

  const result = await convertProject({ root });
  assert.equal(result.intelligentSkills, 1);
  assert.equal(result.manualSkills, 1);
  assert.equal(result.converted, 0);

  const sprint = await fs.readFile(path.join(root, ".claude/skills/cursor-sprint/SKILL.md"), "utf8");
  assert.match(sprint, /user-invocable: false/);
  await fs.access(path.join(root, ".claude/skills/cursor-sprint/.cursor-to-claude"));
  await fs.access(path.join(root, ".claude/skills/cursor-team-manual/SKILL.md"));
  await assert.rejects(fs.access(path.join(root, ".claude/skills/cursor-old")));
  assert.equal(await fs.readFile(path.join(root, ".claude/skills/cursor-handmade/SKILL.md"), "utf8"), "handmade");
  assert.equal(await fs.readFile(path.join(root, ".claude/skills/other/SKILL.md"), "utf8"), "other");

  await write(root, ".cursor/rules/sprint.mdc", mdc("description: Sprint lookup v2\nglobs: []"));
  await convertProject({ root });
  assert.match(
    await fs.readFile(path.join(root, ".claude/skills/cursor-sprint/SKILL.md"), "utf8"),
    /Sprint lookup v2/,
  );
  const leftovers = (await fs.readdir(path.join(root, ".claude/skills"))).filter((name) => name.startsWith("."));
  assert.deepEqual(leftovers, []);
});

test("a skill name taken by a hand-made skill fails before anything is written", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/sprint.mdc", mdc("description: Sprint lookup"));
  await write(root, ".cursor/rules/global.mdc", mdc("alwaysApply: true"));
  await write(root, ".claude/skills/cursor-sprint/SKILL.md", "handmade");

  await assert.rejects(convertProject({ root }), /was not generated by cursor-to-claude/);
  assert.equal(await fs.readFile(path.join(root, ".claude/skills/cursor-sprint/SKILL.md"), "utf8"), "handmade");
  await assert.rejects(fs.access(path.join(root, ".claude/rules/cursor/global.md")));
});

test("rules whose skill names collide fail the run", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/a-b.mdc", mdc("description: One"));
  await write(root, ".cursor/rules/a/b.mdc", mdc("description: Two"));
  await assert.rejects(convertProject({ root }), /skill name collision/);
});

test("dry-run does not write skills", async (t) => {
  const root = await temporaryProject(t);
  await write(root, ".cursor/rules/sprint.mdc", mdc("description: Sprint lookup"));
  const result = await convertProject({ root, dryRun: true });
  assert.equal(result.intelligentSkills, 1);
  await assert.rejects(fs.access(path.join(root, ".claude/skills")));
});
