---
name: verify-agent-reference
description: Verify skill files reference valid agent roles and flag unknown subagent_type values
argument-hint: "[optional: --strict]"
---

# Verify Agent Reference

## Purpose

Detect invalid or stale agent role references in skill files.

## When to Run

- After editing `subagent_type` values in skills
- After updating agent catalogs in guidance docs
- Before release

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/*/SKILL.md` | Primary skill definitions |
| `.claude/skills/*/SKILL.md` | Mirror skill definitions |
| `AGENTS.md` | Codex-side agent catalog |
| `.omc/skill-verify-exemptions.json` | Allowed unknown-role exceptions |

## Workflow

### Step 1 - Build valid role set

Parse role names from:

- `AGENTS.md` agent catalog references
- `.claude/CLAUDE.md` `<agent_catalog>` entries when present

### Step 2 - Extract role references from skills

Scan each skill for patterns like:

- `subagent_type="oh-my-codex:<role>"`
- `subagent_type="oh-my-claudecode:<role>"`

### Step 3 - Validate references

- PASS if referenced role exists in valid role set
- WARN for unknown roles listed in exemptions
- FAIL for unknown roles not exempted

### Step 4 - Recommend repair

For each FAIL, recommend one:

- Update role to a valid catalog entry
- Add justified exemption in `.omc/skill-verify-exemptions.json`

## Output Format

```markdown
## verify-agent-reference report

| File | Result | Issue |
|------|--------|-------|
| .agents/skills/plan/SKILL.md | PASS | - |
| .agents/skills/foo/SKILL.md | FAIL | Unknown role `architect-lite` |
```

## Exceptions

1. Examples inside fenced code blocks can be warning-level when clearly marked as pseudo examples
2. Alias roles intentionally mapped by runtime policy may be exempted explicitly
3. Non-skill markdown files are out of scope
