# Gyoshu Architecture: Notebook-Centric Design

This document explains the design principles and technical architecture of the Gyoshu notebook-centric research system.

## 1. Core Principles

### Notebooks as the Source of Truth
In the previous architecture, research metadata was stored in a `research.json` manifest file. In the new architecture, **the Jupyter notebook is the source of truth**. All research metadata, run history, and status information are stored directly within the notebook file.

### Self-Describing Research
Each research project is a self-contained notebook. If you move the notebook, you move the research. By using YAML frontmatter in a raw cell, notebooks become compatible with tools like Quarto while remaining easy for Gyoshu to parse and update.

### Physical Workspace Organization
Workspaces are no longer virtual tags; they are **physical directories** within the `notebooks/` root. This makes organization intuitive and visible in any file browser or Jupyter interface.

## 2. Directory Structure

### Durable Assets (Git-tracked)
- `notebooks/`: The home for all research notebooks.
  - `{workspace}/`: Topic-based folders.
  - `_quick/`: Default folder for ad-hoc analysis.
  - `README.md`: Auto-generated index of all workspaces and recent activity.
- `outputs/`: Mirrors the `notebooks/` structure for large artifacts.
  - `{workspace}/{slug}/figures/`: Saved plots and visualizations.
  - `{workspace}/{slug}/models/`: Saved model weights and binaries.
  - `{workspace}/{slug}/exports/`: Data exports (CSV, Parquet, etc.).

### Ephemeral Data (Gitignored)
- `gyoshu/runtime/`: Contains active session locks, Unix sockets for the Python bridge, and temporary runtime metadata. This directory is strictly for ephemeral state and is never committed.

## 3. Metadata Schema (YAML Frontmatter)

Metadata is stored in the first cell of the notebook (type: `raw`).

```yaml
---
# Gyoshu Research Metadata
gyoshu:
  schema_version: 1
  workspace: customer-analytics
  slug: churn-prediction
  status: active
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T15:00:00Z"
  tags: [ml, classification, xgboost]
  
  # Last 10 runs for quick context
  runs:
    - id: run-001
      started: "2026-01-01T10:00:00Z"
      status: completed
      notes: "Baseline model with default parameters"
---
```

## 4. Discovery & Indexing

### Auto-generated READMEs
Gyoshu maintains `README.md` files in each workspace and at the root of `notebooks/`. These files use **sentinel blocks** to protect manual edits:

```markdown
# My Workspace
User-written introduction here.

<!-- GYOSHU:INDEX:BEGIN -->
| Research | Status | Updated | Tags |
|----------|--------|---------|------|
| [my-proj](./my-proj.ipynb) | active | 2026-01-01 | eda |
<!-- GYOSHU:INDEX:END -->

User-written conclusion here.
```

### Profile Detection
Gyoshu automatically detects the project layout by looking for `notebooks/`, `nbs/`, or `analysis/` directories. This allows it to adapt to existing project conventions.

## 5. Workflow Integration

1. **Creation**: `/gyoshu <goal>` creates a new notebook with the appropriate frontmatter.
2. **Execution**: During execution, `python-repl` captures outputs and updates the notebook.
3. **Tagging**: Cells are automatically tagged with `gyoshu-objective`, `gyoshu-finding`, etc., to provide structure.
4. **Maintenance**: `/gyoshu workspace sync` ensures all indexes are up to date.

## 6. Migration

Legacy research is supported through a dual-read mechanism. The `/gyoshu migrate --to-notebooks` command automates the transition by:
1. Reading legacy `research.json` files.
2. Injecting that metadata into the notebook's YAML frontmatter.
3. Moving notebooks and artifacts to the new hierarchical structure.
