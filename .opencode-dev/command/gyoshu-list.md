---
description: "[DEPRECATED] List all research projects in the current project"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu list [filters]`
>
> Example: `/gyoshu list $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu list $ARGUMENTS`

---

## Original Documentation

List all research projects in this project.

$ARGUMENTS

### Usage

```
/gyoshu list                          # List all researches
/gyoshu list --status active          # Filter by status
/gyoshu list --tags ml,clustering     # Filter by tags
/gyoshu list --since 2024-01-01       # Filter by date (created after)
/gyoshu list --until 2024-12-31       # Filter by date (updated before)
```

### Filters (Optional)

| Filter | Description | Example |
|--------|-------------|---------|
| `--status` | Filter by status: active, completed, archived | `--status active` |
| `--tags` | Filter by tags (comma-separated, match any) | `--tags ml,analysis` |
| `--since` | Show researches created after date (YYYY-MM-DD) | `--since 2024-01-01` |
| `--until` | Show researches updated before date (YYYY-MM-DD) | `--until 2024-12-31` |

### Output Format

Results are displayed as a table sorted by most recently updated:

```
| Research ID | Title              | Status    | Runs | Tags       | Last Updated |
|-------------|--------------------|-----------|------|------------|--------------|
| iris-2024   | Iris Clustering    | active    | 3    | ml, iris   | 2024-01-15   |
| churn-v2    | Customer Churn     | completed | 5    | sales      | 2024-01-10   |
| fraud-det   | Fraud Detection    | active    | 1    | security   | 2024-01-05   |
```
