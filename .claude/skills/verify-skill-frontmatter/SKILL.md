---
name: verify-skill-frontmatter
description: Verify skill metadata quality (frontmatter fields, name-directory match, and duplicate-name conflicts)
argument-hint: "[optional: --agents-only | --claude-only]"
---

# Verify Skill Frontmatter

## Purpose

Validate baseline quality rules for local skill definitions:

1. Required frontmatter keys are present (`name`, `description`)
2. Frontmatter `name` matches skill directory name
3. Duplicated skill names across roots do not conflict
4. Frontmatter blocks are syntactically intact

## When to Run

- After creating or importing new skills
- After renaming skill directories
- Before running broad verification (`verify-implementation`)
- Before sharing skill packs across environments

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/*/SKILL.md` | Primary local skill definitions |
| `.claude/skills/*/SKILL.md` | Mirror/alternate skill definitions |
| `.agents/skills/verify-implementation/SKILL.md` | Parent orchestrator |

## Workflow

### Step 1 - Discover skill files

Use glob on both roots:

```bash
glob .agents/skills/**/SKILL.md
glob .claude/skills/**/SKILL.md
```

### Step 2 - Validate required frontmatter keys

For each `SKILL.md`, verify the first YAML block contains:

- `name:`
- `description:`

Fail if either key is missing.

### Step 3 - Validate name-directory consistency

For each skill file, compare:

- Directory name: `<root>/<skill-name>/SKILL.md`
- Frontmatter value: `name: <skill-name>`

Fail if they differ.

### Step 4 - Validate cross-root duplicates

When the same `name` exists in both `.agents/skills` and `.claude/skills`, compare hashes.

- PASS: files are identical
- WARN: semantic match but text drift
- FAIL: conflicting intent or mismatched identifiers

### Step 5 - Report

Return a concise table.

## Output Format

```markdown
## verify-skill-frontmatter report

| Check | Result | Details |
|------|--------|---------|
| Required keys | PASS | 62/62 files valid |
| Name-directory match | PASS | No mismatches |
| Cross-root duplicates | WARN | 1 drift detected |
```

## Exceptions

1. Non-skill markdown files are out of scope
2. Hidden backup files are ignored (`*.bak`, `*.tmp`)
3. Root-level docs without frontmatter are not skill files
