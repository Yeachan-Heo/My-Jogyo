# Skills Operations Runbook

## Source of Truth

- Authoritative skill files: `.agents/skills/*/SKILL.md`
- Mirror files: `.claude/skills/*/SKILL.md`
- Required mirror scope: `.omc/skill-sync-manifest.json`

## Standard Commands

- Drift check: `python3 scripts/sync-skills.py --check --fail-on-drift`
- Mirror repair: `python3 scripts/sync-skills.py --sync`
- Skill verification: `python3 scripts/verify-skills.py`
- Strict verification: `python3 scripts/verify-skills.py --strict`
- Coverage dry-run: `python3 scripts/manage-skills.py --dry-run`
- Safe apply (mirror sync only): `python3 scripts/manage-skills.py --apply-safe`

## MCP Replacement Policy

- Default mode: **skill-first**
- MCP escalation only when one of these is true:
  1. Independent second opinion is required for high-severity findings
  2. External-source authority is required (latest docs/news)
  3. Large-context multimodal critique is required

Reference matrix: `.omc/mcp-skill-replacement-matrix.md`

## Release Gate

A release is blocked unless all are true:

1. `sync-skills --check --fail-on-drift` passes
2. `verify-skills.py --strict` passes
3. `.omc/reports/skills/` contains fresh PASS report artifacts

## Monthly Maintenance Routine

Run in order:

1. `python3 scripts/sync-skills.py --check --fail-on-drift`
2. `python3 scripts/verify-skills.py --strict`
3. `python3 scripts/manage-skills.py --dry-run`
4. Review `.omc/mcp-skill-replacement-matrix.md` and update if routing changed
5. Review `.omc/skill-verify-exemptions.json` for stale exemptions

## Local Hook Setup

```bash
bash scripts/install-githooks.sh
```
