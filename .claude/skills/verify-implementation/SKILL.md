---
name: verify-implementation
description: Run all verify skills sequentially and produce a consolidated implementation validation report
argument-hint: "[optional: verify-skill-name | --fix | --dry-run]"
---

# Verify Implementation

Run all `verify-*` skills as one validation pipeline.

Default report location: `.omc/reports/skills/`.

## Purpose

- Execute project verification skills consistently
- Consolidate findings into one report
- Support fix-and-reverify cycles

## When to Run

- After feature implementation
- Before creating a PR
- During quality review and release checks

## Scope

Discover `verify-*` skills from:
- `.agents/skills/verify-*/SKILL.md`
- `.claude/skills/verify-*/SKILL.md`

Always exclude:
- `verify-implementation` (self)

## Workflow

### Step 1 - Resolve execution set

1. Discover verify skills dynamically with glob
2. De-duplicate by skill name across both locations
3. If a specific skill is passed in arguments, filter to that skill

If no verify skills exist, output setup guidance and exit.

### Step 2 - Execute checks sequentially

For each skill:

1. Read the skill's Workflow and Related Files sections
2. Execute declared checks using available tools (`Grep`, `Glob`, `Read`, `Bash`)
3. Apply that skill's exceptions before counting failures
4. Record findings with file path and actionable fix recommendation

### Step 3 - Build consolidated report

Produce summary + detailed findings table.

```markdown
## Implementation Verification Report

### Summary
| Skill | Status | Issues |
|-------|--------|--------|
| verify-api | PASS | 0 |
| verify-security | FAIL | 2 |

### Findings
| # | Skill | File | Issue | Suggested Fix |
|---|-------|------|-------|---------------|
| 1 | verify-security | src/auth.ts:42 | Unsanitized input | Add schema validation |
```

### Step 4 - Optional fix mode (`--fix`)

If `--fix` is enabled:
- Apply deterministic, low-risk fixes only
- Re-run only affected verify skills
- Report before/after counts

### Step 5 - Final status

- **PASS**: all executed verify skills report no active issues
- **FAIL**: one or more skills still report issues after optional fix cycle

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/manage-skills/SKILL.md` | Keeps verify skill coverage healthy |
| `.claude/skills/manage-skills/SKILL.md` | Mirror manager skill |
| `.agents/skills/verify-implementation/SKILL.md` | Primary orchestrator |
| `.claude/skills/verify-implementation/SKILL.md` | Mirror orchestrator |

## Exceptions

Not considered verification failures by default:
1. Documentation-only deltas with no executable impact
2. Generated artifacts and lockfiles
3. Intentional temporary TODO/FIXME markers with owner+date in active WIP branches
