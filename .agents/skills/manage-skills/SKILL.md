---
name: manage-skills
description: Analyze changed files and keep verify skills aligned (coverage, stale refs, and missing checks)
argument-hint: "[optional: skill-name | area | --apply-safe | --dry-run]"
---

# Manage Skills

Maintain `verify-*` skills as the codebase changes.

## Purpose

1. Detect coverage gaps between changed files and verify skills
2. Detect stale references in verify skills (deleted or moved files)
3. Suggest update vs create decisions for verify skills
4. Keep verification skills synchronized across skill locations

## When to Run

- After adding a new coding rule or convention
- After introducing new folders/modules
- Before PR to ensure verification coverage
- When a verify skill starts missing obvious issues

## Scope

Scan both locations:
- `.agents/skills/verify-*/SKILL.md`
- `.claude/skills/verify-*/SKILL.md`

## Workflow

### Step 1 - Gather changed files

Collect changed files from both working tree and branch delta.

```bash
git diff --name-only HEAD
```

Then detect default branch dynamically and compare.

```bash
BASE_BRANCH=$(git remote show origin | awk '/HEAD branch/ {print $NF}')
git diff --name-only "${BASE_BRANCH:-main}"...HEAD
```

De-duplicate, then group by directory.

### Step 2 - Discover verify skills dynamically

Use glob discovery instead of static markdown tables.

- Find all `verify-*` skills under both skill roots
- Exclude `verify-implementation` from target set
- Read each skill and extract:
  - Related Files table paths/globs
  - Workflow file paths/patterns

### Step 3 - Build file-to-skill mapping

For each changed file, classify:
- **COVERED**: matched by one or more verify skills
- **UNCOVERED**: no verify skill currently checks it

Also detect:
- **STALE_REF**: skill references files that no longer exist
- **STALE_PATTERN**: grep/glob pattern returns nothing after structural changes

### Step 4 - Decide update vs create

Decision rule:
- If uncovered files are close to an existing skill domain -> **UPDATE existing skill**
- If >= 3 uncovered files share a new domain/pattern -> **CREATE new verify skill**
- Otherwise -> **EXEMPT** (docs, lockfiles, generated files)

### Step 5 - Apply safe updates (when `--apply-safe`)

- Sync mirror copies from `.agents/skills` to `.claude/skills` only for touched `verify-*` skills
- Do not rewrite unrelated skill content
- Emit an action list showing exactly what was synchronized

### Step 6 - Validate

- Confirm referenced files exist
- Dry-run one representative grep/glob per updated skill
- Confirm both skill roots are synchronized for shared skill names

## Output Format

```markdown
## Skill Maintenance Report

### Changed Files
| Directory | Files |
|-----------|-------|
| src/api | `router.ts`, `handler.ts` |

### Mapping
| File | Status | Skill(s) |
|------|--------|----------|
| src/api/router.ts | COVERED | verify-api |
| src/new/module.ts | UNCOVERED | - |

### Actions
| Action | Skill | Detail |
|--------|-------|--------|
| UPDATE | verify-api | Added `src/new/module.ts` checks |
| CREATE | verify-cache | New cache invalidation checks |

### Exemptions
- `README.md` (documentation)
- `pnpm-lock.yaml` (lockfile)
```

Reports should be written to `.omc/reports/skills/` by default.

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/verify-implementation/SKILL.md` | Runs all verify skills in sequence |
| `.claude/skills/verify-implementation/SKILL.md` | Mirror of orchestrator for compatibility |
| `.agents/skills/manage-skills/SKILL.md` | Primary manager skill |
| `.claude/skills/manage-skills/SKILL.md` | Mirror manager skill |

## Exceptions

These are not coverage failures by default:
1. Lockfiles and generated artifacts (`pnpm-lock.yaml`, `dist/**`, build outputs)
2. Documentation-only changes (`README.md`, `CHANGELOG.md`, `LICENSE`)
3. Fixture directories (`**/__fixtures__/**`, `**/fixtures/**`, `**/test-data/**`)
