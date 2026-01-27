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

## Model Configuration

Gyoshu uses OpenCode's built-in model aliases by default:

| Agent | Default Model | Role |
|-------|---------------|------|
| **Gyoshu** | `sonnet` | Research planner |
| **Baksa** | `sonnet` | Adversarial verifier |
| **Jogyo** | `sonnet` | Research executor |
| **Jogyo Paper Writer** | `sonnet` | Report writer |
| **Jogyo Feedback** | `sonnet` | Feedback explorer |
| **Jogyo Insight** | `sonnet` | Evidence gatherer |

### Available Model Aliases

OpenCode supports these model aliases (mapped to actual model IDs via your `opencode.json`):

| Alias | Typical Mapping | Use Case |
|-------|-----------------|----------|
| `sonnet` | Claude Sonnet | Balanced capability, default for most agents |
| `opus` | Claude Opus | Complex reasoning, research planning |
| `haiku` | Claude Haiku | Fast, simple tasks |

### Upgrading to Premium Models

For best research quality, configure premium models in your `opencode.json`:

```json
{
  "model": "anthropic/claude-opus-4-5-high",
  "small_model": "anthropic/claude-haiku-4-5"
}
```

| Agent | Recommended Premium Model | Why |
|-------|---------------------------|-----|
| **Gyoshu** | `anthropic/claude-opus-4-5-high` | Complex research planning requires top-tier reasoning |
| **Baksa** | `anthropic/claude-opus-4-5-high` | Adversarial verification needs strong critical thinking |
| **Jogyo** | `anthropic/claude-sonnet-4-5-high` | Balanced capability for code execution |
| **Jogyo subagents** | `anthropic/claude-sonnet-4-5-high` | Consistent quality across tasks |

### Overriding Agent Models (Recommended Method)

**Important**: Agent files in `~/.config/opencode/agent/` are managed by Gyoshu and will be reset on package updates. To persistently override agent models, use `opencode.json`:

```json
{
  "agent": {
    "gyoshu": {
      "model": "anthropic/claude-opus-4-5-high"
    },
    "baksa": {
      "model": "anthropic/claude-opus-4-5-high"
    },
    "jogyo": {
      "model": "anthropic/claude-sonnet-4-5-high"
    }
  }
}
```

This method survives package updates because `opencode.json` is user-controlled.

### Why Agent Files Get Reset

Gyoshu tracks installed files in `~/.config/opencode/.gyoshu/install.json`. Files listed there are considered "Gyoshu-owned" and will be updated when the package updates. This ensures you always have the latest agent prompts and capabilities.

If you need to customize agent behavior beyond model selection, consider:
1. Using `opencode.json` overrides (recommended)
2. Creating custom agents with different names
3. Forking the package for deep customizations

> **Note**: Premium models (Anthropic, OpenAI) require API keys configured in OpenCode.

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
 | `doctor` | Check system health and diagnose issues | `/gyoshu doctor` |
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
| Statistical Rigor | 30% | CI reported, effect size calculated, assumptions checked |
| Evidence Quality | 25% | Artifacts exist, code is reproducible |
| Metric Verification | 20% | Independent checks match claimed values |
| Completeness | 15% | All objectives addressed |
| Methodology | 10% | Sound approach, appropriate tests |

### Automatic Rejection Triggers

The following immediately reduce trust score by 30 points:
- `[FINDING]` without accompanying `[STAT:ci]`
- `[FINDING]` without accompanying `[STAT:effect_size]`
- "Significant" claim without p-value
- Correlation claim without effect size interpretation
- ML metrics without baseline comparison

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

## Research Quality Standards

Gyoshu enforces **senior data scientist level** research quality through hard quality gates. Every claim must have statistical evidence before becoming a verified finding.

### The Claim Contract

Every finding must include:
```
Claim → Data slice → Method/Test → Assumptions → 
Estimate + CI → Effect size → p-value → Robustness checks → 
Practical "so what"
```

### Quality Gates

| Gate | Requirement | Consequence if Missing |
|------|-------------|------------------------|
| Hypothesis | H0/H1 stated before analysis | Finding marked "exploratory" |
| Confidence Interval | 95% CI reported | Finding rejected |
| Effect Size | Cohen's d, r², or OR reported | Finding rejected |
| Assumptions | Statistical assumptions checked | Warning flag |
| Robustness | At least one sensitivity check | Warning flag |
| So What | Practical significance explained | Finding incomplete |

### Finding Categories

| Category | Trust Score | Report Section |
|----------|-------------|----------------|
| **Verified Findings** | ≥ 80 | Key Findings |
| **Partial Findings** | 60-79 | Findings (with caveats) |
| **Exploratory Notes** | < 60 | Exploratory Observations |

### How Quality Gates Work

Quality gates are automated checks that run at research completion (via `gyoshu-completion` tool) to enforce statistical rigor. The system:

1. **Scans notebook outputs** for structured markers
2. **Validates findings** using the "Finding Gating Rule"
3. **Validates ML pipelines** for required components
4. **Calculates quality score** (100 - sum of penalties)
5. **Categorizes findings** as Verified, Partial, or Exploratory

#### The Finding Gating Rule

Every `[FINDING]` marker must have supporting evidence within 10 lines BEFORE it:
- `[STAT:ci]` - Confidence interval (required)
- `[STAT:effect_size]` - Effect magnitude (required)

If either is missing, the finding is marked as **unverified** and goes to "Exploratory Observations" in the report.

#### Quality Score Calculation

```
Quality Score = 100 - (sum of all penalties)
```

| Violation | Penalty | Description |
|-----------|---------|-------------|
| `FINDING_NO_CI` | -30 | Finding without confidence interval |
| `FINDING_NO_EFFECT_SIZE` | -30 | Finding without effect size |
| `ML_NO_BASELINE` | -20 | ML metrics without baseline comparison |
| `ML_NO_CV` | -25 | ML metrics without cross-validation |
| `ML_NO_INTERPRETATION` | -15 | ML metrics without feature importance |

#### Quality Gate Decision

| Score Range | Status | Result |
|-------------|--------|--------|
| 100 | SUCCESS | All quality gates passed |
| 80-99 | PARTIAL | Minor issues, findings still accepted |
| 60-79 | PARTIAL | Some findings moved to exploratory |
| 0-59 | PARTIAL | Significant quality issues |

> **Note**: Quality gates never block completion, but they do affect how findings are categorized in reports.

### Good vs Bad Findings: Examples

Understanding the difference between verified and exploratory findings:

#### BAD: Exploratory Finding (Missing Evidence)

```python
# ❌ This finding will be marked EXPLORATORY (score -60)
print("[FINDING] Model accuracy is 95%")

# Why it fails:
# - No [STAT:ci] within 10 lines before
# - No [STAT:effect_size] within 10 lines before
```

This produces:
```
Quality Score: 40/100
Violations:
  - FINDING_NO_CI: Missing confidence interval (-30)
  - FINDING_NO_EFFECT_SIZE: Missing effect size (-30)
Report Section: "Exploratory Observations" (not trusted)
```

#### GOOD: Verified Finding (Full Evidence)

```python
# ✅ This finding will be VERIFIED (score 100)

# 1. Statistical evidence BEFORE the finding
print(f"[STAT:estimate] accuracy = 0.95")
print(f"[STAT:ci] 95% CI [0.93, 0.97]")
print(f"[STAT:effect_size] Cohen's d = 0.82 (large improvement over baseline)")
print(f"[STAT:p_value] p < 0.001")

# 2. NOW state the finding with summary evidence
print("[FINDING] Model (AUC=0.95) significantly outperforms baseline "
      "(d=0.82, 95% CI [0.93, 0.97], p<0.001)")

# 3. Explain practical significance
print("[SO_WHAT] This means 40% fewer false negatives in fraud detection")
```

This produces:
```
Quality Score: 100/100
Violations: None
Report Section: "Key Findings" (trusted, verified)
```

#### ML Pipeline: Complete Example

```python
# ✅ Complete ML pipeline with all required markers

# 1. Baseline comparison (REQUIRED)
from sklearn.dummy import DummyClassifier
dummy = DummyClassifier(strategy='stratified')
dummy_scores = cross_val_score(dummy, X, y, cv=5)
print(f"[METRIC:baseline_accuracy] {dummy_scores.mean():.3f}")

# 2. Model cross-validation (REQUIRED)
scores = cross_val_score(rf_model, X, y, cv=5)
print(f"[METRIC:cv_accuracy_mean] {scores.mean():.3f}")
print(f"[METRIC:cv_accuracy_std] {scores.std():.3f}")

# 3. Feature interpretation (REQUIRED)
importances = rf_model.feature_importances_
print(f"[METRIC:feature_importance] age={importances[0]:.2f}, income={importances[1]:.2f}")

# 4. Statistical evidence for finding
improvement = scores.mean() - dummy_scores.mean()
ci_low, ci_high = scores.mean() - 1.96*scores.std(), scores.mean() + 1.96*scores.std()
print(f"[STAT:ci] 95% CI [{ci_low:.3f}, {ci_high:.3f}]")
print(f"[STAT:effect_size] Improvement = {improvement:.3f} ({improvement/dummy_scores.std():.1f}σ)")

# 5. Verified finding
print(f"[FINDING] Random Forest achieves {scores.mean():.1%} accuracy, "
      f"outperforming baseline by {improvement:.1%} (95% CI [{ci_low:.3f}, {ci_high:.3f}])")
```

## Goal Contract System

A **Goal Contract** defines measurable success criteria for research before execution begins. This enables Gyoshu to objectively determine whether a research goal has been achieved, rather than relying solely on subjective verification.

### What is a Goal Contract?

A Goal Contract is a formal specification that:
1. **States the goal** in clear, measurable terms
2. **Defines acceptance criteria** that must be met for success
3. **Limits retry attempts** to prevent infinite loops
4. **Enables automatic verification** at research completion

### Goal Contract in Notebook Frontmatter

Goal contracts are stored in the notebook's YAML frontmatter under the `gyoshu.goal_contract` key:

```yaml
---
title: "Customer Churn Classification"
gyoshu:
  schema_version: 1
  reportTitle: churn-classification
  status: active
  goal_contract:
    version: 1
    goal_text: "Build a classification model with 90% accuracy"
    goal_type: "ml_classification"
    max_goal_attempts: 3
    acceptance_criteria:
      - id: AC1
        kind: metric_threshold
        metric: cv_accuracy_mean
        op: ">="
        target: 0.90
      - id: AC2
        kind: marker_required
        marker: "METRIC:baseline_accuracy"
      - id: AC3
        kind: artifact_exists
        artifactPattern: "*.pkl"
      - id: AC4
        kind: finding_count
        minCount: 3
---
```

### Goal Contract Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `version` | number | Yes | Schema version (currently `1`) |
| `goal_text` | string | Yes | Human-readable goal statement |
| `goal_type` | string | No | Goal category: `ml_classification`, `ml_regression`, `eda`, `statistical`, `custom` |
| `max_goal_attempts` | number | No | Maximum pivot attempts before BLOCKED (default: 3) |
| `acceptance_criteria` | array | Yes | List of criteria that must ALL pass |

### Acceptance Criteria Types

#### 1. `metric_threshold` — Compare Metric to Target

Checks if a `[METRIC:name]` marker value meets a threshold.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier (e.g., `AC1`) |
| `kind` | string | Must be `metric_threshold` |
| `metric` | string | Metric name (e.g., `cv_accuracy_mean`, `f1_score`) |
| `op` | string | Comparison operator: `>=`, `>`, `<=`, `<`, `==` |
| `target` | number | Target value to compare against |

**Example:**
```yaml
- id: AC1
  kind: metric_threshold
  metric: cv_accuracy_mean
  op: ">="
  target: 0.90
```

**How it works:** Scans notebook output for `[METRIC:cv_accuracy_mean] 0.92` and checks if `0.92 >= 0.90`.

#### 2. `marker_required` — Check Marker Exists

Verifies that a specific marker type appears in the notebook output.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `kind` | string | Must be `marker_required` |
| `marker` | string | Marker type to find (e.g., `METRIC:baseline_accuracy`, `STAT:ci`) |

**Example:**
```yaml
- id: AC2
  kind: marker_required
  marker: "METRIC:baseline_accuracy"
```

**How it works:** Searches for `[METRIC:baseline_accuracy]` in any cell output. Passes if found at least once.

#### 3. `artifact_exists` — Check File Exists

Verifies that a specific artifact file was created in the reports directory.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `kind` | string | Must be `artifact_exists` |
| `artifactPattern` | string | Glob pattern to match (e.g., `*.pkl`, `figures/*.png`, `model.joblib`) |

**Example:**
```yaml
- id: AC3
  kind: artifact_exists
  artifactPattern: "models/*.pkl"
```

**How it works:** Checks `reports/{reportTitle}/models/` for any `.pkl` file. Passes if at least one match exists.

#### 4. `finding_count` — Count Verified Findings

Verifies that a minimum number of verified `[FINDING]` markers exist.

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `kind` | string | Must be `finding_count` |
| `minCount` | number | Minimum number of verified findings required |

**Example:**
```yaml
- id: AC4
  kind: finding_count
  minCount: 3
```

**How it works:** Counts `[FINDING]` markers that have supporting `[STAT:ci]` and `[STAT:effect_size]` within 10 lines before. Only verified findings count.

### Goal Contract Examples

#### ML Classification Goal

```yaml
goal_contract:
  version: 1
  goal_text: "Classify wine quality with F1 >= 0.85"
  goal_type: ml_classification
  max_goal_attempts: 3
  acceptance_criteria:
    - id: AC1
      kind: metric_threshold
      metric: cv_f1_mean
      op: ">="
      target: 0.85
    - id: AC2
      kind: marker_required
      marker: "METRIC:baseline_accuracy"
    - id: AC3
      kind: artifact_exists
      artifactPattern: "models/*.pkl"
```

#### Exploratory Data Analysis Goal

```yaml
goal_contract:
  version: 1
  goal_text: "Complete comprehensive EDA with 5+ insights"
  goal_type: eda
  max_goal_attempts: 2
  acceptance_criteria:
    - id: AC1
      kind: finding_count
      minCount: 5
    - id: AC2
      kind: artifact_exists
      artifactPattern: "figures/*.png"
    - id: AC3
      kind: marker_required
      marker: "CONCLUSION"
```

#### Statistical Analysis Goal

```yaml
goal_contract:
  version: 1
  goal_text: "Test hypothesis with p < 0.05"
  goal_type: statistical
  max_goal_attempts: 2
  acceptance_criteria:
    - id: AC1
      kind: marker_required
      marker: "STAT:p_value"
    - id: AC2
      kind: marker_required
      marker: "STAT:ci"
    - id: AC3
      kind: marker_required
      marker: "STAT:effect_size"
    - id: AC4
      kind: finding_count
      minCount: 1
```

## Two-Gate Completion

Gyoshu uses a **Two-Gate verification system** to ensure both research quality (Trust Gate) and goal achievement (Goal Gate) before accepting results.

### The Two Gates

| Gate | What It Checks | Who Evaluates | Pass Condition |
|------|----------------|---------------|----------------|
| **Trust Gate** | Research quality, statistical rigor, evidence validity | Baksa (adversarial verifier) | Trust score ≥ 80 |
| **Goal Gate** | Whether acceptance criteria are met | Automated (from goal contract) | All criteria pass |

### Why Two Gates?

**Trust Gate alone is insufficient:**
- Research can be methodologically sound but fail to achieve the stated goal
- Example: Perfect statistical analysis showing 70% accuracy when goal was 90%

**Goal Gate alone is insufficient:**
- Goal can be "achieved" through flawed methodology
- Example: Claiming 95% accuracy on training set without cross-validation

**Together, they ensure:**
- Results are trustworthy AND meaningful
- Claims are verified AND goals are met
- Research is rigorous AND successful

### Two-Gate Decision Matrix

| Trust Gate | Goal Gate | Final Status | Action |
|------------|-----------|--------------|--------|
| ✅ PASS | ✅ MET | **SUCCESS** | Accept result, generate report |
| ✅ PASS | ❌ NOT_MET | **PARTIAL** | Pivot: try different approach |
| ✅ PASS | 🚫 BLOCKED | **BLOCKED** | Goal impossible, escalate to user |
| ❌ FAIL | ✅ MET | **PARTIAL** | Rework: improve evidence quality |
| ❌ FAIL | ❌ NOT_MET | **PARTIAL** | Rework: fix methodology |
| ❌ FAIL | 🚫 BLOCKED | **BLOCKED** | Cannot proceed, escalate to user |

### Gate Status Definitions

**Trust Gate:**
- `PASS`: Trust score ≥ 80 (verified)
- `FAIL`: Trust score < 80 (needs rework)

**Goal Gate:**
- `MET`: All acceptance criteria pass
- `NOT_MET`: Some criteria failed, but retry is possible
- `BLOCKED`: Goal is impossible (e.g., data doesn't support the hypothesis)

### The Pivot and Rework Cycle

When gates fail, Gyoshu doesn't immediately give up:

```
┌─────────────────────────────────────────────────────────────┐
│                      Research Execution                      │
└─────────────────────────┬───────────────────────────────────┘
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                     Trust Gate Check                         │
│               (Baksa adversarial verification)               │
└───────────┬─────────────────────────────────┬───────────────┘
            │ PASS                            │ FAIL
            ▼                                 ▼
┌───────────────────────┐         ┌───────────────────────────┐
│   Goal Gate Check     │         │   Rework Request          │
│ (Automated criteria)  │         │   (Fix evidence quality)  │
└───────┬───────────────┘         └─────────────┬─────────────┘
        │                                       │
   MET  │  NOT_MET                              │
        │     │                                 │
        ▼     ▼                                 │
   SUCCESS  PARTIAL                             │
              │                                 │
              ├───────── Attempt < Max? ────────┤
              │              Yes                │
              ▼                                 │
        ┌─────────────┐                         │
        │   PIVOT     │◄────────────────────────┘
        │ Try new     │
        │ approach    │
        └─────────────┘
              │
              │ Attempt >= Max
              ▼
         BLOCKED
```

### Pivot vs Rework

| Action | Trigger | What Happens |
|--------|---------|--------------|
| **Rework** | Trust Gate FAIL | Jogyo improves evidence (adds CI, effect size, etc.) without changing approach |
| **Pivot** | Goal Gate NOT_MET | Jogyo tries a different approach (new model, different features, etc.) |

### Max Attempts and BLOCKED Status

The `max_goal_attempts` field in the goal contract limits how many times Gyoshu will try to achieve the goal:

```yaml
goal_contract:
  max_goal_attempts: 3  # Try up to 3 different approaches
```

**Attempt counting:**
- Each Pivot increments the attempt counter
- Reworks do NOT increment (same approach, better evidence)
- When attempts ≥ max_goal_attempts, status becomes BLOCKED

**BLOCKED status means:**
- The goal cannot be achieved with available data/methods
- User intervention is required
- Gyoshu will NOT keep trying indefinitely

### Example: Two-Gate Flow

**Goal:** "Build classifier with 90% accuracy"

**Attempt 1:**
1. Jogyo trains Random Forest → 85% accuracy
2. Trust Gate: PASS (proper CV, baseline comparison)
3. Goal Gate: NOT_MET (85% < 90%)
4. Decision: PARTIAL → Pivot

**Attempt 2:**
1. Jogyo trains XGBoost → 92% accuracy
2. Trust Gate: FAIL (no confidence interval reported)
3. Decision: PARTIAL → Rework

**Attempt 2 (Rework):**
1. Jogyo adds CI: 95% CI [0.90, 0.94]
2. Trust Gate: PASS
3. Goal Gate: MET (92% ≥ 90%)
4. Decision: **SUCCESS** ✅

### Viewing Gate Results

Gate results are included in the completion response:

```json
{
  "status": "PARTIAL",
  "trustGate": {
    "passed": true,
    "score": 85
  },
  "goalGate": {
    "status": "NOT_MET",
    "criteriaResults": [
      { "id": "AC1", "passed": false, "actual": 0.85, "target": 0.90 },
      { "id": "AC2", "passed": true }
    ]
  },
  "action": "PIVOT",
  "attemptNumber": 1,
  "maxAttempts": 3
}
```

## Structured Output Markers

When working with Gyoshu REPL output, use these markers:

### Research Process Markers

```python
# Research Process
print("[OBJECTIVE] Research goal statement")
print("[HYPOTHESIS] H0: no effect; H1: treatment improves outcome")
print("[CONCLUSION] Final conclusions with evidence summary")
```

### Statistical Evidence Markers (REQUIRED for Findings)

```python
# Test Decision - explain why this test
print("[DECISION] Using Welch's t-test: two independent groups, unequal variance")

# Assumption Checking
print("[CHECK:normality] Shapiro-Wilk p=0.23 - normality assumption OK")
print("[CHECK:homogeneity] Levene's p=0.04 - using Welch's (unequal var)")

# Statistical Results (ALL required before [FINDING])
print(f"[STAT:estimate] mean_diff = {mean_diff:.3f}")
print(f"[STAT:ci] 95% CI [{ci_low:.3f}, {ci_high:.3f}]")
print(f"[STAT:effect_size] Cohen's d = {d:.3f} (medium)")
print(f"[STAT:p_value] p = {p:.4f}")

# Robustness Check
print("[INDEPENDENT_CHECK] Bootstrap 95% CI: [0.12, 0.28] - consistent")

# Only AFTER above evidence:
print("[FINDING] Treatment shows medium effect (d=0.45, 95% CI [0.2, 0.7])")

# Practical Significance
print("[SO_WHAT] Effect translates to $50K annual savings per customer segment")

# Limitations
print("[LIMITATION] Self-selection bias - users opted in voluntarily")
```

### ML Pipeline Markers

```python
# Baseline (REQUIRED before claiming model performance)
print(f"[METRIC:baseline_accuracy] {dummy_score:.3f}")

# Cross-Validation (REQUIRED - report mean ± std)
print(f"[METRIC:cv_accuracy_mean] {scores.mean():.3f}")
print(f"[METRIC:cv_accuracy_std] {scores.std():.3f}")

# Model Performance with CI
print(f"[STAT:ci] 95% CI [{ci_low:.3f}, {ci_high:.3f}]")
print(f"[METRIC:improvement_over_baseline] {improvement:.3f}")

# Interpretation (REQUIRED)
print("[METRIC:top_features] age (0.23), income (0.18), tenure (0.15)")
print("[FINDING] Random Forest (AUC=0.82) outperforms baseline (0.65) by 0.17")
print("[SO_WHAT] Model identifies 80% of churners in top 20% of predictions")
```

### Data Operations Markers

```python
print("[DATA] Dataset description")
print(f"[SHAPE] {df.shape}")
print(f"[METRIC:missing_rate] {missing_pct:.1f}%")
```

### Legacy Markers (Still Supported)

```python
print("[PATTERN] Identified pattern")
print("[OBSERVATION] Descriptive observation")
print("[EXPERIMENT] Experimental setup description")
```

### Complete Statistical Analysis Example

```python
import numpy as np
from scipy.stats import ttest_ind, shapiro, levene

# 1. State hypothesis
print("[HYPOTHESIS] H0: No difference between groups; H1: Treatment > Control")
print("[DECISION] Using Welch's t-test for independent samples")

# 2. Check assumptions
_, p_norm_t = shapiro(treatment)
_, p_norm_c = shapiro(control)
print(f"[CHECK:normality] Treatment p={p_norm_t:.3f}, Control p={p_norm_c:.3f}")

_, p_var = levene(treatment, control)
print(f"[CHECK:homogeneity] Levene's p={p_var:.3f} - using Welch's t-test")

# 3. Run test
t_stat, p_value = ttest_ind(treatment, control, equal_var=False)

# 4. Calculate effect size (Cohen's d)
pooled_std = np.sqrt(((len(treatment)-1)*treatment.std()**2 + 
                       (len(control)-1)*control.std()**2) / 
                      (len(treatment) + len(control) - 2))
cohens_d = (treatment.mean() - control.mean()) / pooled_std

# 5. Calculate CI for difference
from scipy.stats import sem
mean_diff = treatment.mean() - control.mean()
se_diff = np.sqrt(sem(treatment)**2 + sem(control)**2)
ci_low = mean_diff - 1.96 * se_diff
ci_high = mean_diff + 1.96 * se_diff

# 6. Report ALL statistics
print(f"[STAT:estimate] mean_diff = {mean_diff:.3f}")
print(f"[STAT:ci] 95% CI [{ci_low:.3f}, {ci_high:.3f}]")
print(f"[STAT:effect_size] Cohen's d = {cohens_d:.3f} ({'small' if abs(cohens_d) < 0.5 else 'medium' if abs(cohens_d) < 0.8 else 'large'})")
print(f"[STAT:p_value] p = {p_value:.4f}")

# 7. Robustness check
from scipy.stats import mannwhitneyu
_, p_mw = mannwhitneyu(treatment, control, alternative='greater')
print(f"[INDEPENDENT_CHECK] Mann-Whitney U p={p_mw:.4f} (non-parametric confirmation)")

# 8. NOW state finding with full evidence
print(f"[FINDING] Treatment shows {'significant' if p_value < 0.05 else 'no significant'} effect "
      f"(d={cohens_d:.2f}, 95% CI [{ci_low:.2f}, {ci_high:.2f}], p={p_value:.4f})")

# 9. Practical significance
print(f"[SO_WHAT] A {abs(cohens_d):.1f}σ effect means ~{abs(mean_diff)*100:.0f} unit improvement per customer")

# 10. Limitations
print("[LIMITATION] Single time point; longitudinal effects unknown")
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

### IMRAD Report Structure

Reports follow the IMRAD (Introduction, Methods, Results, Analysis, Discussion) structure:

| Section | Content | Required Markers |
|---------|---------|------------------|
| **Executive Summary** | Question, answer, magnitude, confidence | `[OBJECTIVE]`, `[CONCLUSION]` |
| **Hypotheses & Endpoints** | H0/H1, metrics, alpha | `[HYPOTHESIS]`, `[DECISION]` |
| **Methods** | Data, tests, assumptions | `[DATA]`, `[CHECK:*]` |
| **Results** | Estimates + CI + effect sizes | `[STAT:*]`, `[METRIC:*]` |
| **Robustness** | Sensitivity analyses | `[INDEPENDENT_CHECK]` |
| **Key Findings** | Verified discoveries (trust ≥ 80) | `[FINDING]` + `[STAT:ci]` + `[STAT:effect_size]` |
| **Exploratory Observations** | Unverified claims (trust < 80) | `[FINDING]` without full stats |
| **Implications ("So What")** | Practical significance | `[SO_WHAT]` |
| **Limitations** | Threats to validity | `[LIMITATION]` |
| **Next Steps** | Follow-up actions | `[NEXT_STEP]` |

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

Gyoshu uses Python virtual environments for research reproducibility.

### Detection Priority

| Priority | Type | Detection Method |
|----------|------|------------------|
| 1 | venv | `.venv/bin/python` exists |

### Quick Setup

```bash
python3 -m venv .venv
.venv/bin/pip install pandas numpy scikit-learn matplotlib seaborn
```

> **Note:** Gyoshu uses your project's virtual environment. It never modifies system Python.
