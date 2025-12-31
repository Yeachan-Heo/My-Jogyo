# AGENTS.md - VibeSci Repository Guide

> Guidelines for AI agents operating in this repository.

## Overview

VibeSci is a scientific research agent extension for OpenCode. It provides:
- Persistent Python REPL with structured output markers
- Jupyter notebook integration for reproducible research
- Session management for research workflows

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
pytest --cov=.opencode/bridge --cov-report=term-missing
```

### TypeScript/JavaScript (Bun)

```bash
# Run all tests
bun test

# Watch mode for development
bun test --watch

# Run a specific test file
bun test .opencode/tool/session-manager.test.ts
```

### No Build Step Required

This is an OpenCode extension - no compilation needed. TypeScript files are executed directly by Bun.

## Code Style Guidelines

### Python (.py files)

#### Imports
```python
# Standard library first
import sys
import os
import json

# Third-party next (blank line)
import pytest

# Local imports last (blank line)
from vibesci_bridge import parse_markers, execute_code
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
# Use specific exception types
try:
    result = json.loads(data)
except json.JSONDecodeError as e:
    return make_error(ERROR_PARSE, f"Parse error: {e}")

# Never use bare except
# Never silently swallow exceptions
```

### TypeScript (.ts files)

#### Imports
```typescript
// Built-in Node modules first
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";

// External packages next
import { tool } from "@opencode-ai/plugin";

// Local modules last
import { durableAtomicWrite, fileExists } from "../lib/atomic-write";
```

#### JSDoc Comments
```typescript
/**
 * Session Manager - OpenCode tool for managing VibeSci research sessions
 *
 * Provides CRUD operations for session manifests with:
 * - Atomic, durable writes to prevent data corruption
 * - Cell execution tracking with content hashes
 *
 * @module session-manager
 */

/**
 * Root directory for all VibeSci session data.
 * Located in user's home directory for privacy and persistence.
 */
const SESSIONS_DIR = path.join(os.homedir(), ".vibesci", "sessions");
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
- `UPPER_SNAKE_CASE` for constants: `SESSIONS_DIR`
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

## Structured Output Markers

When working with VibeSci REPL output, use these markers:

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

## Project Structure

```
VibeSci/
├── .opencode/              # OpenCode extension
│   ├── agent/              # Agent definitions
│   ├── command/            # Slash commands (/vibesci-run, etc.)
│   ├── tool/               # Tool implementations (*.ts)
│   ├── lib/                # Shared utilities
│   ├── bridge/             # Python REPL bridge
│   └── skill/              # Research skills
├── tests/                  # pytest tests
├── data/                   # Datasets for analysis
├── pyproject.toml          # Python config (pytest)
└── package.json            # JS config (bun)
```

## Key Files

| File | Purpose |
|------|---------|
| `.opencode/bridge/vibesci_bridge.py` | JSON-RPC Python execution bridge |
| `.opencode/tool/session-manager.ts` | Session CRUD operations |
| `.opencode/tool/python-repl.ts` | REPL tool interface |
| `.opencode/tool/notebook-writer.ts` | Jupyter notebook generation |
| `tests/test_bridge.py` | Bridge unit tests |

## Common Tasks

### Adding a New Test
1. Create test class in appropriate file under `tests/`
2. Use `test_` prefix for test methods
3. Run: `pytest tests/test_file.py::TestClass::test_method -v`

### Modifying the Python Bridge
1. Edit `.opencode/bridge/vibesci_bridge.py`
2. Run tests: `pytest tests/test_bridge.py -v`
3. Test manually with JSON-RPC messages

### Working with Sessions
Sessions are stored at `~/.vibesci/sessions/{sessionId}/`:
- `manifest.json` - Session metadata
- `notebook.ipynb` - Jupyter notebook
- `artifacts/` - Generated files
