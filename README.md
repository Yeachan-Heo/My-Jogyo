# 🎓 Gyoshu & Jogyo

**English** | [中文](README.zh.md) | [한국어](README.ko.md) | [日本語](README.ja.md)

> *"Every great professor needs a great teaching assistant."*

**Gyoshu** (교수, *Professor*) orchestrates. **Jogyo** (조교, *Teaching Assistant*) executes.

Together, they form an end-to-end research automation system for [OpenCode](https://github.com/opencode-ai/opencode) that turns your research goals into reproducible Jupyter notebooks—complete with hypotheses, experiments, findings, and publication-ready reports.

---

## 🎭 The Cast

| Agent | Role | Korean | What They Do |
|-------|------|--------|--------------|
| **Gyoshu** | 🎩 Professor | 교수 | Plans research, orchestrates workflow, manages sessions |
| **Jogyo** | 📚 Teaching Assistant | 조교 | Executes Python code, runs experiments, generates outputs |
| **Baksa** | 🔍 PhD Reviewer | 박사 | Adversarial verifier — challenges claims, calculates trust scores |
| **Jogyo Paper Writer** | ✍️ Grad Student | 조교 | Transforms raw findings into narrative research reports |

Think of it like a research lab:
- The **Professor** (Gyoshu) sets the research direction and reviews progress
- The **TA** (Jogyo) does the actual experiments and analysis
- The **PhD Reviewer** (Baksa) plays devil's advocate, questioning every claim
- When it's time to publish, a **Grad Student** writes up the findings beautifully

---

## ✨ Features

<!-- TODO: Add demo GIF showing /gyoshu-auto workflow -->
<p align="center">
  <em>🎬 Demo coming soon! Try the <a href="docs/user-guide.md">Quick Tutorial</a> to see Gyoshu in action.</em>
</p>

- 🔬 **Hypothesis-Driven Research** — Structure your work with `[OBJECTIVE]`, `[HYPOTHESIS]`, `[FINDING]` markers
- 🐍 **Persistent Python REPL** — Variables survive across sessions, just like a real Jupyter kernel
- 📓 **Auto-Generated Notebooks** — Every experiment is captured as a reproducible `.ipynb`
- 🤖 **Autonomous Mode** — Set a goal, walk away, come back to results
- 🔍 **Adversarial Verification** — PhD reviewer challenges every claim before acceptance
- 🎯 **Two-Gate Completion** — SUCCESS requires both evidence quality (Trust Gate) AND goal achievement (Goal Gate)
- 📝 **AI-Powered Reports** — Turn messy outputs into polished research narratives
- 🔄 **Session Management** — Continue, replay, or branch your research anytime

---

## 🚀 Installation

### Option 1: Claude Code (MCP Server)

Gyoshu works with Claude Code via the Model Context Protocol (MCP). Install in one command:

```bash
# Clone and build the MCP server
git clone https://github.com/Yeachan-Heo/My-Jogyo.git
cd My-Jogyo/src/mcp
npm install && npm run build

# Register with Claude Code
claude mcp add gyoshu-mcp "$(pwd)/build/index.cjs"
```

**Verify installation:**
```bash
claude mcp list
# Should show: gyoshu-mcp: ✓ Connected
```

**Available MCP Tools:**
| Tool | Purpose |
|------|---------|
| `python_repl` | Execute Python code with marker detection |
| `research_manager` | Create/manage research sessions |
| `gyoshu_snapshot` | Capture research state snapshots |
| `checkpoint_manager` | Save/restore research checkpoints |
| `notebook_writer` | Jupyter notebook operations |
| `notebook_search` | Search across notebooks |

> **Note:** The MCP server exposes 12 research tools. See [src/mcp/](src/mcp/) for details.

### Option 2: OpenCode Plugin

Add Gyoshu to your `opencode.json`:

```json
{
  "plugin": ["gyoshu"]
}
```

That's it! OpenCode will auto-install Gyoshu from npm on next startup.

### Option 3: CLI Installer

```bash
# Using bunx (no global install needed)
bunx gyoshu install

# Or install globally first
npm install -g gyoshu
gyoshu install
```

The CLI automatically adds Gyoshu to your `opencode.json`.

<details>
<summary>📦 Development installation (for contributors)</summary>

**Clone & link locally:**
```bash
git clone https://github.com/Yeachan-Heo/My-Jogyo.git
cd My-Jogyo && bun install
```

Then in your `opencode.json`:
```json
{
  "plugin": ["file:///path/to/My-Jogyo"]
}
```

</details>

**Verify installation:**
```bash
# Check status via CLI
bunx gyoshu check

# Or in OpenCode
opencode
/gyoshu doctor
```

---

## 🛡️ Contributor Skill Gates

This repository includes local skill-ops checks for contributor workflows.

### One-time setup

```bash
bun run hooks:install
```

### Common commands

| Command | Purpose |
|---------|---------|
| `bun run skills:sync` | Check `.agents/skills` ↔ `.claude/skills` mirror drift |
| `bun run skills:sync:apply` | Repair mirror drift |
| `bun run skills:verify` | Run skill verification checks |
| `bun run skills:verify:strict` | Strict verification gate (CI-equivalent) |
| `bun run skills:maintain` | Dry-run coverage/stale reference analysis |
| `bun run skills:maintain:apply` | Safe apply mode for mirror sync |

Reports are written to `.omc/reports/skills/`.

---

## 🤖 Installation for LLMs

> *Using Claude Code, OpenCode, or another AI coding assistant? This section is for you.*

**For Claude Code:** Install the MCP server (Option 1 above). The tools are automatically available.

**For OpenCode:** Run `bunx gyoshu install` or add `"gyoshu"` to your plugin array. Then give your LLM the context it needs:

1. **Point your LLM to the guide:**
   > "Read `AGENTS.md` in the Gyoshu directory for full context on how to use the research tools."

2. **Or paste this quick start prompt:**
   ```
   I've installed Gyoshu. Read AGENTS.md and help me run /gyoshu to analyze my data.
   ```

**Key commands your LLM should know:**
| Command | What It Does |
|---------|--------------|
| `/gyoshu` | Start interactive research |
| `/gyoshu-auto <goal>` | Autonomous research (hands-off) |
| `/gyoshu doctor` | Check system health and diagnose issues |

> **Tip:** [AGENTS.md](AGENTS.md) contains everything an LLM needs — agents, commands, markers, troubleshooting, and more.

---

## 🏃 Quick Start

```bash
# Start OpenCode
opencode

# 👋 Say hi to the Professor
/gyoshu

# 🎯 Start a new research project
/gyoshu analyze customer churn patterns in the telecom dataset

# 🤖 Or let it run autonomously (hands-off!)
/gyoshu-auto classify iris species using random forest

# 📊 Generate a report
/gyoshu report

# 🔄 Continue where you left off
/gyoshu continue
```

---

## 📚 Examples

### Binance Futures Comprehensive EDA

Real-world example: Comprehensive exploratory data analysis of Binance USD-M futures data with multi-dimensional visualizations.

<p align="center">
  <img src="examples/binance-futures-eda.png" alt="Binance Futures EDA Dashboard" width="800">
</p>

**What it shows:**
- 3D volume-price-time analysis
- Correlation heatmaps with dendrograms
- Rolling statistics and volatility surfaces
- Cross-pair scatter density plots
- Performance radar charts and candlestick analysis

### Try It Yourself

```bash
# Binance futures analysis (API or local data)
/gyoshu-auto perform comprehensive EDA on binance futures data

# Titanic classification (classic ML workflow)
/gyoshu-auto analyze Titanic survival data and build classification model

# Iris clustering (no download needed - sklearn built-in)
/gyoshu-auto cluster iris dataset and visualize results
```

---

## 📖 Commands

### The Professor's Commands (`/gyoshu`)

| Command | What It Does |
|---------|--------------|
| `/gyoshu` | Show status and what to do next |
| `/gyoshu <goal>` | Start interactive research |
| `/gyoshu-auto <goal>` | Autonomous mode (set it and forget it!) |
| `/gyoshu plan <goal>` | Just create a plan, don't execute |
| `/gyoshu continue` | Pick up where you left off |
| `/gyoshu report` | Generate research report |
| `/gyoshu list` | See all your research projects |
| `/gyoshu search <query>` | Find stuff across all notebooks |
| `/gyoshu doctor` | Check system health and diagnose issues |

### Research Modes

| Mode | Best For | Command |
|------|----------|---------|
| 🎓 **Interactive** | Learning, exploring, iterating | `/gyoshu <goal>` |
| 🤖 **Autonomous** | Clear goals, hands-off execution | `/gyoshu-auto <goal>` |
| 🔧 **REPL** | Quick exploration, debugging | `/gyoshu repl <query>` |

---

## 🔬 How Research Works

### 1. You Set a Goal
```
/gyoshu analyze wine quality factors and build a predictive model
```

### 2. The Professor Plans
Gyoshu creates a structured research plan with clear objectives and hypotheses.

### 3. The TA Executes
Jogyo runs Python code, using structured markers to organize output:

```python
print("[OBJECTIVE] Predict wine quality from physicochemical properties")
print("[HYPOTHESIS] Alcohol content is the strongest predictor")

# ... analysis code ...

print(f"[METRIC:accuracy] {accuracy:.3f}")
print("[FINDING] Alcohol shows r=0.47 correlation with quality")
print("[CONCLUSION] Hypothesis supported - alcohol is key predictor")
```

### 4. Auto-Generated Notebook
Everything is captured in `notebooks/wine-quality.ipynb` with full reproducibility.

### 5. AI-Written Report
The Paper Writer agent transforms markers into a narrative report:

> *"Our analysis of 1,599 wine samples revealed that alcohol content emerges as the dominant predictor of quality ratings (r = 0.47). The final Random Forest model achieved 87% accuracy..."*

---

## 📁 Project Structure

```
your-project/
├── notebooks/                    # 📓 Research notebooks
│   ├── wine-quality.ipynb
│   └── customer-churn.ipynb
├── reports/                      # 📝 Generated reports
│   └── wine-quality/
│       ├── report.md             # AI-written narrative report
│       ├── figures/              # Saved plots
│       └── models/               # Saved models
├── data/                         # 📊 Your datasets
└── .venv/                        # 🐍 Python environment
```

**Runtime files** (sockets, locks) go to OS temp directories—not your project! 🧹

### What Gyoshu Creates

When you run research, Gyoshu creates these artifacts in your project:

```
your-project/
├── notebooks/
│   └── your-research.ipynb    ← Research notebook (source of truth)
├── reports/
│   └── your-research/
│       ├── figures/           ← Saved plots (.png, .svg)
│       ├── models/            ← Trained models (.pkl, .joblib)
│       └── report.md          ← Generated research report
└── (your existing files untouched!)
```

> **Note:** Gyoshu never modifies your `.venv/`, `data/`, or other existing project files.

---

## 🎯 Output Markers

The TA uses structured markers to organize research output:

### Core Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[OBJECTIVE]` | Research goal | `[OBJECTIVE] Classify iris species` |
| `[HYPOTHESIS]` | What you're testing | `[HYPOTHESIS] H0: no difference; H1: petal length predicts species` |
| `[DATA]` | Dataset info | `[DATA] Loaded 150 samples` |
| `[FINDING]` | Key discovery | `[FINDING] Setosa is linearly separable (d=2.1, p<0.001)` |
| `[CONCLUSION]` | Final verdict | `[CONCLUSION] Hypothesis confirmed with large effect` |

### Statistical Evidence Markers (Required for Verified Findings)

| Marker | Purpose | Example |
|--------|---------|---------|
| `[STAT:ci]` | Confidence interval | `[STAT:ci] 95% CI [0.82, 0.94]` |
| `[STAT:effect_size]` | Effect magnitude | `[STAT:effect_size] Cohen's d = 0.75 (medium)` |
| `[STAT:p_value]` | Statistical significance | `[STAT:p_value] p = 0.003` |
| `[SO_WHAT]` | Practical significance | `[SO_WHAT] This means 15% cost reduction` |
| `[LIMITATION]` | Threats to validity | `[LIMITATION] Small sample size (n=50)` |

### ML Pipeline Markers

| Marker | Purpose | Example |
|--------|---------|---------|
| `[METRIC:baseline_*]` | Dummy model benchmark | `[METRIC:baseline_accuracy] 0.33` |
| `[METRIC:cv_*]` | Cross-validation scores | `[METRIC:cv_accuracy_mean] 0.95` |

> **Quality Gate**: Findings without `[STAT:ci]` and `[STAT:effect_size]` are marked as "Exploratory" in reports.

---

## 🔬 Research Quality

Gyoshu enforces **senior data scientist level** quality through automated quality gates. Every claim requires statistical evidence.

### The Finding Gating Rule

> ⚠️ **No `[FINDING]` is accepted without:**
> - `[STAT:ci]` — Confidence interval (within 10 lines before)
> - `[STAT:effect_size]` — Effect magnitude (within 10 lines before)

Findings that fail these checks are downgraded to "Exploratory Observations" in reports.

### Quality Standards

| Requirement | Penalty if Missing | Why It Matters |
|-------------|-------------------|----------------|
| **CI for findings** | -30 trust | Point estimates without uncertainty are misleading |
| **Effect size for findings** | -30 trust | Statistical significance ≠ practical significance |
| **Baseline for ML** | -20 trust | Can't claim improvement without a reference point |
| **Cross-validation for ML** | -25 trust | Single train/test split can be lucky |

### Trust Score Thresholds

| Score | Status | What Happens |
|-------|--------|--------------|
| ≥ 80 | ✅ Verified | Finding accepted as key result |
| 60-79 | ⚠️ Partial | Accepted with caveats |
| < 60 | ❌ Rejected | Marked as exploratory, requires rework |

> **Learn more:** See [AGENTS.md](AGENTS.md) for complete marker reference and statistical requirements.

---

## 🐍 Python Environment

Gyoshu uses your project's `.venv/` virtual environment:

| Priority | Type | How It's Detected |
|----------|------|-------------------|
| 1️⃣ | venv | `.venv/bin/python` exists |

**Quick setup:**
```bash
python3 -m venv .venv
.venv/bin/pip install pandas numpy scikit-learn matplotlib seaborn
```

> **Note:** Gyoshu uses your project's virtual environment. It never modifies system Python.

---

## 🛠️ Requirements

- **Claude Code** or **OpenCode** v0.1.0+
- **Python** 3.10+
- **Node.js** 18+ (for MCP server)
- **Optional**: `psutil` (for memory tracking)

### Supported Platforms

| Platform | Status | Notes |
|----------|--------|-------|
| **Linux** | ✅ Primary | Tested on Ubuntu 22.04+ |
| **macOS** | ✅ Supported | Intel & Apple Silicon |
| **Windows** | ⚠️ WSL2 Only | Native Windows not supported |

---

## 🔄 Updating

Gyoshu is distributed via npm. OpenCode automatically handles plugin updates.

**Force update:**
```bash
# Clear OpenCode's cache
rm -rf ~/.cache/opencode/node_modules/gyoshu

# Or reinstall with latest version
bunx gyoshu@latest install
```

Then restart OpenCode.

**Verify:** `opencode` then `/gyoshu doctor`

**Uninstall:**
```bash
bunx gyoshu uninstall
```

See [CHANGELOG.md](CHANGELOG.md) for what's new.

---

## 🎓 Why "Gyoshu" and "Jogyo"?

In Korean academia:

- **교수 (Gyoshu/Kyosu)** = Professor — the one who guides, plans, and oversees
- **조교 (Jogyo)** = Teaching Assistant — the one who executes, experiments, and does the heavy lifting

This reflects the architecture: Gyoshu is the orchestrator agent that plans and manages research flow, while Jogyo is the executor agent that actually runs Python code and produces results.

It's a partnership. The Professor has the vision. The TA makes it happen. Together, they publish papers. 📚

---

## 🤝 Optional Companion: Oh-My-OpenCode

> **Gyoshu works completely standalone.** It has its own agent stack and requires no other OpenCode extensions (like oh-my-opencode).

For **data-driven product development workflows**, you can optionally combine Gyoshu with [Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode):

| Tool | Focus | Independent? |
|------|-------|--------------|
| **Gyoshu (this project)** | 📊 Research & Analysis | ✅ Fully standalone |
| **[Oh-My-OpenCode](https://github.com/code-yeongyu/oh-my-opencode)** | 🏗️ Product Development | ✅ Fully standalone |

### Gyoshu's Own Agent Stack

Gyoshu includes everything it needs for research:

| Agent | Role | What They Do |
|-------|------|--------------|
| `@gyoshu` | Professor | Plans research, orchestrates workflow |
| `@jogyo` | TA | Executes Python code, runs experiments |
| `@baksa` | PhD Reviewer | Challenges claims, verifies evidence |
| `@jogyo-insight` | Evidence Gatherer | Searches docs, finds examples |
| `@jogyo-feedback` | Learning Explorer | Reviews past sessions for patterns |
| `@jogyo-paper-writer` | Report Writer | Transforms findings into narrative reports |

### Optional Workflow (When Combined)

If you choose to use both tools together:

1. **Research** with Gyoshu:
   ```
   /gyoshu-auto analyze user behavior and identify churn predictors
   ```
   → Produces insights: "Users who don't use feature X within 7 days have 3x churn rate"

2. **Build** with Oh-My-OpenCode:
   ```
   /planner implement onboarding flow that guides users to feature X
   ```
   → Ships the feature that addresses the insight

**Data informs decisions. Code ships solutions.** 🚀

> **Note:** You do NOT need Oh-My-OpenCode to use Gyoshu. Each tool works independently.

---

## 🔧 Troubleshooting

| Issue | Solution |
|-------|----------|
| **"No .venv found"** | Create a virtual environment: `python3 -m venv .venv && .venv/bin/pip install pandas numpy` |
| **"Bridge failed to start"** | Check Python version (need 3.10+): `python3 --version`. Check socket path permissions. |
| **"Session locked"** | Use `/gyoshu unlock <sessionId>` after verifying no process is running |
| **OpenCode not in PATH** | Install from [opencode-ai/opencode](https://github.com/opencode-ai/opencode) |

Still stuck? Run `/gyoshu doctor` to diagnose issues.

---

## 📄 License

MIT — Use it, fork it, teach with it!

---

<div align="center">

**Made with 🎓 for researchers who'd rather think than type**

[Report Bug](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [Request Feature](https://github.com/Yeachan-Heo/My-Jogyo/issues) · [Documentation](https://github.com/Yeachan-Heo/My-Jogyo/wiki)

</div>
