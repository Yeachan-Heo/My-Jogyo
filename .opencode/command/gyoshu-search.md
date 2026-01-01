---
description: "[DEPRECATED] Search across all Gyoshu research projects and notebooks"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu search <query>`
>
> Example: `/gyoshu search $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu search $ARGUMENTS`

---

## Original Documentation

Search across research projects and notebooks in this project.

$ARGUMENTS

### Usage

```
/gyoshu search <query>                          # Search everywhere
/gyoshu search <query> --research-only          # Search research metadata only
/gyoshu search <query> --notebooks-only         # Search notebooks only
/gyoshu search <query> --no-outputs             # Exclude cell outputs from notebook search
/gyoshu search <query> --limit 20               # Limit results per category
```

### Search Scope

| Scope | Description | Tool Used |
|-------|-------------|-----------|
| Research | Title, goal, tags, status | `research-manager(action: "search")` |
| Notebooks | Code cells, markdown cells, outputs | `notebook-search` |

### Output Format

Results are displayed as:

```
## Search Results for "{query}"

### Research Projects ({N} matches)

| Research ID | Title | Status | Matched | Snippet |
|-------------|-------|--------|---------|---------|
| iris-2024 | Iris Species Analysis | active | title, goal | Goal: Analyze iris dataset... |

### Notebook Content ({N} matches)

| Research | Run | Cell | Type | Snippet |
|----------|-----|------|------|---------|
| iris-2024 | run_001 | cell-5 | code | ...correlation analysis of sepal... |

---
**To continue a research:** `/gyoshu continue <researchId>`
```
