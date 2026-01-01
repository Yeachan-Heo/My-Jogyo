---
description: "[DEPRECATED] Migrate legacy Gyoshu sessions to the new research structure"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu migrate [opts]`
>
> Example: `/gyoshu migrate $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu migrate $ARGUMENTS`

---

## Original Documentation

Migrate legacy sessions from `~/.gyoshu/sessions/` to the new project-local research structure at `./gyoshu/research/`.

$ARGUMENTS

### Arguments

- `--dry-run`: Preview what would be migrated without making changes
- `<session_id>`: Optionally migrate only a specific session

### Migration Workflow

1. **Scan**: Discovers legacy sessions at `~/.gyoshu/sessions/`
2. **Confirm**: Asks for confirmation before migrating
3. **Execute**: Copies files to new structure (never deletes legacy)
4. **Verify**: Validates migration integrity
5. **Summary**: Shows results and next steps

### Important Notes

- **No auto-deletion**: Legacy sessions at `~/.gyoshu/sessions/` are NEVER automatically deleted
- **Safe to re-run**: Already migrated sessions are skipped automatically
- **1:1 mapping**: Each legacy session becomes a research with sessionId as researchId
- **Tagged for tracking**: Migrated research is tagged with "migrated-from-legacy"
