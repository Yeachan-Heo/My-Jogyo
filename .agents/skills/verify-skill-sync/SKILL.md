---
name: verify-skill-sync
description: Verify required mirrored skills are synchronized between .agents/skills and .claude/skills
argument-hint: "[optional: --strict]"
---

# Verify Skill Sync

## Purpose

Ensure required mirrored skills stay in sync across local skill roots.

## When to Run

- After editing any skill in `.agents/skills`
- Before release or shared distribution
- After bulk imports or refactors

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/*/SKILL.md` | Source-of-truth skill definitions |
| `.claude/skills/*/SKILL.md` | Mirror skill definitions |
| `.omc/skill-sync-manifest.json` | Required mirror scope |
| `scripts/sync-skills.py` | Sync/check utility |

## Workflow

### Step 1 - Load required mirror scope

Read `.omc/skill-sync-manifest.json` and collect `required_mirror_skills`.

### Step 2 - Validate existence

For each required skill:

- PASS if both files exist:
  - `.agents/skills/<name>/SKILL.md`
  - `.claude/skills/<name>/SKILL.md`
- FAIL if either side is missing

### Step 3 - Validate hash equality

For each existing pair, compare file hash:

- PASS if hashes are identical
- FAIL if drift is detected

### Step 4 - Recommend repair

For FAIL items, recommend:

```bash
python3 scripts/sync-skills.py --sync
```

## Output Format

```markdown
## verify-skill-sync report

| Skill | Status | Detail |
|------|--------|--------|
| manage-skills | PASS | Mirror in sync |
| verify-agent-reference | FAIL | Hash mismatch |
```

## Exceptions

1. Skills not listed in `required_mirror_skills` are out of scope
2. Non-skill files under these folders are ignored
3. Temporary local experiments outside required scope are warnings only
