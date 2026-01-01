---
description: Unified Gyoshu research command - start, continue, search, and manage research
agent: gyoshu
---

# /gyoshu - Unified Research Command

$ARGUMENTS

---

## Command Dispatcher

Parse and route based on the first token of arguments:

### Reserved Subcommands

The following first tokens are reserved subcommands (case-sensitive exact match):

```
plan, continue, repl, list, search, report, replay, unlock, migrate, abort, help
```

### Routing Logic

```
1. Parse $ARGUMENTS into tokens
2. Extract first_token = first word of arguments
3. Route based on first_token:

   IF arguments empty:
      → Status Display Workflow
   
   ELSE IF first_token == "help":
      → Help Workflow
   
   ELSE IF first_token == "plan":
      → Plan Workflow (remaining args = goal)
   
   ELSE IF first_token == "continue":
      → Continue Workflow (remaining args = optional reportTitle)
   
   ELSE IF first_token == "repl":
      → REPL Workflow (remaining args = query)
   
   ELSE IF first_token == "list":
      → List Workflow (remaining args = filters)
   
   ELSE IF first_token == "search":
      → Search Workflow (remaining args = query + options)
   
   ELSE IF first_token == "report":
      → Report Workflow (remaining args = optional reportTitle)
   
   ELSE IF first_token == "replay":
      → Replay Workflow (remaining args = sessionId)
   
   ELSE IF first_token == "unlock":
      → Unlock Workflow (remaining args = sessionId)
   
   ELSE IF first_token == "migrate":
      → Migrate Workflow (remaining args = options)
   
   ELSE IF first_token == "abort":
      → Abort Workflow (remaining args = optional sessionId)
   
   ELSE:
      → New Research Workflow (entire arguments = goal)
```

---

## Help Workflow

**Trigger:** `/gyoshu help`

Display comprehensive usage information:

```
🔬 Gyoshu - Scientific Research Assistant

Usage:
  /gyoshu                     Show status and suggestions
  /gyoshu <goal>              Start new research with discovery
  /gyoshu plan <goal>         Create research plan only
  /gyoshu continue [id]       Continue existing research
  /gyoshu list [--status X]   List all researches
  /gyoshu search <query>      Search researches & notebooks
  /gyoshu report [id]         Generate research report
  /gyoshu repl <query>        Direct REPL exploration
  /gyoshu migrate [--dry-run] Migrate legacy sessions
  /gyoshu replay <sessionId>  Replay for reproducibility
  /gyoshu unlock <sessionId>  Unlock stuck session
  /gyoshu abort [sessionId]   Abort current research

For autonomous research (hands-off execution):
  /gyoshu-auto <goal>         Bounded autonomous execution

Examples:
  /gyoshu analyze customer churn patterns
  /gyoshu continue iris-clustering
  /gyoshu list --status active
  /gyoshu search "machine learning"
```

---

## Status Display Workflow

**Trigger:** `/gyoshu` (no arguments)

Display current project status and smart suggestions.

### Step 1: Get All Researches

```
research-manager(action: "list")
```

### Step 2: Display Status

**If researches found:**

```
🔬 Gyoshu Research

📊 Current Project Status:
| # | Research | Title | Status | Runs | Last Updated |
|---|----------|-------|--------|------|--------------|
| 1 | iris-clustering | Iris Species Analysis | active | 2 | 2024-01-15 |
| 2 | churn-analysis | Customer Churn | completed | 5 | 2024-01-10 |

💡 Suggestions:
- Continue #1: /gyoshu continue iris-clustering
- Start new: /gyoshu <your research goal>
- Search: /gyoshu search <query>
```

**If no researches found:**

```
🔬 Gyoshu Research

No research projects found in this project.

💡 Get started:
- Start research: /gyoshu <your research goal>
- Example: /gyoshu analyze the wine quality dataset

For autonomous research:
- /gyoshu-auto <goal>  (hands-off bounded execution)
```

### Step 3: Highlight Active Research

If there's an active research (status: "active" with IN_PROGRESS run):
- Show it prominently at the top
- Suggest continuing it first

---

## New Research Workflow

**Trigger:** `/gyoshu <goal>` (where goal is not a reserved subcommand)

Start new research with discovery phase to avoid duplication.

### Step 1: Discovery Phase

Before creating new research, search for similar prior work:

1. **Extract keywords** from the research goal
   - Identify key concepts, domain terms, methods, data types
   - Example: "analyze customer churn with XGBoost" → "churn customer XGBoost classification"

2. **Search for similar research:**
   ```
   research-manager(action: "search", data: { query: "<extracted keywords>" })
   ```

3. **If results found** (count > 0), display to user:
   ```
   🔍 Found N similar research projects:

    1. **[Title]** (status)
       "[snippet/goal]"
       → Continue: /gyoshu continue [reportTitle]
 
    2. **[Title]** (status)
       "[snippet/goal]"
       → Continue: /gyoshu continue [reportTitle]


   Options:
   A. Continue existing research - specify which one
   B. Start fresh with new research

   What would you like to do?
   ```

4. **If no results** (count = 0):
   - Inform user: "No similar prior research found. Starting fresh."
   - Proceed to New Research Phase

5. **User chooses to continue existing:**
    - Use Continue Workflow with chosen reportTitle
    - Do NOT create new research
 
 6. **User chooses to start fresh:**
    - Proceed to New Research Phase below
 
 **Skip discovery if:**
 - User explicitly says "start fresh" or "new research"
 - User provides a specific reportTitle to continue
 - User says "don't check for prior work"


### Step 2: New Research Phase

If starting fresh:

1. **Create research:**
   ```
   research-manager(action: "create", reportTitle: "[slug-from-goal]", data: {
     title: "[Derived from goal]",
     tags: ["[domain tags]"]
   })
   ```

2. **Add initial run:**
   ```
   research-manager(action: "addRun", reportTitle: "[slug-from-goal]", runId: "run-001", data: {
     goal: "[user's goal]",
     mode: "PLANNER",
     status: "IN_PROGRESS"
   })
   ```

3. **Initialize notebook:**
   ```
   notebook-writer(action: "ensure_notebook", reportTitle: "[slug-from-goal]", runId: "run-001")
   ```

4. **Begin interactive research:**
   - Delegate to @jogyo with clear objectives
   - Run in PLANNER mode (single-cycle, user-guided)

> **Note:** This starts interactive research where you guide each step. For fully autonomous research, use `/gyoshu-auto` instead.

---

## Plan Workflow

**Trigger:** `/gyoshu plan <goal>`

Create a detailed research plan without starting execution.

### Input

Everything after "plan" is the research goal.

### Output

Create a research plan with:

```markdown
# Research Plan: [Title]

## Objective
[Clear statement of what we're trying to discover/prove]

## Hypotheses
1. [H1]: [Description]
2. [H2]: [Description]

## Methodology
1. Data preparation
2. Exploratory analysis
3. Hypothesis testing
4. Validation

## Steps
- [ ] Step 1: [Description]
- [ ] Step 2: [Description]
- [ ] Step 3: [Description]

## Success Criteria
- [What constitutes a successful outcome]

## Data Requirements
- [Expected datasets, formats, locations]

## Tools & Libraries
- [Required Python packages]
```

Display the plan and ask:
```
Would you like to:
1. Start research with this plan: /gyoshu [repeat goal]
2. Modify the plan first
3. Save the plan for later
```

---

## Continue Workflow
 
 **Trigger:** `/gyoshu continue [reportTitle]`
 
 Continue an existing research project with rich context display.
 
 ### Step 1: Identify Research
 
 **If reportTitle provided:**
 ```
 research-manager(action: "get", reportTitle: "[provided title]")
 ```
 
 **If no reportTitle:**
 1. Get all researches: `research-manager(action: "list")`
 2. Find researches with active runs (status: "active", runs with "IN_PROGRESS")
 3. If one found: use it
 4. If multiple found: display list and ask user to pick
 5. If none found: suggest `/gyoshu <goal>` to start new
 
 ### Step 2: Get Research Context
 
 ```
 research-manager(action: "get", reportTitle: "[title]")
 ```
 
 Returns manifest with runs, summaries, metadata.
 
 ### Step 3: Display Context
 
 ```
 ## Continuing: [Research Title]
 
 **Report Title:** [reportTitle]
 **Status:** [status]
 **Created:** [createdAt] | **Last Updated:** [updatedAt]


**Goal:** [research goal from most recent run]

---

**Previous Runs:** N (X completed, Y in progress)

| Run ID | Mode | Status | Started | Duration |
|--------|------|--------|---------|----------|
| run_003 | AUTO | COMPLETED | 2024-01-15 | 45m |
| run_002 | PLANNER | COMPLETED | 2024-01-14 | 1h 20m |

---

**Key Findings:**
- [FINDING] Key discovery from recent runs
- [METRIC:accuracy] 0.87
- [CONCLUSION] Top predictor: monthly_charges

---

**Available Artifacts:**
| Artifact | Type | Run |
|----------|------|-----|
| correlation_heatmap.png | plot | run_002 |
| feature_importance.csv | csv | run_003 |

---

**REPL State:**
- Variables from previous session may still be available
- If REPL was closed, cells will be replayed from notebook
- Mode: [current run mode]

---

What would you like to do next?
```

### Step 4: Continue Research

1. Check if there's an active run (status: IN_PROGRESS)
   - If yes: continue with that run
   - If no: offer to start a new run or resume ABORTED run

2. Load context from research manifest for @jogyo delegation

3. The REPL environment is preserved - variables from previous executions are still available

4. If REPL was closed, cells will be replayed from the run's notebook

---

## List Workflow

**Trigger:** `/gyoshu list [filters]`

List all research projects with optional filtering.

### Supported Filters

| Filter | Description | Example |
|--------|-------------|---------|
| `--status` | Filter by status: active, completed, archived | `--status active` |
| `--tags` | Filter by tags (comma-separated, match any) | `--tags ml,analysis` |
| `--since` | Show researches created after date | `--since 2024-01-01` |
| `--until` | Show researches updated before date | `--until 2024-12-31` |

### Implementation

1. **Get all researches:**
   ```
   research-manager(action: "list")
   ```

2. **Apply filters** from arguments

3. **Display results:**
   ```
   📋 Research Projects

    | Report Title | Title | Status | Runs | Tags | Last Updated |
    |-------------|-------|--------|------|------|--------------|
    | iris-2024 | Iris Clustering | active | 3 | ml, iris | 2024-01-15 |
    | churn-v2 | Customer Churn | completed | 5 | sales | 2024-01-10 |
 
    Found 2 research(es)
 
    Quick actions:
    - /gyoshu continue <reportTitle> - Continue a research
    - /gyoshu search <query> - Search content
    - /gyoshu <goal> - Start new research

   ```

**If no researches match:**
```
No researches found matching filters.

Try:
- /gyoshu list (without filters)
- /gyoshu <goal> to start new research
```

---

## Search Workflow

**Trigger:** `/gyoshu search <query> [options]`

Search across research projects and notebook content.

### Supported Options

| Option | Description |
|--------|-------------|
| `--research-only` | Search research metadata only |
| `--notebooks-only` | Search notebooks only |
| `--no-outputs` | Exclude cell outputs from notebook search |
| `--limit N` | Maximum results per category (default: 10) |

### Step 1: Parse Arguments

Extract query and options from arguments.

**If no query provided:**
```
Usage: /gyoshu search <query> [options]

Examples:
  /gyoshu search customer churn
  /gyoshu search "machine learning" --notebooks-only
  /gyoshu search correlation --limit 5
```

### Step 2: Search Researches

Unless `--notebooks-only`:
```
research-manager(action: "search", data: { query: "<query>" })
```

### Step 3: Search Notebooks

Unless `--research-only`:
```
notebook-search(query: "<query>", includeOutputs: true/false, limit: N)
```

### Step 4: Display Results

```
## Search Results for "[query]"

### Research Projects (N matches)
 
 | Report Title | Title | Status | Matched | Snippet |
 |-------------|-------|--------|---------|---------|
 | iris-2024 | Iris Species Analysis | active | title, goal | Goal: Analyze iris dataset... |
 | churn-v2 | Customer Churn Prediction | completed | tags | Tag: churn |
 
 ### Notebook Content (N matches)
 
 | Report Title | Run | Cell | Type | Snippet |
 |----------|-----|------|------|---------|
 | iris-2024 | run_001 | cell-5 | code | ...correlation analysis of sepal... |
 | churn-v2 | run_002 | cell-12 | markdown | ## Customer Churn Analysis... |
 
 ---
 
 Found R research match(es) and N notebook match(es) for "[query]"
 
 Quick actions:
 - /gyoshu continue <reportTitle> - Continue a research
 - /gyoshu list - View all researches

```

**If no results:**
```
## No Results Found

No matches for "[query]" in research projects or notebooks.

Suggestions:
- Try different keywords
- Use /gyoshu list to see available research
- Check spelling of search terms
```

---

## Report Workflow
 
 **Trigger:** `/gyoshu report [reportTitle]`
 
 Generate a comprehensive research report.
 
 ### Step 1: Identify Research
 
 **If reportTitle provided:**
 Use it directly.
 
 **If no reportTitle:**
 1. Find the most recently active research
 2. If multiple active, ask user to specify
 3. If none active, ask user to specify
 
 ### Step 2: Get Research Data
 
 ```
 research-manager(action: "get", reportTitle: "[title]")
 ```
 
 For each run, get details:
 ```
 research-manager(action: "getRun", reportTitle: "[title]", runId: "[run_id]")
 ```


### Step 3: Generate Report

Create a comprehensive report with:

1. **Executive Summary**
   - Research objective
   - Key findings (top 3-5)
   - Primary conclusions

2. **Methodology**
   - Data sources
   - Analytical approaches
   - Tools and libraries used

3. **Key Findings with Evidence**
   - Each finding with supporting metrics
   - Visualizations and artifacts
   - Statistical significance where applicable

4. **Conclusions**
   - Answer to research question
   - Confidence level
   - Supporting evidence

5. **Limitations**
   - Data limitations
   - Methodological constraints
   - Scope limitations

6. **Recommended Next Steps**
   - Follow-up research questions
   - Additional data needs
   - Implementation suggestions

### Step 4: Offer Export

```
Report generated for: [Research Title]

Would you like to:
1. View the full report here
2. Export to Markdown file
3. Generate PDF (if wkhtmltopdf available)
```

---

## REPL Workflow

**Trigger:** `/gyoshu repl <query>`

Direct REPL access for exploratory research.

> **Note:** This workflow delegates to @jogyo agent for direct Python REPL access.

### Behavior

REPL mode provides:
- **Exploratory**: Investigate tangential questions
- **Interactive**: Propose and run experiments on the fly
- **Persistent**: Variables from previous executions available
- **Autonomous**: Agent can suggest follow-up analyses

### When to Use

- Quick data exploration (`what columns does df have?`)
- Debugging research code
- Ad-hoc statistical tests
- Exploring intermediate results
- One-off visualizations

### State Preservation

Your REPL environment persists:
- All variables, DataFrames, and models remain in memory
- Import statements carry forward
- Previous computations can be referenced

### Examples

```
/gyoshu repl what does the df DataFrame contain?
/gyoshu repl plot the correlation matrix for numeric columns
/gyoshu repl run a t-test between groups A and B
```

**Delegate to @jogyo:**

```
@jogyo [query from arguments]

Context: This is direct REPL exploration mode. You have freedom to:
- Investigate the question directly
- Suggest follow-up analyses
- Explore tangentially if useful

REPL state is preserved from previous sessions.
```

---

## Migrate Workflow

**Trigger:** `/gyoshu migrate [options]`

Migrate legacy data to newer storage formats. Supports two migration paths:

1. **Legacy Sessions → Research** (default): `~/.gyoshu/sessions/` → `./gyoshu/research/`
2. **Research → Notebooks** (`--to-notebooks`): `./gyoshu/research/` → `./notebooks/_migrated/`

### Supported Options

| Option | Description |
|--------|-------------|
| `--dry-run` | Preview what would be migrated without making changes |
| `--to-notebooks` | Migrate research to notebook-centric structure with frontmatter |
| `<id>` | Migrate only a specific session or research |

---

### Path A: Legacy Sessions → Research (Default)

### Step 1: Scan for Legacy Sessions

```
migration-tool(action: "scan")
```

Display results:
```
📦 Legacy Session Scan Results

Found N legacy sessions:

| Session ID | Created | Goal | Status | Notebook? | Artifacts |
|------------|---------|------|--------|-----------|-----------|
| ses_abc123 | 2024-12-15 | Analyze iris dataset | completed | Y | 3 files |
| ses_def456 | 2024-12-10 | Wine quality prediction | active | Y | 0 files |

Already migrated: M sessions
Pending migration: P sessions
```

**If no legacy sessions:**
```
No legacy sessions found at ~/.gyoshu/sessions/
Nothing to migrate.
```

### Step 2: Confirm Migration

**For normal mode:**
```
About to migrate P sessions to ./gyoshu/research/

This will:
- Copy notebooks and artifacts to the new location
- Create research manifests for each session
- Tag migrated research with "migrated-from-legacy"

IMPORTANT: Legacy sessions will NOT be deleted.
You can manually remove ~/.gyoshu/sessions/ after verifying.

Proceed with migration? [Y/n]
```

**For dry-run:** Skip confirmation, proceed to dry-run execution.

### Step 3: Execute Migration

```
migration-tool(action: "migrate", dryRun: true/false, sessionId: "[optional]")
```

Display progress:
```
Migrating sessions...

[1/3] ses_abc123 ... migrated (3 artifacts copied)
[2/3] ses_def456 ... migrated (0 artifacts copied)
[3/3] ses_ghi789 ... skipped (already migrated)
```

### Step 4: Verify (Not in Dry-Run)

```
migration-tool(action: "verify")
```

### Step 5: Display Summary

**Success:**
```
Migration Complete

Sessions migrated: 2
Sessions skipped: 1 (already migrated)
Sessions failed: 0

Your research is now available at: ./gyoshu/research/

Next steps:
- /gyoshu list to see all research
- /gyoshu continue <reportTitle> to continue
- After verifying, you may delete ~/.gyoshu/sessions/ manually
```

**Dry-run:**
```
Dry Run Complete

Would migrate: 2 sessions
Would skip: 1 sessions (already migrated)

To perform the actual migration:
  /gyoshu migrate
```

---

### Path B: Research → Notebooks (`--to-notebooks`)

Migrate research from `./gyoshu/research/` to the notebook-centric structure with YAML frontmatter.

### Step 1: Scan Research Projects

```
migration-tool(action: "scan-research")
```

Display results:
```
📓 Research Project Scan Results

Found N research projects:

| Research ID | Title | Status | Runs | Notebooks? | Artifacts |
|-------------|-------|--------|------|------------|-----------|
| iris-2024 | Iris Clustering | completed | 3 | Y | 5 files |
| churn-v1 | Customer Churn | active | 2 | Y | 2 files |

Already migrated to notebooks/: M projects
Pending migration: P projects
```

**If no research projects:**
```
No research projects found at gyoshu/research/
Nothing to migrate.
```

### Step 2: Confirm Migration

**For normal mode:**
 ```
 About to migrate P research projects to notebooks/
 
 This will:
 - Copy notebooks to notebooks/{reportTitle}.ipynb
 - Add YAML frontmatter with research metadata
 - Copy artifacts to reports/{reportTitle}/
 - Tag migrated notebooks with "migrated-from-legacy-research"
 
 IMPORTANT: Original research at gyoshu/research/ will NOT be deleted.

You can manually archive it after verifying.

Proceed with migration? [Y/n]
 ```
 
 **For dry-run:** Skip confirmation, proceed to dry-run execution.
 
 ### Step 3: Execute Migration
 
 ```
 migration-tool(action: "migrate-to-notebooks", dryRun: true/false, reportTitle: "[optional title]")
 ```
 
 Display progress:
 ```
 Migrating research to notebooks...
 
 [1/2] iris-2024 ... migrated (5 artifacts copied)
 [2/2] churn-v1 ... migrated (2 artifacts copied)
 ```
 
 ### Step 4: Display Summary
 
 **Success:**
 ```
 Migration Complete
 
 Research migrated: 2
 Research skipped: 0 (already migrated)
 Research failed: 0
 
 Your notebooks are now available at: ./notebooks/
 Artifacts copied to: ./reports/
 
 Next steps:
 - /gyoshu list to see all research (including migrated)
 - /gyoshu continue <reportTitle> to continue
 - After verifying, you may archive gyoshu/research/ manually

```

**Dry-run:**
```
Dry Run Complete

Would migrate: 2 research projects
Would skip: 0 projects (already migrated)

To perform the actual migration:
  /gyoshu migrate --to-notebooks
```

---

## Replay Workflow

**Trigger:** `/gyoshu replay <sessionId>`

Replay a session for reproducibility verification.

### Required Argument

`<sessionId>` - The session ID to replay (format: `ses_...`)

**If no sessionId provided:**
```
Usage: /gyoshu replay <sessionId>

Example: /gyoshu replay ses_abc123

To find session IDs:
- /gyoshu list (shows research with associated runs)
- Check run details for sessionId field
```

### Replay Process

1. **Start fresh REPL environment:**
   ```
   python-repl(action: "reset")
   ```

2. **Load session notebook:**
   Read the notebook associated with the session

3. **Execute cells in order:**
   Execute each code cell from the notebook sequentially

4. **Compare outputs:**
   - Compare new outputs with original outputs
   - Report differences (if any)

5. **Display results:**
   ```
   Replay Complete: ses_abc123

   Cells replayed: 15
   Outputs matched: 14 (93%)
   Outputs differed: 1

   Differences:
   - Cell 7: Random seed produced different results
     Expected: 0.8723
     Got: 0.8719

   Reproducibility Score: 93%
   ```

---

## Unlock Workflow

**Trigger:** `/gyoshu unlock <sessionId>`

Manually unlock a stuck session (use after crashes).

### Required Argument

`<sessionId>` - The session ID to unlock

**If no sessionId provided:**
```
Usage: /gyoshu unlock <sessionId>

Example: /gyoshu unlock ses_abc123

WARNING: Only use this if a session is stuck due to a crash.
If a process is still running, this may cause data corruption.
```

### Safety Warning

Display before proceeding:
```
WARNING: Force Unlock

Session: [sessionId]

Only use this command if:
- The session is stuck due to a crash
- You're certain no process is still using this session

If a process is still running, unlocking may cause:
- Data corruption
- Conflicting writes
- Lost work

Are you sure you want to force unlock? [y/N]
```

### Unlock Process

```
session-manager(action: "update", researchSessionID: "[sessionId]", data: {
  lock: null
})
```

**On success:**
```
Session unlocked: [sessionId]

You can now continue this session with:
 /gyoshu continue [associated reportTitle]
 ```
 
 ---
 
 ## Abort Workflow
 
 **Trigger:** `/gyoshu abort [sessionId]`
 
 Gracefully abort current research with state preservation.
 
 ### Step 1: Identify Session
 
 **If sessionId provided:**
 Use it directly.
 
 **If no sessionId:**
 1. Find the currently active session (IN_PROGRESS runs)
 2. If one found: use it
 3. If multiple: ask user to specify
 4. If none: inform user no active session to abort
 
 ### Step 2: Confirm Abort
 
 ```
 About to abort research session: [sessionId]
 
 This will:
 - Stop any in-progress REPL execution
 - Mark the session as ABORTED
 - Generate a partial report with work completed so far
 - Preserve all state (notebook, artifacts, variables)
 
 The session can be resumed later with:
 /gyoshu continue [reportTitle]
 
 Proceed with abort? [Y/n]
 ```
 
 ### Step 3: Execute Abort
 
 1. **Stop REPL execution:**
    ```
    python-repl(action: "interrupt")
    ```
 
 2. **Update run status:**
    ```
    research-manager(action: "updateRun", reportTitle: "...", runId: "...", data: {
      status: "ABORTED"
    })
    ```
 
 3. **Signal completion:**
    ```
    gyoshu-completion(researchSessionID: "[sessionId]", status: "ABORTED", 
      summary: "Research aborted by user")
    ```
 
 ### Step 4: Confirm
 
 ```
 Research session aborted: [sessionId]
 
 State preserved:
 - Notebook: [path]
 - Artifacts: N files
 - Variables: Saved in REPL
 
 To resume later:
 /gyoshu continue [reportTitle]
 ```
 
 ---
 
 ## Edge Cases
 
 ### Ambiguous Goals
 
 If goal starts with a reserved word (e.g., "list the findings"):
 - Match reserved words exactly as first token only
 - "list the findings" → NOT a subcommand (has more tokens after "list")
 - For true subcommands, use: `/gyoshu list` (single word)
 
 ### ID Confusion: reportTitle vs sessionId
 
 Accept both in relevant commands:
 - `ses_...` format → sessionId
 - Everything else → reportTitle
 
 The tools will resolve accordingly.
 
 ### Multiple Active Sessions
 
 Don't auto-select:
 - Display numbered table
 - Ask user to pick
 - Example:
   ```
   Multiple active researches found:
 
   | # | Research | Title | Last Updated |
   |---|----------|-------|--------------|
   | 1 | iris-2024 | Iris Clustering | 2024-01-15 |
   | 2 | churn-v2 | Customer Churn | 2024-01-14 |
 
   Which one? (Enter number or reportTitle)
   ```
 
 ### State Detection
 
 Don't auto-unlock or auto-migrate:
 - Only detect and suggest actions
 - Let user explicitly confirm
