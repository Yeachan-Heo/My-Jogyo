# AGENTS.md - Gyoshu Repository Guide

> Guidelines for AI agents operating in this repository.

## Overview

Gyoshu is a scientific research agent extension for OpenCode. It provides:
- Persistent Python REPL with structured output markers
- Jupyter notebook integration for reproducible research
- Session management for research workflows

## The Agent Team

| Agent | Role | Korean | What They Do |
|-------|------|--------|--------------|
| **Gyoshu** | Professor | 교수 | Plans research, orchestrates workflow, manages sessions |
| **Jogyo** | Teaching Assistant | 조교 | Executes Python code, runs experiments, generates outputs |
| **Baksa** | PhD Reviewer | 박사 | Adversarial verifier - challenges claims, calculates trust scores |
| **Jogyo Paper Writer** | Grad Student | 조교 | Transforms raw findings into narrative research reports |

## Build & Test Commands

### Python Tests (pytest)

```bash
# Run all tests
pytest

# Run with verbose output (default via pyproject.toml)
pytest -v --tb=short

# Run a single test file
pytest tests/test_bridge.py

# Run a specific test class
pytest tests/test_bridge.py::TestParseMarkers

# Run a single test
pytest tests/test_bridge.py::TestParseMarkers::test_simple_marker

# Run with coverage
pytest --cov=src/bridge --cov-report=term-missing
```

### TypeScript/JavaScript (Bun)

```bash
# Run all tests
bun test

# Watch mode for development
bun test --watch

# Run a specific test file
bun test src/tool/session-manager.test.ts
```

### No Build Step Required

This is an OpenCode extension - no compilation needed. TypeScript files are executed directly by Bun.

## Code Style Guidelines

### Python (.py files)

#### Imports
```python
# Standard library first (alphabetical within each category)
import argparse
import json
import os
import sys
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Callable

# Third-party next (blank line before)
import pytest

# Local imports last (blank line before)
from gyoshu_bridge import parse_markers, execute_code
```

#### Type Hints (Required)
```python
from typing import Any, Dict, List, Optional

def execute_code(code: str, namespace: dict) -> Dict[str, Any]:
    """Execute Python code in the given namespace."""
    ...

def parse_markers(text: str) -> List[Dict]:
    ...
```

#### Docstrings
```python
"""Module-level docstring at the top of each file.

Describe the module's purpose and key components.
Include protocol formats, methods, or usage examples.
"""

def send_response(
    id: Optional[str],
    result: Optional[Dict] = None,
    error: Optional[Dict] = None
) -> None:
    """Send JSON-RPC 2.0 response via protocol channel."""
    ...
```

#### Naming Conventions
- `UPPER_SNAKE_CASE` for constants: `JSON_RPC_VERSION`, `ERROR_PARSE`
- `PascalCase` for classes: `ExecutionState`, `TestParseMarkers`
- `snake_case` for functions/variables: `send_response`, `parse_markers`
- `_leading_underscore` for private/internal: `_send_protocol`, `_protocol_fd`

#### Section Organization
```python
# =============================================================================
# SECTION NAME IN ALL CAPS
# =============================================================================

# Code for this section...
```

#### Error Handling
```python
# Use specific exception types with descriptive context
try:
    result = json.loads(data)
except json.JSONDecodeError as e:
    return make_error(ERROR_PARSE, f"Parse error: {e}")
except TimeoutError as e:
    result["exception"] = str(e)
    result["exception_type"] = "TimeoutError"
except KeyboardInterrupt:
    result["exception"] = "Execution interrupted"
    result["exception_type"] = "KeyboardInterrupt"
except Exception as e:
    # Last resort - always include type and message
    result["exception"] = str(e)
    result["exception_type"] = type(e).__name__
    
# Never use bare except
# Never silently swallow exceptions
```

### TypeScript (.ts files)

#### Imports
```typescript
// External packages first
import { tool } from "@opencode-ai/plugin";

// Built-in Node modules next
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// Local modules last (use multi-line for readability)
import { durableAtomicWrite, fileExists, readFile } from "../lib/atomic-write";
import {
  getRuntimeDir,
  getSessionDir,
  ensureDirSync,
  existsSync,
} from "../lib/paths";
```

#### JSDoc Comments
```typescript
/**
 * Session Manager - OpenCode tool for managing Gyoshu research sessions
 *
 * Provides CRUD operations for session manifests with:
 * - Atomic, durable writes to prevent data corruption
 * - Cell execution tracking with content hashes
 *
 * @module session-manager
 */

// Import from centralized path resolver (see src/lib/paths.ts)
import { getRuntimeDir, getResearchDir } from "../lib/paths";

/**
 * Get the runtime directory for a specific session.
 * Uses centralized path resolver for consistency.
 */
const runtimeDir = getRuntimeDir(sessionId);

/**
 * Get the research directory for storing research manifests.
 * Always use path helpers instead of hardcoding paths.
 */
const researchDir = getResearchDir();
```

#### Interfaces and Types
```typescript
// Descriptive JSDoc for each interface
/**
 * Environment metadata captured for reproducibility.
 */
interface EnvironmentMetadata {
  /** Python interpreter version */
  pythonVersion: string;
  /** Operating system platform */
  platform: string;
}

// Use type for unions
type SessionMode = "PLANNER" | "AUTO" | "REPL";
type GoalStatus = "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED";
```

#### Naming Conventions
- `PascalCase` for interfaces/types: `SessionManifest`, `CellExecution`
- `UPPER_SNAKE_CASE` for constants: `DEFAULT_TIMEOUT`, `MAX_RETRIES`
- `camelCase` for variables/functions: `researchSessionID`, `readFile`

### Test Files

#### Python Tests (pytest)
```python
import pytest

class TestModuleName:
    """Tests for module_name - brief description."""

    def test_specific_behavior(self):
        """What this test verifies."""
        result = function_under_test(input)
        assert result["expected_key"] == expected_value

    @pytest.fixture
    def setup_data(self):
        """Fixture description."""
        return {"test": "data"}
```

#### TypeScript Tests (Bun)
```typescript
import { describe, test, expect } from "bun:test";

describe("ModuleName", () => {
  test("specific behavior", () => {
    const result = functionUnderTest(input);
    expect(result.expectedKey).toBe(expectedValue);
  });
});
```

## Slash Commands

Gyoshu provides **two commands** for all research operations:

| Command | Purpose |
|---------|---------|
| `/gyoshu [subcommand\|goal]` | Unified interactive research command |
| `/gyoshu-auto <goal>` | Autonomous research (hands-off bounded execution) |

### `/gyoshu` - Unified Research Command

The main entry point for all research operations. Supports subcommands and direct goals.

| Subcommand | Description | Example |
|------------|-------------|---------|
| *(no args)* | Show status and suggestions | `/gyoshu` |
| `<goal>` | Start new research with discovery | `/gyoshu analyze customer churn` |
| `plan <goal>` | Create research plan only | `/gyoshu plan classify iris species` |
| `continue [id]` | Continue existing research | `/gyoshu continue iris-clustering` |
| `list [--status X]` | List all research projects | `/gyoshu list --status active` |
| `search <query>` | Search researches & notebooks | `/gyoshu search "correlation"` |
 | `report [id]` | Generate research report | `/gyoshu report` |
 | `repl <query>` | Direct REPL exploration | `/gyoshu repl show df columns` |
 | `migrate [--options]`| Migrate legacy data | `/gyoshu migrate --to-notebooks` |
 | `replay <sessionId>` | Replay for reproducibility | `/gyoshu replay ses_abc123` |
 | `unlock <sessionId>` | Unlock stuck session | `/gyoshu unlock ses_abc123` |
 | `abort [sessionId]` | Abort current research | `/gyoshu abort` |
 | `help` | Show usage and examples | `/gyoshu help` |

### `/gyoshu-auto` - Autonomous Research

Runs research autonomously with bounded cycles (max 10). Executes until completion, blocked, or budget exhausted.

```bash
/gyoshu-auto analyze wine quality factors using XGBoost
```

Use this when you have a clear goal and want hands-off execution.

### Quick Examples

```bash
# See current status and suggestions
/gyoshu

# Start interactive research (searches for similar prior work first)
/gyoshu analyze customer churn patterns

# Continue previous research
/gyoshu continue churn-analysis

# Search across all notebooks and research
/gyoshu search "feature importance"

# Generate a report for the current research
/gyoshu report

# Hands-off autonomous research
/gyoshu-auto cluster wine dataset and identify quality predictors
```

## Adversarial Verification Protocol

Gyoshu implements a "Never Trust" philosophy where every claim from Jogyo must be verified by Baksa before acceptance.

### The Challenge Loop

1. **Jogyo Completes Work**: Signals completion with evidence via `gyoshu_completion`
2. **Gyoshu Gets Snapshot**: Reviews current state via `gyoshu_snapshot`
3. **Baksa Challenges**: Generates probing questions and calculates trust score
4. **Decision**:
   - Trust >= 80: VERIFIED - Accept result
   - Trust 60-79: PARTIAL - Accept with caveats
   - Trust < 60: DOUBTFUL - Request rework from Jogyo
5. **Max 3 Rounds**: If verification fails 3 times, escalate to BLOCKED

### Trust Score Components

| Component | Weight | Description |
|-----------|--------|-------------|
| Evidence Quality | 30% | Artifacts exist, code is reproducible |
| Metric Verification | 25% | Independent checks match claimed values |
| Completeness | 20% | All objectives addressed |
| Consistency | 15% | No contradictions in findings |
| Methodology | 10% | Sound approach, no obvious flaws |

### Challenge Response Markers

When Jogyo responds to challenges, use these markers:

```python
# Respond to a specific challenge (N = challenge number)
print("[CHALLENGE-RESPONSE:1] Re-verified correlation with alternative method")

# Provide reproducible verification code
print("[VERIFICATION-CODE] df['accuracy'].mean() == 0.95")

# Show independent cross-validation
print("[INDEPENDENT-CHECK] 5-fold CV confirms accuracy: 0.94 ± 0.02")
```

### Example Challenge Flow

```
1. Jogyo: "Model accuracy is 95%"
2. Baksa challenges:
   - "Re-run with different random seed"
   - "Show confusion matrix"
   - "What's the baseline accuracy?"
3. Trust Score: 45 (DOUBTFUL)
4. Gyoshu sends rework request to Jogyo
5. Jogyo responds with enhanced evidence
6. Baksa re-evaluates: Trust Score 82 (VERIFIED)
7. Gyoshu accepts result
```

## Structured Output Markers

When working with Gyoshu REPL output, use these markers:

```python
# Research Process
print("[OBJECTIVE] Research goal statement")
print("[HYPOTHESIS] Proposed explanation")
print("[CONCLUSION] Final conclusions")

# Data Operations
print("[DATA] Dataset description")
print(f"[SHAPE] {df.shape}")

# Metrics
print(f"[METRIC:accuracy] {accuracy:.4f}")
print(f"[STAT:mean] {value:.2f}")

# Insights
print("[FINDING] Key discovery")
print("[PATTERN] Identified pattern")
```

## Report Generation

Gyoshu can generate publication-quality research reports from notebooks and export them to PDF.

### Report Markers

Reports are generated by extracting structured markers from notebook cell outputs. Use these markers in your REPL output to populate report sections:

| Marker | Report Section | Description |
|--------|----------------|-------------|
| `[OBJECTIVE]` | Executive Summary | Research goal statement |
| `[HYPOTHESIS]` | Hypotheses | Proposed explanations |
| `[METRIC:name]` | Performance Metrics | Named metrics with values |
| `[FINDING]` | Key Findings | Important discoveries |
| `[LIMITATION]` | Limitations | Known constraints |
| `[NEXT_STEP]` | Recommended Next Steps | Follow-up actions |
| `[CONCLUSION]` | Conclusion | Final summary |

### Automatic Report Generation

When research completes with SUCCESS status, a markdown report is automatically generated and saved to:

```
reports/{reportTitle}/report.md
```

The report includes:
- **Executive Summary**: Objective, key metrics, and status
- **Hypotheses**: All proposed explanations
- **Performance Metrics**: Table of all `[METRIC:name]` values
- **Key Findings**: Numbered list of discoveries
- **Output Files**: Artifacts from the reports directory
- **Conclusion**: Final research summary

### Manual Report Generation

Generate a report manually using the `/gyoshu report` command:

```bash
# Generate report for current research
/gyoshu report

# Generate report for specific research
/gyoshu report my-research-slug
```

Or via the research-manager tool:

```typescript
research-manager(action: "report", reportTitle: "my-research")
```

### PDF Export

Export markdown reports to PDF using available converters:

| Priority | Converter | Quality | Install Command |
|----------|-----------|---------|-----------------|
| 1 | pandoc | Best (LaTeX math support) | `apt install pandoc texlive-xetex` or `brew install pandoc basictex` |
| 2 | wkhtmltopdf | Good (widely available) | `apt install wkhtmltopdf` or `brew install wkhtmltopdf` |
| 3 | weasyprint | Good (CSS-based) | `pip install weasyprint` |

Export via the research-manager tool:

```typescript
research-manager(action: "export-pdf", reportTitle: "my-research")
```

PDF files are saved to:

```
reports/{reportTitle}/report.pdf
```

> **Note**: At least one PDF converter must be installed for PDF export. Gyoshu automatically detects and uses the best available converter.

### Automatic PDF Export on Completion

When using the `gyoshu-completion` tool with `exportPdf: true`, PDF export happens automatically after report generation:

```typescript
gyoshu-completion({
  researchSessionID: "my-session",
  status: "SUCCESS",
  summary: "Research complete",
  evidence: { ... },
  exportPdf: true  // Automatically exports report.pdf after generating report.md
})
```

This is useful for autonomous research workflows where you want both the markdown report and PDF export without a separate step.

## Checkpoint System

Gyoshu provides checkpoint/resume capability for long-running research:

### Stage Protocol

Research is divided into bounded stages (max 4 minutes each):
- Each stage has a unique ID: `S{NN}_{verb}_{noun}` (e.g., `S01_load_data`)
- Stages emit markers: `[STAGE:begin]`, `[STAGE:progress]`, `[STAGE:end]`
- Checkpoints are created at stage boundaries

### Checkpoint Markers

```python
# Stage boundaries
print("[STAGE:begin:id=S01_load_data]")
print("[STAGE:end:id=S01_load_data:duration=120s]")

# Checkpoint saved
print("[CHECKPOINT:saved:id=ckpt-001:stage=S01_load_data]")

# Rehydrated from checkpoint
print("[REHYDRATED:from=ckpt-001]")
```

### Checkpoint Storage

```
reports/{reportTitle}/checkpoints/{runId}/{checkpointId}/
└── checkpoint.json    # Manifest with artifact hashes
```

### Resume Commands

```bash
# Continue research (auto-detects checkpoints)
/gyoshu continue my-research

# List checkpoints
checkpoint-manager(action: "list", reportTitle: "my-research")

# Resume from specific checkpoint
checkpoint-manager(action: "resume", reportTitle: "my-research", runId: "run-001")
```

### Troubleshooting

| Issue | Solution |
|-------|----------|
| "No valid checkpoints" | Artifacts may be missing or corrupted. Check `reports/*/checkpoints/` |
| "Manifest SHA256 mismatch" | Checkpoint file was modified. Use previous checkpoint |
| "Session locked" | Use `/gyoshu unlock <sessionId>` after verifying no active process |

### Checkpoint Manager Actions

| Action | Description |
|--------|-------------|
| `save` | Create new checkpoint at stage boundary |
| `list` | List all checkpoints for a research/run |
| `validate` | Verify checkpoint integrity (manifest + artifacts) |
| `resume` | Find last valid checkpoint and generate rehydration code |
| `prune` | Keep only last N checkpoints (default: 5) |
| `emergency` | Fast checkpoint for watchdog/abort (skips validation) |

### Trust Levels

Checkpoints have a trust level that controls security validation:

| Level | Description | Validation |
|-------|-------------|------------|
| `local` | Created by this system (default) | Standard validation |
| `imported` | Copied from another project | + Parent directory symlink check |
| `untrusted` | From external/unknown source | + Parent symlink check + User confirmation |

**When to use each level:**
- `local`: Normal checkpoints created during research (automatic)
- `imported`: When copying checkpoints from a colleague or another machine
- `untrusted`: When loading checkpoints from the internet or unknown sources

**Security implications:**
- `local` checkpoints trust the local filesystem
- `imported` and `untrusted` checkpoints verify that parent directories aren't symlinks (prevents escape attacks)
- `untrusted` checkpoints show a warning before resume, as rehydration code could execute arbitrary Python

**Example:**
```bash
# Save with explicit trust level (for imported checkpoint)
checkpoint-manager(action: "save", ..., trustLevel: "imported")

# Resume will show warning for non-local checkpoints
checkpoint-manager(action: "resume", reportTitle: "imported-research")
# Returns: { ..., trustWarning: "Checkpoint is imported - verify source before resuming" }
```

## Project Structure

### Durable (Tracked in Git)

```
Gyoshu/
├── notebooks/                    # Research notebooks (default location)
│   ├── README.md                 # Auto-generated index
│   ├── _migrated/                # Migrated legacy research
│   └── {reportTitle}.ipynb       # Self-describing notebooks
│
├── reports/                      # Research reports (mirrors notebooks)
│   └── {reportTitle}/
│       ├── README.md             # Combined report view
│       ├── figures/
│       ├── models/
│       ├── exports/
│       ├── report.md             # Generated research report
│       └── report.pdf            # PDF export (if converter available)
│
├── src/                          # OpenCode extension source
│   ├── agent/                    # Agent definitions
│   ├── command/                  # Slash commands
│   ├── tool/                     # Tool implementations
│   ├── lib/                      # Shared utilities
│   ├── bridge/                   # Python REPL bridge
│   └── skill/                    # Research skills
├── data/                         # Datasets
├── .venv/                        # Python environment
└── ...
```

### Ephemeral (OS Temp Directory)

Runtime data is stored in OS-appropriate temp directories, NOT in the project root:

```
Linux (with XDG_RUNTIME_DIR):
$XDG_RUNTIME_DIR/gyoshu/          # Usually /run/user/{uid}/gyoshu
└── {shortSessionId}/
    ├── bridge.sock               # Python REPL socket
    ├── session.lock              # Session lock
    └── bridge_meta.json          # Runtime state

macOS:
~/Library/Caches/gyoshu/runtime/
└── {shortSessionId}/...

Linux (fallback):
~/.cache/gyoshu/runtime/
└── {shortSessionId}/...
```

**Environment Variable Override**: Set `GYOSHU_RUNTIME_DIR` to force a custom location.

**Note**: Session IDs are hashed to 12 characters to respect Unix socket path limits (~108 bytes).

## Notebook-Centric Architecture

Gyoshu stores research metadata **in notebooks**, not separate JSON files:

### Notebook Frontmatter
Each notebook has YAML frontmatter in the first cell (raw cell):

```yaml
---
# Quarto-compatible fields (optional)
title: "Customer Churn Prediction"
date: 2026-01-01

# Gyoshu-specific fields
gyoshu:
  schema_version: 1
  reportTitle: churn-prediction         # Notebook identifier
  status: active                     # active | completed | archived
  created: "2026-01-01T10:00:00Z"
  updated: "2026-01-01T15:00:00Z"
  tags: [ml, classification]
  runs:
    - id: run-001
      started: "2026-01-01T10:00:00Z"
      status: completed
---
```

### Cell Tags (Papermill-style)
Cells are tagged with `gyoshu-*` markers in metadata to structure the research:
- `gyoshu-objective`, `gyoshu-hypothesis`, `gyoshu-finding`, etc.

## Key Files

| File | Purpose |
|------|---------|
| `src/bridge/gyoshu_bridge.py` | JSON-RPC Python execution bridge |
| `src/tool/research-manager.ts` | Research operations |
| `src/tool/session-manager.ts` | Runtime session management |
| `src/tool/python-repl.ts` | REPL tool interface |
| `src/tool/notebook-writer.ts` | Jupyter notebook generation |
| `src/tool/migration-tool.ts` | Legacy session migration utility |
| `src/tool/notebook-search.ts` | Notebook content search |
| `src/lib/notebook-frontmatter.ts`| Frontmatter parsing/updating |
| `src/lib/readme-index.ts` | README index generation |
| `src/lib/paths.ts` | Centralized path resolver |
| `src/lib/report-markdown.ts` | Report generation library |
| `src/lib/pdf-export.ts` | PDF export utilities |
| `tests/test_bridge.py` | Bridge unit tests |

## Common Tasks

### Adding a New Test
1. Create test class in appropriate file under `tests/`
2. Use `test_` prefix for test methods
3. Run: `pytest tests/test_file.py::TestClass::test_method -v`

### Modifying the Python Bridge
1. Edit `src/bridge/gyoshu_bridge.py`
2. Run tests: `pytest tests/test_bridge.py -v`
3. Test manually with JSON-RPC messages

### Working with Research
Research is now stored in the `notebooks/` directory by default.

```
./notebooks/
├── README.md                      # Auto-generated root index
└── {reportTitle}.ipynb            # Research notebook with YAML frontmatter
```

Reports are stored in a mirrored structure:
```
./reports/
└── {reportTitle}/
    ├── README.md                  # Combined report view
    ├── figures/                   # Saved plots
    ├── models/                    # Saved model files
    └── exports/                   # Data exports (CSV, etc.)
```

> **Migration Note**: Legacy research stored at `gyoshu/research/` or `~/.gyoshu/sessions/` is still readable. Use the `/gyoshu migrate --to-notebooks` command to move data to the new structure.

## Python Environment Management

Gyoshu automatically detects and uses Python virtual environments to ensure research reproducibility. It supports multiple environment managers with the following priority:

### Detection Priority (for existing environments)

| Priority | Type | Detection Method | Command Used |
|----------|------|------------------|--------------|
| 1 | Custom | `GYOSHU_PYTHON_PATH` env var | Direct path |
| 2 | venv | `./venv/bin/python` exists | Direct path |
| 3 | venv | `./.venv/bin/python` exists | Direct path |
| 4 | Gyoshu venv | `./gyoshu/venv/bin/python` exists | Direct path |
| 5 | uv | `uv.lock` or `[tool.uv]` in pyproject.toml | `uv run python` |
| 6 | poetry | `poetry.lock` or `[tool.poetry]` in pyproject.toml | `poetry run python` |
| 7 | conda | `environment.yml` or `environment.yaml` exists | `conda run python` |

### Creation Priority (when no environment exists)

When no existing environment is detected, Gyoshu creates one using the best available tool:

| Priority | Tool | Creates At | Packages Installed |
|----------|------|------------|-------------------|
| 1 | uv | `./gyoshu/venv/` | pandas, numpy, scikit-learn, matplotlib, seaborn |
| 2 | poetry | `./gyoshu/` (poetry env) | Same as above |
| 3 | conda | `gyoshu-{project}` env | Same as above |
| 4 | venv | `./gyoshu/venv/` | Same as above |

### Environment Override

Set `GYOSHU_PYTHON_PATH` to force a specific Python interpreter:

```bash
export GYOSHU_PYTHON_PATH=/path/to/custom/python
```

> **Important**: Gyoshu never uses system Python directly. It always ensures an isolated virtual environment for reproducible research.
