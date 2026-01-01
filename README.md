# Gyoshu

Scientific research agent extension for OpenCode. Enables hypothesis-driven research with Python REPL, structured output markers, and Jupyter notebook integration.

## Features

- **Persistent REPL Environment**: Variables persist across research steps
- **Structured Output Markers**: Categorized output for easy parsing (HYPOTHESIS, FINDING, METRIC, etc.)
- **Jupyter Notebook Integration**: Research saved as reproducible notebooks
- **Session Management**: Create, continue, and replay research sessions
- **Scientific Skills**: Built-in patterns for data analysis, experiment design, and scientific method

## Installation

Gyoshu is an OpenCode extension. To install:

> **Note**: The GitHub repository is currently named `VibeSci`. The URLs below will be updated after the repository rename to `Gyoshu`.

### One-click global installation

```bash
# One-click global installation
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/VibeSci/main/install.sh | bash

# Or clone and install
git clone https://github.com/Yeachan-Heo/VibeSci.git
cd VibeSci && ./install.sh
```

### Manual Installation

To install Gyoshu manually:

1. Copy the `.opencode/` directory to your project root
2. Or copy to `~/.config/opencode/` for global availability

```bash
# Project-level installation
cp -r .opencode/ /path/to/your/project/

# Global installation
mkdir -p ~/.config/opencode/
cp -r .opencode/* ~/.config/opencode/
```

## Quick Start

```bash
# Start OpenCode
opencode

# Show status and suggestions
/gyoshu

# Start new research
/gyoshu analyze the iris dataset for clustering patterns

# Continue research
/gyoshu continue

# Generate report
/gyoshu report

# For autonomous hands-off research
/gyoshu-auto cluster wine quality factors
```

## Commands

Gyoshu uses **two commands** for all research operations:

| Command | Description |
|---------|-------------|
| `/gyoshu` | Unified research command with subcommands |
| `/gyoshu-auto <goal>` | Autonomous hands-off research (bounded cycles) |

### `/gyoshu` Subcommands

| Usage | Description |
|-------|-------------|
| `/gyoshu` | Show status and suggestions |
| `/gyoshu <goal>` | Start interactive research with discovery |
| `/gyoshu plan <goal>` | Create research plan only |
| `/gyoshu continue [id]` | Continue existing research |
| `/gyoshu list [--status X]` | List all researches |
| `/gyoshu search <query>` | Search researches & notebooks |
| `/gyoshu report [id]` | Generate research report |
| `/gyoshu repl <query>` | Direct REPL exploration |
| `/gyoshu migrate [--options]`| Migrate legacy sessions |
| `/gyoshu replay <sessionId>` | Replay for reproducibility |
| `/gyoshu unlock <sessionId>` | Unlock stuck session |
| `/gyoshu abort` | Abort current research |
| `/gyoshu help` | Show usage and examples |

## Research Modes

Gyoshu supports three orchestration modes:

| Mode | Command | Description |
|------|---------|-------------|
| **Interactive** | `/gyoshu <goal>` | Default mode. Searches for similar research, offers to continue or start fresh. Step-by-step control. |
| **Autonomous** | `/gyoshu-auto <goal>` | Hands-off execution with bounded cycles (max 10). Runs until completion, blocked, or budget exhausted. |
| **REPL** | `/gyoshu repl <query>` | Direct REPL access for exploration. More autonomy, can explore tangentially. |

### Mode Selection Guide

- Use **Interactive** when: You want discovery + step-by-step control over research direction
- Use **Autonomous** when: You have a clear goal and want hands-off execution
- Use **REPL** when: You need quick exploration or debugging

## Agents

### gyoshu (Primary)
The main orchestrator. Switch to it with Tab. Controls:
- Research workflow
- REPL lifecycle (new vs continue)
- Session management

### jogyo (Subagent)
The research executor. Invoked by planner via @jogyo. Handles:
- Python code execution
- Structured output with markers
- Data analysis and visualization

## Output Markers

Gyoshu uses structured markers for organized output:

### Research Process
- `[OBJECTIVE]` - Research goal
- `[HYPOTHESIS]` - Proposed explanation
- `[EXPERIMENT]` - Procedure
- `[OBSERVATION]` - Raw observations
- `[ANALYSIS]` - Interpretation
- `[CONCLUSION]` - Final conclusions

### Data and Calculations
- `[DATA]` - Data description
- `[SHAPE]` - Dimensions
- `[METRIC]` - Named metrics
- `[STAT]` - Statistics
- `[CORR]` - Correlations

### Insights
- `[FINDING]` - Key discoveries
- `[INSIGHT]` - Interpretations
- `[PATTERN]` - Identified patterns

### Scientific
- `[LIMITATION]` - Known limitations
- `[NEXT_STEP]` - Follow-up actions
- `[DECISION]` - Research decisions

## Skills

Load skills for specialized guidance:

- `scientific-method` - Hypothesis-driven research framework
- `data-analysis` - Data loading, EDA, statistical tests
- `experiment-design` - Reproducibility, controls, A/B testing

## Architecture

```
.opencode/
├── agent/
│   ├── jogyo.md                # Research executor
│   └── gyoshu.md               # Planner for research orchestration
├── command/
│   ├── gyoshu.md               # Unified research command
│   └── gyoshu-auto.md          # Autonomous mode
├── tool/
│   ├── research-manager.ts     # Research & frontmatter scanning
│   ├── python-repl.ts          # REPL with notebook auto-capture
│   ├── notebook-writer.ts      # Tagged notebook generation
│   ├── session-manager.ts      # Runtime session locking
│   └── migration-tool.ts       # Notebook-centric migration
├── lib/
│   ├── notebook-frontmatter.ts # YAML metadata parsing
│   ├── readme-index.ts         # Sentinel-based index generation
│   └── paths.ts                # Profile-aware path resolver
├── bridge/
│   └── gyoshu_bridge.py        # Python execution bridge
└── skill/
    └── ...                     # Research skills
```

## Research Storage

Gyoshu uses a **notebook-centric architecture** where research metadata is stored directly in Jupyter notebooks using YAML frontmatter.

### Directory Structure

```
Gyoshu/
├── notebooks/                    # Research notebooks (*.ipynb)
│   └── README.md                 # Auto-generated index
├── reports/                      # Research reports and artifacts
│   └── {reportTitle}/            # Figures, models, report.md
└── gyoshu/                       # Runtime only (gitignored)
    └── runtime/                  # Ephemeral session data
```

### Self-Describing Notebooks

Each notebook contains its own metadata in the first cell:

```yaml
---
gyoshu:
  reportTitle: churn-prediction
  status: active
  tags: [ml, classification]
---
```

> **Migration Note**: Legacy research stored at `gyoshu/research/` or `~/.gyoshu/sessions/` is still supported. Use `/gyoshu migrate --to-notebooks` to move to the new structure.

## Example Workflow

```python
# In the REPL (executed by @jogyo)

print("[OBJECTIVE] Identify factors affecting iris species classification")

import pandas as pd
from sklearn.datasets import load_iris

iris = load_iris()
df = pd.DataFrame(iris.data, columns=iris.feature_names)
df['species'] = iris.target

print(f"[DATA] Loaded iris dataset")
print(f"[SHAPE] {df.shape[0]} samples, {df.shape[1]} features")

print("[HYPOTHESIS] Petal dimensions are most discriminative for species")

corr = df.corr()['species'].drop('species').abs().sort_values(ascending=False)
print(f"[CORR] Feature correlations with species:")
print(corr)

print(f"[FINDING] Petal length (r={corr['petal length (cm)']:.3f}) most correlated")
print("[CONCLUSION:confidence=0.95] Hypothesis supported - petal dimensions are most discriminative")
```

## Python Environment Support

Gyoshu automatically detects and uses isolated Python environments for reproducibility:

| Detection Priority | Environment Type | Detection Method |
|-------------------|------------------|------------------|
| 1 | Custom | `GYOSHU_PYTHON_PATH` env var |
| 2 | venv | `./venv`, `./.venv`, or `./gyoshu/venv` |
| 3 | uv | `uv.lock` or `[tool.uv]` in pyproject.toml |
| 4 | poetry | `poetry.lock` or `[tool.poetry]` in pyproject.toml |
| 5 | conda | `environment.yml` or `environment.yaml` |

When no environment exists, Gyoshu creates one using the fastest available tool (uv > poetry > conda > venv) and installs core research packages (pandas, numpy, scikit-learn, matplotlib, seaborn).

> Gyoshu never uses system Python directly - it always ensures isolated virtual environments.

## Requirements

- OpenCode v0.1.0+
- Python 3.10+ (for match statements in bridge)
- Optional: psutil (for memory tracking)
- Optional: uv, poetry, or conda (for faster environment creation)

## License

MIT
