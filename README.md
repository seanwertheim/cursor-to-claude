# cursor-to-claude

Convert Cursor project rules into Claude Code rules and skills while preserving unconditional, path-scoped, intelligent, and manual activation.

Cursor stores project rules as `.cursor/rules/**/*.mdc`. Claude Code recursively loads Markdown rules from `.claude/rules/` and uses `paths` frontmatter for conditional rules. This CLI mirrors always-applied and path-scoped Cursor rules into the isolated `.claude/rules/cursor/` subtree, and turns intelligent and manual rules into skills under `.claude/skills/cursor-*/`.

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
| Description-only “Apply Intelligently” | Skill with the rule's `description` and `user-invocable: false` |
| “Apply Manually” | Skill with `disable-model-invocation: true` |

Claude Code rules only read `paths`, so intelligent and manual activation can't be expressed as rules. Skills cover both: an intelligent rule becomes a skill Claude loads when its description matches the task, hidden from the `/` menu, and a manual rule becomes a skill only you can invoke with `/cursor-<name>`, the way you would @-mention it in Cursor.

Skill names are `cursor-` plus the rule's path relative to `.cursor/rules/`, lowercased with every other character run turned into `-` and capped at 64 characters, so `team/API_rules.mdc` becomes `cursor-team-api-rules`.

Comma-separated glob strings become YAML path lists. Commas inside glob groups are preserved, so `src/**/*.{ts,tsx}` remains one pattern.

## Output ownership

Each successful run makes `.claude/rules/cursor/` an exact mirror of always-applied and path-scoped Cursor rules. Stale generated files are removed. Files elsewhere under `.claude/rules/` are never modified.

Each generated skill directory holds a `.cursor-to-claude` marker file. A run rewrites every marked skill it generates and removes marked skills whose rule is gone. Skills without the marker are never modified; if a rule maps to the name of one, the run fails instead of overwriting it.

The converter validates every source before replacing the managed output. Invalid YAML, invalid metadata types, case-insensitive output collisions, or skill name collisions fail the run and preserve the previous generated rules and skills.

## Scope

Version 1 converts project `.mdc` files only. Legacy `.cursorrules`, Cursor user/team rules, and `AGENTS.md` are not processed.

## References

- [Cursor rules documentation](https://cursor.com/docs/rules)
- [Claude Code rules documentation](https://code.claude.com/docs/en/memory#organize-rules-with-claude-rules)
