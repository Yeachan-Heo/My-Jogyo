# Stage Protocol Specification

> **Version:** 1.0  
> **Status:** Draft  
> **Last Updated:** 2026-01-02

This document defines the stage-based execution protocol for Gyoshu/Jogyo research automation. Stages enable checkpoint/resume capability by decomposing research workflows into bounded, idempotent execution units.

---

## Table of Contents

1. [Overview](#overview)
2. [Stage Envelope Format](#stage-envelope-format)
3. [Stage Naming Convention](#stage-naming-convention)
4. [Idempotence Requirements](#idempotence-requirements)
5. [Artifact Naming](#artifact-naming)
6. [Stage Duration Limits](#stage-duration-limits)
7. [Stage State Machine](#stage-state-machine)
8. [Marker Format Reference](#marker-format-reference)

---

## Overview

### Purpose

Stages slice long-running research workflows into bounded execution units (max 4 minutes each). This enables:

- **Checkpoint/Resume**: Save progress at stage boundaries, resume from last checkpoint
- **Watchdog Supervision**: Gyoshu can interrupt stuck stages before they waste resources
- **Incremental Progress**: Each completed stage is durable progress, even if later stages fail
- **Parallelization**: Independent stages can run concurrently (future enhancement)

### Architecture Context

```
User (/gyoshu-auto goal)
        |
        v
  Gyoshu (Planner/Orchestrator)
   - Creates stage plan
   - Monitors stage execution (watchdog)
   - Makes checkpoint/resume decisions
        |
        | delegates "Stage N" (bounded, max 4 min)
        v
  Jogyo (Executor)
   - Executes single stage
   - Emits [STAGE:begin], [STAGE:end] markers
   - Writes artifacts at stage boundaries
```

---

## Stage Envelope Format

### Definition

A **stage envelope** is the metadata structure that defines a stage for delegation from Gyoshu to Jogyo.

### Required Fields

| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `stageId` | string | Unique identifier following naming convention | `"S01_load_data"` |
| `goal` | string | Human-readable description of stage objective | `"Load and validate the wine quality dataset"` |
| `inputs` | object | Input artifacts and their expected locations | `{ "dataset": "data/wine.csv" }` |
| `outputs` | object | Output artifacts to be produced | `{ "df": "wine_df.parquet" }` |
| `maxDurationSec` | number | Maximum execution time in seconds | `240` |

### Optional Fields

| Field | Type | Description | Default |
|-------|------|-------------|---------|
| `dependencies` | string[] | Stage IDs that must complete first | `[]` |
| `retryable` | boolean | Whether stage can be retried on failure | `true` |
| `checkpointAfter` | boolean | Whether to create checkpoint after completion | `true` |

### JSON Schema

```json
{
  "type": "object",
  "required": ["stageId", "goal", "inputs", "outputs", "maxDurationSec"],
  "properties": {
    "stageId": {
      "type": "string",
      "pattern": "^S[0-9]{2}_[a-z]+_[a-z_]+$"
    },
    "goal": {
      "type": "string",
      "minLength": 10,
      "maxLength": 200
    },
    "inputs": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "outputs": {
      "type": "object",
      "additionalProperties": { "type": "string" }
    },
    "maxDurationSec": {
      "type": "number",
      "minimum": 30,
      "maximum": 600
    },
    "dependencies": {
      "type": "array",
      "items": { "type": "string" }
    },
    "retryable": {
      "type": "boolean",
      "default": true
    },
    "checkpointAfter": {
      "type": "boolean",
      "default": true
    }
  }
}
```

### Example Stage Envelope

```json
{
  "stageId": "S02_eda",
  "goal": "Perform exploratory data analysis on wine quality dataset",
  "inputs": {
    "df": "wine_df.parquet"
  },
  "outputs": {
    "summary_stats": "eda_summary.json",
    "correlation_matrix": "correlation.png",
    "distribution_plots": "distributions.png"
  },
  "maxDurationSec": 240,
  "dependencies": ["S01_load_data"],
  "retryable": true,
  "checkpointAfter": true
}
```

---

## Stage Naming Convention

### Format

```
S{NN}_{verb}_{noun}
```

| Component | Description | Constraints |
|-----------|-------------|-------------|
| `S` | Stage prefix | Literal "S" |
| `{NN}` | Two-digit sequence number | 01-99, zero-padded |
| `{verb}` | Action being performed | Lowercase, no underscores |
| `{noun}` | Subject of the action | Lowercase, underscores allowed |

### Valid Stage ID Examples

| Stage ID | Description |
|----------|-------------|
| `S01_load_data` | Load dataset from source |
| `S02_validate_schema` | Validate data schema |
| `S03_clean_data` | Clean and preprocess data |
| `S04_explore_distributions` | Exploratory data analysis |
| `S05_engineer_features` | Feature engineering |
| `S06_split_dataset` | Train/test split |
| `S07_train_model` | Model training |
| `S08_evaluate_metrics` | Model evaluation |
| `S09_analyze_errors` | Error analysis |
| `S10_generate_report` | Generate final report |

### Common Verb Vocabulary

| Verb | Typical Usage |
|------|---------------|
| `load` | Loading data from files/APIs |
| `validate` | Schema/data validation |
| `clean` | Data cleaning, handling missing values |
| `explore` | EDA, visualizations |
| `engineer` | Feature engineering |
| `split` | Train/test/validation splits |
| `train` | Model training |
| `tune` | Hyperparameter tuning |
| `evaluate` | Model evaluation |
| `analyze` | Analysis (errors, features, etc.) |
| `generate` | Report/artifact generation |
| `export` | Exporting results |

### Invalid Stage IDs (Anti-patterns)

| Invalid ID | Problem | Correct Version |
|------------|---------|-----------------|
| `S1_load` | Single digit | `S01_load_data` |
| `stage01_load` | Wrong prefix | `S01_load_data` |
| `S01_LoadData` | Uppercase | `S01_load_data` |
| `S01-load-data` | Hyphens instead of underscores | `S01_load_data` |
| `S01_data` | Missing verb | `S01_load_data` |
| `S01_do_stuff` | Vague verb | `S01_load_data` |

---

## Idempotence Requirements

### Definition

A stage is **idempotent** if re-running it with the same inputs produces the same outputs, without side effects from previous runs.

### Core Requirements

#### 1. Unique Artifact Names

Artifacts MUST include run context to avoid collisions:

```python
# WRONG: Will overwrite on retry
model.save("model.pkl")

# CORRECT: Run-scoped artifact
model.save(f"{run_id}/{stage_id}/model.pkl")
```

#### 2. No In-Place Mutation

Never modify input artifacts:

```python
# WRONG: Mutates input
df = pd.read_parquet(inputs["df"])
df.to_parquet(inputs["df"])  # Overwrites input!

# CORRECT: Write to output location
df = pd.read_parquet(inputs["df"])
df_clean = df.dropna()
df_clean.to_parquet(outputs["df_clean"])
```

#### 3. Deterministic Operations (When Possible)

Set random seeds for reproducibility:

```python
import numpy as np
import random

# At stage start
np.random.seed(42)
random.seed(42)

# For ML frameworks
import torch
torch.manual_seed(42)

import tensorflow as tf
tf.random.set_seed(42)
```

#### 4. Atomic Writes

Use atomic write patterns to prevent partial artifacts:

```python
import tempfile
import shutil

# Atomic file write pattern
with tempfile.NamedTemporaryFile(mode='wb', delete=False) as tmp:
    pickle.dump(model, tmp)
    tmp_path = tmp.name
shutil.move(tmp_path, final_path)
```

### Idempotence Checklist

Before marking a stage complete, verify:

- [ ] All outputs use run-scoped paths (`{runId}/{stageId}/...`)
- [ ] No input files are modified
- [ ] Random seeds are set (if applicable)
- [ ] File writes are atomic (temp file + rename)
- [ ] External API calls are cached or skipped on retry
- [ ] Database operations use upsert semantics

### Exception: Stateful Stages

Some stages inherently have side effects (e.g., sending emails, calling external APIs). Mark these as `retryable: false` in the envelope:

```json
{
  "stageId": "S10_notify_stakeholders",
  "goal": "Send completion notification",
  "retryable": false,
  "checkpointAfter": false
}
```

---

## Artifact Naming

### Path Format

```
{runId}/{stageId}/{artifactName}
```

| Component | Description | Example |
|-----------|-------------|---------|
| `{runId}` | Unique run identifier | `run-20260102-143022` |
| `{stageId}` | Stage that produced the artifact | `S02_eda` |
| `{artifactName}` | Descriptive artifact name | `correlation_matrix.png` |

### Full Path Example

```
reports/wine-quality/run-20260102-143022/S02_eda/correlation_matrix.png
```

### Directory Structure

```
reports/{reportTitle}/
├── run-20260102-143022/
│   ├── S01_load_data/
│   │   ├── wine_df.parquet
│   │   └── schema_validation.json
│   ├── S02_eda/
│   │   ├── summary_stats.json
│   │   ├── correlation_matrix.png
│   │   └── distributions.png
│   ├── S03_train_model/
│   │   ├── model.pkl
│   │   ├── training_metrics.json
│   │   └── feature_importance.png
│   └── checkpoints/
│       ├── ckpt-S01.json
│       ├── ckpt-S02.json
│       └── ckpt-S03.json
└── run-20260102-160530/  # Second run
    └── ...
```

### Artifact Naming Guidelines

| Artifact Type | Naming Pattern | Example |
|---------------|----------------|---------|
| DataFrames | `{name}_df.parquet` | `wine_df.parquet` |
| Models | `{name}_model.pkl` | `rf_model.pkl` |
| Metrics | `{name}_metrics.json` | `training_metrics.json` |
| Plots | `{name}.png` | `correlation_matrix.png` |
| Reports | `{name}_report.md` | `eda_report.md` |
| Logs | `{name}.log` | `training.log` |

### Referencing Artifacts Between Stages

In stage envelopes, reference artifacts by their path relative to the run directory:

```json
{
  "stageId": "S03_train_model",
  "inputs": {
    "train_df": "S02_prepare_data/train_df.parquet",
    "test_df": "S02_prepare_data/test_df.parquet"
  },
  "outputs": {
    "model": "model.pkl",
    "metrics": "training_metrics.json"
  }
}
```

The executor resolves these to full paths:
- Input: `reports/{reportTitle}/{runId}/S02_prepare_data/train_df.parquet`
- Output: `reports/{reportTitle}/{runId}/S03_train_model/model.pkl`

---

## Stage Duration Limits

### Duration Tiers

| Tier | Duration | Use Case | Examples |
|------|----------|----------|----------|
| Quick | 30s - 60s | Simple operations | Load CSV, validate schema |
| Standard | 60s - 240s | Most stages | EDA, feature engineering |
| Extended | 240s - 480s | Complex computation | Model training, hyperparameter tuning |
| Maximum | 480s - 600s | Exceptional cases | Large dataset processing |

### Default Values

| Parameter | Value | Notes |
|-----------|-------|-------|
| Default `maxDurationSec` | 240 (4 min) | Used if not specified in envelope |
| Soft limit | `maxDurationSec` | Warning emitted, grace period starts |
| Hard limit | `maxDurationSec + 30s` | Interrupt signal sent |
| Absolute maximum | 600s (10 min) | Cannot be exceeded regardless of envelope |

### Duration Guidelines

#### When to Use Quick (30-60s)
- Loading small datasets (<100MB)
- Schema validation
- Simple data transformations
- Configuration loading

#### When to Use Standard (60-240s)
- Exploratory data analysis
- Feature engineering
- Data cleaning
- Model evaluation
- Report generation

#### When to Use Extended (240-480s)
- Training machine learning models
- Hyperparameter tuning (limited grid)
- Processing large datasets
- Complex visualizations

#### When to Use Maximum (480-600s)
- Deep learning training epochs
- Exhaustive hyperparameter search
- Very large dataset operations

### Timeout Escalation

```
Time 0                          maxDurationSec              maxDurationSec + 30s
  |                                   |                              |
  |====== Normal Execution ===========|===== Grace Period ============|
                                      |                              |
                               Soft timeout:              Hard timeout:
                               - Log warning               - SIGINT sent
                               - Emit [STAGE:progress]     - Emergency checkpoint
                               - Continue execution        - Escalate to SIGTERM if needed
```

### Splitting Long Operations

If an operation exceeds 4 minutes, split it:

```python
# WRONG: Single 15-minute training stage
# S05_train_model: Train model for 100 epochs

# CORRECT: Split into checkpoint-friendly stages
# S05_train_initial: Train model for 30 epochs
# S06_train_continued: Continue training for 30 epochs
# S07_train_final: Final 40 epochs with early stopping
```

---

## Stage State Machine

### States

| State | Description |
|-------|-------------|
| `PENDING` | Stage is queued, not yet started |
| `RUNNING` | Stage is currently executing |
| `COMPLETED` | Stage finished successfully |
| `INTERRUPTING` | Interrupt signal sent, waiting for cleanup |
| `INTERRUPTED` | Stage was interrupted (checkpoint may exist) |
| `FAILED` | Stage execution failed |
| `RESUMABLE` | Stage can be resumed from checkpoint |
| `BLOCKED` | Stage cannot proceed (missing dependencies, no checkpoint) |

### State Transitions

```
PENDING ─────────────────────► RUNNING
                                  │
                                  ├──────────────────► COMPLETED
                                  │
                                  ├──► INTERRUPTING ──► INTERRUPTED ──► RESUMABLE
                                  │                                         │
                                  │                                         ▼
                                  └──► FAILED ────────► RESUMABLE ◄────────┘
                                             │          (if checkpoint exists)
                                             │
                                             └────────► BLOCKED
                                                       (if no checkpoint)
```

### State Transition Rules

| From | To | Trigger | Notes |
|------|----|---------|-------|
| PENDING | RUNNING | Jogyo begins execution | Emit `[STAGE:begin]` |
| RUNNING | COMPLETED | Stage finishes successfully | Emit `[STAGE:end:status=success]` |
| RUNNING | INTERRUPTING | Watchdog timeout or manual abort | Send SIGINT |
| RUNNING | FAILED | Unhandled exception | Emit `[STAGE:end:status=failed]` |
| INTERRUPTING | INTERRUPTED | Clean shutdown achieved | Emergency checkpoint saved |
| INTERRUPTED | RESUMABLE | Checkpoint validated | Can be resumed |
| FAILED | RESUMABLE | Checkpoint exists and valid | Can retry from checkpoint |
| FAILED | BLOCKED | No checkpoint available | Must restart from previous stage |

---

## Marker Format Reference

### STAGE Marker

Signals stage lifecycle events in REPL output.

**Format:**
```
[STAGE:{subtype}:{attributes}]
```

**Subtypes:**

| Subtype | When | Example |
|---------|------|---------|
| `begin` | Stage starts | `[STAGE:begin:id=S01_load_data]` |
| `end` | Stage completes | `[STAGE:end:id=S01_load_data:status=success:duration=45s]` |
| `progress` | Progress update | `[STAGE:progress:id=S01_load_data:pct=50:msg=Loading rows]` |

**Attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Stage ID |
| `status` | On `end` | `success`, `failed`, `interrupted` |
| `duration` | On `end` | Execution time |
| `pct` | On `progress` | Percentage complete (0-100) |
| `msg` | On `progress` | Human-readable progress message |

### CHECKPOINT Marker

Signals checkpoint operations.

**Format:**
```
[CHECKPOINT:{subtype}:{attributes}]
```

**Subtypes:**

| Subtype | When | Example |
|---------|------|---------|
| `saved` | Checkpoint written | `[CHECKPOINT:saved:id=ckpt-001:stage=S02_eda]` |
| `begin` | Checkpoint process starting | `[CHECKPOINT:begin:id=ckpt-001]` |
| `end` | Checkpoint process complete | `[CHECKPOINT:end:id=ckpt-001:status=success]` |
| `emergency` | Watchdog-triggered checkpoint | `[CHECKPOINT:emergency:id=ckpt-002:reason=timeout]` |

**Attributes:**

| Attribute | Required | Description |
|-----------|----------|-------------|
| `id` | Yes | Checkpoint ID |
| `stage` | Yes | Stage ID this checkpoint covers |
| `status` | On `end` | `success`, `failed` |
| `manifest` | On `saved` | Path to checkpoint manifest |
| `reason` | On `emergency` | `timeout`, `abort`, `error` |

### REHYDRATED Marker

Signals session restored from checkpoint.

**Format:**
```
[REHYDRATED:from={checkpointId}]
```

**Example:**
```
[REHYDRATED:from=ckpt-001]
```

---

## Checkpoint Trust Levels

When checkpoints are shared between systems or users, the trust level should be set appropriately:

### Trust Level Specification

```typescript
type TrustLevel = "local" | "imported" | "untrusted";
```

### Validation Matrix

| Check | local | imported | untrusted |
|-------|-------|----------|-----------|
| Manifest SHA256 | ✅ | ✅ | ✅ |
| Artifact SHA256 | ✅ | ✅ | ✅ |
| Artifact size | ✅ | ✅ | ✅ |
| Path traversal | ✅ | ✅ | ✅ |
| Symlink (final) | ✅ | ✅ | ✅ |
| Parent dir symlinks | ❌ | ✅ | ✅ |
| User confirmation | ❌ | ❌ | ⚠️ |

### Marking Imported Checkpoints

When importing a checkpoint from another source:

1. Set `trustLevel: "imported"` in the manifest
2. Or use: `checkpoint-manager(action: "save", ..., trustLevel: "imported")`

### Security Warning for Untrusted Checkpoints

Rehydration code executes Python. For untrusted checkpoints:
- Always review the `rehydrationCellSource` before execution
- Consider running in an isolated environment
- The resume action returns a `trustWarning` field

---

## References

- [marker-parser.ts](../src/lib/marker-parser.ts) - Marker parsing implementation
- [checkpoint-resume-system.md](../plans/feature/ai-todolist-20260102-checkpoint-resume-system.md) - Implementation plan
- [gyoshu.md](../src/agent/gyoshu.md) - Gyoshu planner agent
- [jogyo.md](../src/agent/jogyo.md) - Jogyo executor agent
