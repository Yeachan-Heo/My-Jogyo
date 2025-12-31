# VibeSci

Scientific research agent extension for OpenCode. Enables hypothesis-driven research with Python REPL, structured output markers, and Jupyter notebook integration.

## Features

- **Persistent REPL Environment**: Variables persist across research steps
- **Structured Output Markers**: Categorized output for easy parsing (HYPOTHESIS, FINDING, METRIC, etc.)
- **Jupyter Notebook Integration**: Research saved as reproducible notebooks
- **Session Management**: Create, continue, and replay research sessions
- **Scientific Skills**: Built-in patterns for data analysis, experiment design, and scientific method

## Installation

VibeSci is an OpenCode extension. To install:

### One-click global installation

```bash
# One-click global installation
curl -fsSL https://raw.githubusercontent.com/Yeachan-Heo/VibeSci/main/install.sh | bash

# Or clone and install
git clone https://github.com/Yeachan-Heo/VibeSci.git
cd VibeSci && ./install.sh
```

### Manual Installation

To install VibeSci manually:

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

# Create a research plan
/vibesci-plan analyze the iris dataset to identify species clusters

# Start research (new session)
/vibesci-run

# Continue research (preserves REPL state)
/vibesci-continue now cluster the data using k-means

# Generate report
/vibesci-report
```

## Commands

| Command | Description |
|---------|-------------|
| `/vibesci-plan <goal>` | Create a detailed research plan |
| `/vibesci-auto <goal>` | **NEW** Autonomous research with bounded cycles |
| `/vibesci-interactive <goal>` | **NEW** Single-cycle interactive mode |
| `/vibesci-run` | Start a new research session (PLANNER mode) |
| `/vibesci-continue` | Continue research with preserved REPL state |
| `/vibesci-repl <query>` | **NEW** Direct REPL exploration |
| `/vibesci-abort` | **NEW** Graceful abort with state preservation |
| `/vibesci-report` | Generate comprehensive research report |
| `/vibesci-replay <sessionId>` | Replay session for reproducibility |
| `/vibesci-unlock <sessionId>` | Manually unlock a stuck session |

## Research Modes

VibeSci supports three orchestration modes:

| Mode | Command | Description |
|------|---------|-------------|
| **AUTO** | `/vibesci-auto` | Autonomous execution with bounded cycles (max 10). Runs until completion, blocked, or budget exhausted. |
| **PLANNER** | `/vibesci-interactive` | Single-cycle interactive mode. Executes one step, returns control to user with options. |
| **REPL** | `/vibesci-repl` | Direct REPL access for exploration. More autonomy, can explore tangentially. |

### Mode Selection Guide

- Use **AUTO** when: You have a clear goal and want hands-off execution
- Use **PLANNER** when: You want step-by-step control over research direction
- Use **REPL** when: You need quick exploration or debugging

## Agents

### vibesci-planner (Primary)
The main orchestrator. Switch to it with Tab. Controls:
- Research workflow
- REPL lifecycle (new vs continue)
- Session management

### vibesci (Subagent)
The research executor. Invoked by planner via @vibesci. Handles:
- Python code execution
- Structured output with markers
- Data analysis and visualization

## Output Markers

VibeSci uses structured markers for organized output:

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
│   ├── vibesci.md              # Research agent with completion signaling
│   └── vibesci-planner.md      # Planner with multi-mode orchestration
├── command/
│   ├── vibesci-plan.md
│   ├── vibesci-auto.md         # NEW: Autonomous mode
│   ├── vibesci-interactive.md  # NEW: Interactive mode
│   ├── vibesci-run.md
│   ├── vibesci-continue.md
│   ├── vibesci-repl.md         # NEW: Direct REPL
│   ├── vibesci-abort.md        # NEW: Graceful abort
│   ├── vibesci-report.md
│   ├── vibesci-replay.md
│   └── vibesci-unlock.md
├── tool/
│   ├── python-repl.ts
│   ├── notebook-writer.ts
│   ├── session-manager.ts      # State machine (modes, goals, budgets)
│   ├── vibesci-snapshot.ts     # NEW: Session state for planner
│   └── vibesci-completion.ts   # NEW: Completion signaling
├── lib/
│   └── ...
├── bridge/
│   └── vibesci_bridge.py
├── skill/
│   └── ...
└── plugin/
    └── vibesci-hooks.ts
```

## Session Storage

Sessions are stored at `~/.vibesci/sessions/{sessionId}/`:
- `manifest.json` - Session metadata and execution history
- `notebook.ipynb` - Jupyter notebook with report and code cells
- `artifacts/` - Generated plots and files

## Example Workflow

```python
# In the REPL (executed by @vibesci)

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

## Requirements

- OpenCode v0.1.0+
- Python 3.10+ (for match statements in bridge)
- Optional: psutil (for memory tracking)

## License

MIT
