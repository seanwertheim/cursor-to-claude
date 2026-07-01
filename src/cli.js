import process from "node:process";
import { convertProject, formatSummary } from "./converter.js";

const HELP = `Usage: cursor-to-claude [options]

Convert .cursor/rules/**/*.mdc into .claude/rules/cursor/**/*.md.

Options:
  --root <path>  Project root (default: current working directory)
  --dry-run      Validate and report without changing files
  -h, --help     Show this help
`;

export function parseArgs(args) {
  const options = { root: process.cwd(), dryRun: false, help: false };

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--dry-run") {
      options.dryRun = true;
    } else if (argument === "-h" || argument === "--help") {
      options.help = true;
    } else if (argument === "--root") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("--root requires a path");
      }
      options.root = value;
      index += 1;
    } else {
      throw new Error(`Unknown option: ${argument}`);
    }
  }

  return options;
}

export async function runCli(args, io = {}) {
  const stdout = io.stdout ?? process.stdout;
  const stderr = io.stderr ?? process.stderr;

  try {
    const options = parseArgs(args);
    if (options.help) {
      stdout.write(HELP);
      return 0;
    }

    const result = await convertProject(options);
    for (const warning of result.warnings) {
      stderr.write(`warning: ${warning}\n`);
    }
    stdout.write(`${formatSummary(result, options.dryRun)}\n`);
    return 0;
  } catch (error) {
    stderr.write(`error: ${error.message}\n`);
    return 1;
  }
}
