# cursor-to-claude

Convert Cursor project rules into Claude Code rules while preserving unconditional and path-scoped activation.

Cursor stores project rules as `.cursor/rules/**/*.mdc`. Claude Code recursively loads Markdown rules from `.claude/rules/` and uses `paths` frontmatter for conditional rules. This CLI mirrors compatible Cursor rules into the isolated `.claude/rules/cursor/` subtree.

## Requirements

- Node.js 20 or newer

## Install and run

```bash
npm install
npm run convert
```

Run against another project or preview the conversion:

```bash
npx cursor-to-claude --root ../my-project
npx cursor-to-claude --root ../my-project --dry-run
```

## Rule mapping

| Cursor rule | Claude Code output |
| --- | --- |
| `alwaysApply: true` | Unscoped `.md` rule |
| `alwaysApply: false` with `globs` | `.md` rule with equivalent `paths` frontmatter |
| Description-only “Apply Intelligently” | Warning; skipped |
| “Apply Manually” | Warning; skipped |

Cursor intelligent and manual activation have no equivalent in Claude Code rules. They are skipped instead of being broadened into global instructions.

Comma-separated glob strings become YAML path lists. Commas inside glob groups are preserved, so `src/**/*.{ts,tsx}` remains one pattern.

## Output ownership

Each successful run makes `.claude/rules/cursor/` an exact mirror of compatible Cursor rules. Stale generated files are removed. Files elsewhere under `.claude/rules/` are never modified.

The converter validates every source before replacing the managed output. Invalid YAML, invalid metadata types, or case-insensitive output collisions fail the run and preserve the previous generated rules.

## Scope

Version 1 converts project `.mdc` files only. Legacy `.cursorrules`, Cursor user/team rules, and `AGENTS.md` are not processed.

## References

- [Cursor rules documentation](https://cursor.com/docs/rules)
- [Claude Code rules documentation](https://code.claude.com/docs/en/memory#organize-rules-with-claude-rules)
