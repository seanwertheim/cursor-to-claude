import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseDocument, stringify } from "yaml";

const SOURCE_DIRECTORY = path.join(".cursor", "rules");
const OUTPUT_DIRECTORY = path.join(".claude", "rules", "cursor");

export class ConversionError extends Error {}

function relativeDisplayPath(relativePath) {
  return relativePath.split(path.sep).join("/");
}

async function findMdcFiles(directory, relative = "") {
  let entries;
  try {
    entries = await fs.readdir(path.join(directory, relative), {
      withFileTypes: true,
    });
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }

  const files = [];
  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    const childRelative = path.join(relative, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findMdcFiles(directory, childRelative)));
    } else if (entry.isFile() && entry.name.endsWith(".mdc")) {
      files.push(childRelative);
    }
  }
  return files;
}

export function splitGlobString(value) {
  const patterns = [];
  let current = "";
  let escaped = false;
  const closing = { "{": "}", "[": "]", "(": ")" };
  const stack = [];

  for (const character of value) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (closing[character]) {
      stack.push(closing[character]);
    } else if (stack.at(-1) === character) {
      stack.pop();
    }

    if (character === "," && stack.length === 0) {
      if (current.trim()) patterns.push(current.trim());
      current = "";
    } else {
      current += character;
    }
  }

  if (current.trim()) patterns.push(current.trim());
  return patterns;
}

function parseFrontmatter(source, sourceName) {
  const opening = source.match(/^\uFEFF?---[^\S\r\n]*(?:\r\n|\n)/);
  if (!opening) {
    throw new ConversionError(`${sourceName}: missing YAML frontmatter`);
  }

  const closingPattern = /^(?:---|\.\.\.)[^\S\r\n]*(?=\r?$)/gm;
  closingPattern.lastIndex = opening[0].length;
  const closing = closingPattern.exec(source);
  if (!closing) {
    throw new ConversionError(`${sourceName}: unterminated YAML frontmatter`);
  }

  const yamlSource = source.slice(opening[0].length, closing.index);
  const document = parseDocument(yamlSource, { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new ConversionError(
      `${sourceName}: invalid YAML frontmatter: ${document.errors[0].message}`,
    );
  }

  const metadata = document.toJS() ?? {};
  if (typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new ConversionError(`${sourceName}: frontmatter must be a mapping`);
  }

  let bodyStart = closing.index + closing[0].length;
  if (source.startsWith("\r\n", bodyStart)) bodyStart += 2;
  else if (source.startsWith("\n", bodyStart)) bodyStart += 1;

  return { metadata, body: source.slice(bodyStart) };
}

function normalizeGlobs(globs, sourceName) {
  if (globs === undefined || globs === null || globs === "") return [];

  const values = Array.isArray(globs) ? globs : [globs];
  const patterns = [];
  for (const value of values) {
    if (typeof value !== "string") {
      throw new ConversionError(`${sourceName}: globs must contain only strings`);
    }
    patterns.push(...splitGlobString(value));
  }
  return patterns;
}

export function convertRule(source, sourceName = "rule.mdc") {
  const { metadata, body } = parseFrontmatter(source, sourceName);
  const { alwaysApply, description } = metadata;

  if (alwaysApply !== undefined && typeof alwaysApply !== "boolean") {
    throw new ConversionError(`${sourceName}: alwaysApply must be a boolean`);
  }
  if (description !== undefined && typeof description !== "string") {
    throw new ConversionError(`${sourceName}: description must be a string`);
  }

  if (alwaysApply === true) {
    return { kind: "converted", content: body };
  }

  const paths = normalizeGlobs(metadata.globs, sourceName);
  if (paths.length > 0) {
    const frontmatter = stringify({ paths }, { lineWidth: 0 }).trimEnd();
    return {
      kind: "converted",
      content: `---\n${frontmatter}\n---\n\n${body}`,
    };
  }

  if (description?.trim()) {
    return { kind: "skipped-intelligent" };
  }
  return { kind: "skipped-manual" };
}

async function writeGeneratedTree(temporaryDirectory, converted) {
  await fs.mkdir(temporaryDirectory, { recursive: true });
  for (const rule of converted) {
    const destination = path.join(temporaryDirectory, rule.outputRelative);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.writeFile(destination, rule.content, "utf8");
  }
}

async function replaceOutput(outputDirectory, converted) {
  const parent = path.dirname(outputDirectory);
  const temporaryDirectory = path.join(
    parent,
    `.cursor.tmp-${process.pid}-${randomUUID()}`,
  );
  const backupDirectory = path.join(
    parent,
    `.cursor.backup-${process.pid}-${randomUUID()}`,
  );

  await fs.mkdir(parent, { recursive: true });
  await writeGeneratedTree(temporaryDirectory, converted);

  let hadExistingOutput = false;
  try {
    await fs.rename(outputDirectory, backupDirectory);
    hadExistingOutput = true;
  } catch (error) {
    if (error.code !== "ENOENT") {
      await fs.rm(temporaryDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  try {
    await fs.rename(temporaryDirectory, outputDirectory);
  } catch (error) {
    if (hadExistingOutput) await fs.rename(backupDirectory, outputDirectory);
    await fs.rm(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }

  if (hadExistingOutput) {
    await fs.rm(backupDirectory, { recursive: true, force: true });
  }
}

export async function convertProject({ root = process.cwd(), dryRun = false } = {}) {
  const projectRoot = path.resolve(root);
  const sourceDirectory = path.join(projectRoot, SOURCE_DIRECTORY);
  const outputDirectory = path.join(projectRoot, OUTPUT_DIRECTORY);
  const sourceFiles = await findMdcFiles(sourceDirectory);
  const converted = [];
  const warnings = [];
  let skippedIntelligent = 0;
  let skippedManual = 0;
  const outputKeys = new Map();

  for (const sourceRelative of sourceFiles) {
    const displayName = relativeDisplayPath(
      path.join(SOURCE_DIRECTORY, sourceRelative),
    );
    const source = await fs.readFile(path.join(sourceDirectory, sourceRelative), "utf8");
    const result = convertRule(source, displayName);

    if (result.kind === "skipped-intelligent") {
      skippedIntelligent += 1;
      warnings.push(`${displayName}: skipped intelligent rule (no Claude equivalent)`);
      continue;
    }
    if (result.kind === "skipped-manual") {
      skippedManual += 1;
      warnings.push(`${displayName}: skipped manual rule (no Claude equivalent)`);
      continue;
    }

    const outputRelative = sourceRelative.slice(0, -4) + ".md";
    const collisionKey = relativeDisplayPath(outputRelative).toLocaleLowerCase("en-US");
    if (outputKeys.has(collisionKey)) {
      throw new ConversionError(
        `output collision: ${outputKeys.get(collisionKey)} and ${displayName}`,
      );
    }
    outputKeys.set(collisionKey, displayName);
    converted.push({ outputRelative, content: result.content });
  }

  if (!dryRun) await replaceOutput(outputDirectory, converted);

  return {
    discovered: sourceFiles.length,
    converted: converted.length,
    skippedIntelligent,
    skippedManual,
    warnings,
    outputDirectory,
  };
}

export function formatSummary(result, dryRun = false) {
  const prefix = dryRun ? "Dry run: " : "";
  return (
    `${prefix}${result.converted} converted, ` +
    `${result.skippedIntelligent} intelligent skipped, ` +
    `${result.skippedManual} manual skipped, ` +
    `${result.discovered} total`
  );
}
