# Gyoshu Research System - Implementation Plan

**Oracle Review Status**: YELLOW (Direction sound, scope trimmed)

## Executive Summary

Transform Gyoshu from a **session-centric** system to a **research-centric** system with:
- Project-local storage at `./gyoshu/` (Oracle: future-proof, shorter)
- Research as the primary organizational unit
- Clear separation: Sessions = runtime, Research = persistent artifacts
- Phased approach: Foundation first, advanced features later

### Phased Rollout (Oracle-Recommended)
- **Phase 1 (MVP)**: Path centralization + Research/Runtime split + Migration
- **Phase 2**: Basic discovery (directory scan, no separate index)
- **Phase 3**: Asset management + gyoshu-wikipedia agent
- **Phase 4**: Context engineering + Code reuse

---

## Current State Analysis

### Current Architecture
```
~/.gyoshu/sessions/{sessionId}/     # GLOBAL (wrong)
├── manifest.json                    # Session = everything mixed
├── notebook.ipynb
└── artifacts/

.gyoshu/retrospectives/             # Project-local (good)
└── feedback.jsonl
```

### Problems
1. **Sessions stored globally** - Research should belong to projects
2. **Session conflates** runtime (REPL state) with artifact (notebook)
3. **No cross-research discovery** - Can't find what was tried before
4. **No asset reuse** - Same data downloaded repeatedly
5. **No context engineering** - Jogyo starts blind each time
6. **No code reuse** - Good code locked in notebooks

---

## Target Architecture

### Storage Layout (Oracle Recommended)
```
project-root/
├── gyoshu/                              # PROJECT-LOCAL (Oracle: shorter, future-proof)
│   │
│   ├── config.json                      # Project config + schema version
│   │
│   ├── research/                        # Research records (PRIMARY UNIT)
│   │   └── {researchId}/
│   │       ├── research.json            # Goal, run summaries (hybrid)
│   │       ├── runs/
│   │       │   └── {runId}.json         # Full run details (hybrid)
│   │       ├── notebooks/
│   │       │   ├── exploration-1.ipynb
│   │       │   └── analysis.ipynb
│   │       └── artifacts/               # Research outputs
│   │
│   ├── lib/                             # Promoted reusable code (Phase 4)
│   │   ├── __init__.py
│   │   └── utils/
│   │
│   ├── assets/                          # Content-addressed store (Phase 3)
│   │   ├── catalog.json
│   │   └── sha256/
│   │
│   ├── external/                        # Downloaded knowledge (Phase 3)
│   │   └── items/
│   │
│   ├── retrospectives/                  # Learning feedback
│   │   ├── feedback.jsonl
│   │   └── index.json
│   │
│   └── runtime/                         # Ephemeral sessions (GITIGNORED)
│       └── {sessionId}/
│           ├── bridge.sock
│           └── session.lock
│
├── data/                                # User's data directory
│   └── wine_quality.csv
│
└── src/                                 # User's project code
```

**Terminology (Oracle Recommended)**:
- **Research**: User-facing primary unit (goal-oriented inquiry)
- **Run**: User-facing execution (one attempt at the goal)  
- **Session**: Internal runtime only (bridge, lock) - not exposed to users

### Key Abstractions

| Concept | Definition | Lifecycle |
|---------|------------|-----------|
| **Research** | Goal-oriented scientific inquiry | Persistent, owns notebooks/artifacts |
| **Run** | Single execution of /gyoshu-run or /gyoshu-auto | Within research, has context bundle |
| **Session** | Runtime REPL context (bridge + lock) | Ephemeral, tied to process |
| **Notebook** | Jupyter document with code/outputs | Artifact of research |

---

## Implementation Tasks

### Phase 1: Storage Migration (Priority: CRITICAL)

#### Task 1.1: Create Research Manager Tool
**File**: `.opencode/tool/research-manager.ts`

```typescript
// Schema
interface ResearchManifest {
  researchId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: "active" | "completed" | "archived";
  tags: string[];
  
  // Lineage
  parentResearchId?: string;
  derivedFrom?: Array<{ researchId: string; note?: string }>;
  
  // Runs
  runs: Array<{
    runId: string;
    startedAt: string;
    endedAt?: string;
    mode: "PLANNER" | "AUTO" | "REPL";
    goal: string;
    status: "PENDING" | "IN_PROGRESS" | "COMPLETED" | "BLOCKED" | "ABORTED" | "FAILED";
    keyResults: Array<{ type: string; text: string }>;
    artifacts: string[];
    sessionId?: string;  // Links to runtime session
  }>;
  
  // Accumulated knowledge
  summaries: {
    executive: string;
    methods: string[];
    pitfalls: string[];
  };
  
  // Asset references
  assetRefs: Array<{
    hash: string;
    logicalName: string;
    mime: string;
    role: "dataset" | "model" | "plot" | "export";
  }>;
}

// Actions: create, get, list, update, delete, search
```

#### Task 1.2: Update Session Manager for Project-Local
**File**: `.opencode/tool/session-manager.ts`

Changes:
- Change `SESSIONS_DIR` from `~/.gyoshu/sessions` to `./gyoshu-notebooks/runtime`
- Add `projectRoot` detection
- Sessions become purely runtime (no notebooks)
- Add `researchId` field to link sessions to research

#### Task 1.3: Update Notebook Writer for Research-Centric
**File**: `.opencode/tool/notebook-writer.ts`

Changes:
- Write to `./gyoshu-notebooks/research/{researchId}/notebooks/`
- Support multiple notebooks per research
- Add notebook naming strategy

#### Task 1.4: Update Retrospective Store Location
**File**: `.opencode/tool/retrospective-store.ts`

Changes:
- Move from `.gyoshu/retrospectives/` to `./gyoshu-notebooks/retrospectives/`

---

### Phase 2: Research Discovery (Priority: HIGH)

#### Task 2.1: Create Research Search Tool
**File**: `.opencode/tool/research-search.ts`

```typescript
// Actions
interface ResearchSearchArgs {
  action: "search" | "list" | "similar";
  query?: string;           // For search
  tags?: string[];          // Filter by tags
  status?: string;          // Filter by status
  limit?: number;           // Max results (default: 10)
  includeFindings?: boolean; // Include key findings in results
}

// Returns ranked list of research with:
// - researchId, title, goal, status
// - relevanceScore
// - snippet (matched text)
// - keyFindings (if requested)
```

#### Task 2.2: Create Notebook Search Tool
**File**: `.opencode/tool/notebook-search.ts`

```typescript
// Full-text search within notebooks
interface NotebookSearchArgs {
  query: string;
  researchId?: string;      // Scope to specific research
  cellType?: "code" | "markdown";
  includeOutputs?: boolean; // Default: false (outputs can be huge)
  limit?: number;
}

// Returns:
// - notebookPath, cellId, cellIndex
// - snippet with context
// - relevanceScore
```

#### Task 2.3: Create Research Index
**File**: `.opencode/tool/research-index.ts`

```typescript
// Maintain searchable index at ./gyoshu-notebooks/research/index.json
interface ResearchIndex {
  version: string;
  lastUpdated: string;
  researches: Array<{
    researchId: string;
    title: string;
    goal: string;
    status: string;
    tags: string[];
    keywords: string[];       // Extracted from notebooks
    keyFindings: string[];    // From [FINDING] markers
    updatedAt: string;
  }>;
}

// Actions: rebuild, update, query
```

---

### Phase 3: Asset Management (Priority: HIGH)

#### Task 3.1: Create Asset Store Tool
**File**: `.opencode/tool/asset-store.ts`

```typescript
interface AssetCatalog {
  version: string;
  lastUpdated: string;
  assets: Array<{
    hash: string;             // SHA-256
    logicalName: string;      // e.g., "wine_quality.csv"
    path: string;             // Original path
    mime: string;
    sizeBytes: number;
    
    // For datasets
    schema?: Array<{ name: string; dtype: string }>;
    shape?: { rows: number; cols: number };
    preview?: string;         // First few rows as text
    
    // Provenance
    source: "local" | "download" | "generated";
    sourceUrl?: string;
    sourceResearchId?: string;
    createdAt: string;
  }>;
}

// Actions: 
// - scan: Scan data/ directory, update catalog
// - register: Add asset with hash
// - get: Get asset by hash or name
// - promote: Promote research artifact to global store
// - link: Link asset to research
// - search: Search by name, type, schema
```

#### Task 3.2: Update Python REPL for Asset Awareness
**File**: `.opencode/tool/python-repl.ts`

Changes:
- Inject `./gyoshu-notebooks/lib/` into `sys.path`
- Inject `./src/` into `sys.path`
- On `ModuleNotFoundError`, return structured hint with install command
- Capture dataset loads and update asset catalog

---

### Phase 4: gyoshu-wikipedia Agent (Priority: HIGH)

#### Task 4.1: Create gyoshu-wikipedia Agent
**File**: `.opencode/agent/gyoshu-wikipedia.md`

```yaml
---
mode: subagent
description: Evidence retriever for research - searches prior work, assets, docs, web
model: anthropic/claude-sonnet-4-20250514
temperature: 0.2
maxSteps: 20
tools:
  research-search: true
  notebook-search: true
  asset-store: true
  retrospective-store: true
  webfetch: true
  websearch_exa_web_search_exa: true
  context7_resolve-library-id: true
  context7_query-docs: true
  grep_app_searchGitHub: true
  glob: true
  read: true
---
```

**Agent Behavior**:
1. Classify query: `prior_work` | `dataset_asset` | `how_to` | `similar_work` | `papers`
2. Search local-first (research → assets → retrospectives)
3. Only fetch external if internal insufficient
4. Return structured evidence bundle

**Output Schema**:
```json
{
  "success": true,
  "query": "...",
  "classification": "prior_work",
  "shouldStop": true,
  "answer": "1-3 sentence summary",
  "evidence": {
    "internal": [{ "type": "research", "title": "...", "path": "...", "snippet": "...", "score": 0.92 }],
    "retrospective": [{ "learning": "...", "score": 0.85 }],
    "external": [{ "type": "docs", "title": "...", "url": "...", "snippet": "..." }]
  },
  "suggestedNextActions": ["...", "..."],
  "availableAssets": [{ "name": "wine.csv", "path": "...", "shape": [1599, 12] }],
  "reusableCode": [{ "function": "preprocess_wine", "path": ".../wine_utils.py" }]
}
```

---

### Phase 5: Context Engineering (Priority: HIGH)

#### Task 5.1: Create Context Builder Tool
**File**: `.opencode/tool/context-builder.ts`

```typescript
interface ContextBundle {
  bundleId: string;
  researchId: string;
  runId: string;
  createdAt: string;
  
  // Token budgets per section
  budgets: {
    maxTokensTotal: number;
    sections: {
      priorResearch: number;
      packages: number;
      assets: number;
      constraints: number;
      external: number;
      recentState: number;
    };
  };
  
  sections: {
    priorResearch: Array<{ kind: string; text: string; sourceRef: string }>;
    packages: Array<{ kind: string; text: string; sourceRef: string }>;
    assets: Array<{ kind: string; text: string; sourceRef: string }>;
    constraints: Array<{ kind: string; text: string; sourceRef: string }>;
    external: Array<{ kind: string; text: string; sourceRef: string }>;
    recentState: Array<{ kind: string; text: string; sourceRef: string }>;
  };
  
  renderedPrompt: string;  // Formatted for injection into jogyo
}

// Actions: build, refresh, get
```

**Context Building Pipeline**:
1. **Eager (at /gyoshu-run)**:
   - Call gyoshu-wikipedia with research goal
   - Scan assets directory
   - Query retrospective-store
   - Capture environment (packages)
   
2. **Inject into jogyo prompt**:
   ```
   [CONTEXT_BUNDLE v1]
   Goal: ...
   
   Prior Research:
   - research-001: "wine clustering" - 3 clusters optimal
   
   Available Code:
   - from gyoshu_notebooks.lib.wine_utils import preprocess_wine
   
   Available Data:
   - wine_quality.csv (1599x12) at ./data/
   
   Constraints:
   - Use [FINDING], [METRIC:*] markers
   - StandardScaler before PCA (learned from research-001)
   
   [END_CONTEXT_BUNDLE]
   ```

3. **Lazy (during execution)**:
   - On error: refresh context with error details
   - On new import: update package context

#### Task 5.2: Update Jogyo Agent for Context
**File**: `.opencode/agent/jogyo.md`

Changes:
- Receive context bundle in prompt
- Use available code (auto-import gyoshu_notebooks.lib)
- Reference prior research in decisions
- Apply constraints from retrospectives

#### Task 5.3: Update Gyoshu Planner for Context Flow
**File**: `.opencode/agent/gyoshu.md`

Changes:
- Call context-builder before delegating to jogyo
- Pass context bundle to jogyo
- Call gyoshu-wikipedia for initial discovery

---

### Phase 6: Code Reuse Infrastructure (Priority: MEDIUM)

#### Task 6.1: Create Code Promoter Tool
**File**: `.opencode/tool/code-promoter.ts`

```typescript
// Extract code from notebooks to reusable modules
interface CodePromoterArgs {
  action: "scan" | "promote" | "list";
  notebookPath?: string;    // For scan/promote
  cellId?: string;          // Specific cell to promote
  targetModule?: string;    // e.g., "utils.preprocessing"
  functionName?: string;    // Name for the extracted function
}

// Promotion flow:
// 1. Read notebook cell with #| gyoshu:export marker
// 2. Extract function/class definition
// 3. Write to ./gyoshu-notebooks/lib/{module}.py
// 4. Update registry.json
```

**Marker Convention**:
```python
#| gyoshu:export utils.preprocessing
def clean_and_normalize(df):
    """Clean and normalize a dataframe."""
    df = df.dropna()
    df = (df - df.mean()) / df.std()
    return df
```

#### Task 6.2: Create Registry Manager
**File**: `.opencode/tool/registry-manager.ts`

```typescript
interface CodeRegistry {
  version: string;
  lastUpdated: string;
  modules: Array<{
    module: string;           // e.g., "utils.preprocessing"
    path: string;             // e.g., "./gyoshu-notebooks/lib/utils/preprocessing.py"
    functions: Array<{
      name: string;
      docstring?: string;
      signature?: string;
      sourceResearchId?: string;
      sourceNotebook?: string;
      sourceCellId?: string;
    }>;
  }>;
}

// Actions: list, get, search
```

#### Task 6.3: Create /gyoshu-promote Command
**File**: `.opencode/command/gyoshu-promote.md`

```yaml
---
description: Promote notebook code to reusable library
agent: gyoshu
---

Extract and promote reusable code from the current research:

$ARGUMENTS

Options:
- Scan current notebook for exportable code
- Promote specific cell to library module
- List all promoted code
```

---

### Phase 7: Command Updates (Priority: MEDIUM)

#### Task 7.1: Update /gyoshu-run Command
**File**: `.opencode/command/gyoshu-run.md`

Changes:
- Create or continue RESEARCH (not session)
- Build context bundle before execution
- Call gyoshu-wikipedia for initial discovery

#### Task 7.2: Update /gyoshu-continue Command
**File**: `.opencode/command/gyoshu-continue.md`

Changes:
- Continue existing RESEARCH
- Preserve context from previous runs
- Show what's available (code, assets, findings)

#### Task 7.3: Create /gyoshu-discover Command
**File**: `.opencode/command/gyoshu-discover.md`

```yaml
---
description: Discover relevant prior research, assets, and knowledge
agent: gyoshu-wikipedia
---

Search for relevant prior work:

$ARGUMENTS

This will search:
1. Previous research in this project
2. Available datasets and assets
3. Retrospective learnings
4. External documentation (if needed)
```

---

### Phase 8: Migration & Compatibility (Priority: LOW)

#### Task 8.1: Create Migration Tool
**File**: `.opencode/tool/migration-tool.ts`

```typescript
// Migrate from old ~/.gyoshu/sessions to new ./gyoshu-notebooks/research
interface MigrationArgs {
  action: "scan" | "migrate" | "verify";
  sourceDir?: string;       // Default: ~/.gyoshu/sessions
  dryRun?: boolean;         // Preview without changes
}

// Migration steps:
// 1. Scan old sessions
// 2. Create research for each session
// 3. Move notebooks and artifacts
// 4. Update manifests
// 5. Verify integrity
```

#### Task 8.2: Create Reindex Tool
**File**: `.opencode/tool/reindex-tool.ts`

```typescript
// Rebuild all indexes from source files
interface ReindexArgs {
  action: "research" | "assets" | "all";
  force?: boolean;          // Rebuild even if up-to-date
}
```

---

## Execution Order (Oracle-Revised)

### CRITICAL: Pre-Phase - Path Centralization (MUST DO FIRST)

**Problem**: Multiple tools hardcode `~/.gyoshu/sessions`:
- `.opencode/tool/session-manager.ts` (line 23)
- `.opencode/tool/python-repl.ts`
- `.opencode/tool/gyoshu-snapshot.ts`
- `.opencode/tool/gyoshu-completion.ts`
- `.opencode/plugin/gyoshu-hooks.ts`

**Solution**: Create centralized path resolver

#### Task 0.1: Create Path Resolver Library
**File**: `.opencode/lib/paths.ts`

```typescript
/**
 * Centralized path resolution for Gyoshu storage.
 * Single source of truth for all storage locations.
 */

import * as path from "path";
import * as os from "os";

// Project root detection strategy:
// 1. Check for ./gyoshu-notebooks/ existence
// 2. Check for pyproject.toml or package.json
// 3. Fall back to cwd
export function detectProjectRoot(): string {
  return process.cwd();  // Start simple, enhance later
}

export function getGyoshuRoot(projectRoot?: string): string {
  const root = projectRoot ?? detectProjectRoot();
  return path.join(root, "gyoshu-notebooks");
}

// Research storage (persistent artifacts)
export function getResearchDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "research");
}

export function getResearchPath(researchId: string, projectRoot?: string): string {
  return path.join(getResearchDir(projectRoot), researchId);
}

// Runtime storage (ephemeral sessions)
export function getRuntimeDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "runtime");
}

export function getSessionDir(sessionId: string, projectRoot?: string): string {
  return path.join(getRuntimeDir(projectRoot), sessionId);
}

// Other locations
export function getRetrospectivesDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "retrospectives");
}

export function getLibDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "lib");
}

export function getAssetsDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "assets");
}

export function getExternalDir(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "external");
}

// Legacy paths (for migration)
export function getLegacySessionsDir(): string {
  return path.join(os.homedir(), ".gyoshu", "sessions");
}

// Config/registry
export function getConfigPath(projectRoot?: string): string {
  return path.join(getGyoshuRoot(projectRoot), "config.json");
}
```

#### Task 0.2: Update All Tools to Use Path Resolver
Update these files to import from `../lib/paths.ts`:
- [ ] `.opencode/tool/session-manager.ts`
- [ ] `.opencode/tool/notebook-writer.ts`
- [ ] `.opencode/tool/python-repl.ts`
- [ ] `.opencode/tool/gyoshu-snapshot.ts`
- [ ] `.opencode/tool/gyoshu-completion.ts`
- [ ] `.opencode/tool/retrospective-store.ts`
- [ ] `.opencode/plugin/gyoshu-hooks.ts`

---

### Phase 1: Foundation (MVP) - Day 1-2

#### Task 1.0: Create Gyoshu Config
**File**: Schema for `./gyoshu-notebooks/config.json`

```json
{
  "version": "1.0.0",
  "schemaVersion": 1,
  "createdAt": "2025-12-31T...",
  "projectName": "my-research-project"
}
```

#### Task 1.1: Create Research Manager Tool
**File**: `.opencode/tool/research-manager.ts`
- CRUD for research manifests
- Store at `./gyoshu-notebooks/research/{researchId}/research.json`

#### Task 1.2: Update Session Manager (Runtime Only)
**File**: `.opencode/tool/session-manager.ts`
- Move to `./gyoshu-notebooks/runtime/{sessionId}/`
- Sessions become pure runtime (bridge socket, lock)
- Add `researchId` field to link to owning research
- **Keep reading old `~/.gyoshu/sessions/` for backwards compat**

#### Task 1.3: Update Notebook Writer (Research-Scoped)
**File**: `.opencode/tool/notebook-writer.ts`
- Write to `./gyoshu-notebooks/research/{researchId}/notebooks/`
- Support multiple notebooks per research

#### Task 1.4: Update Retrospective Store
**File**: `.opencode/tool/retrospective-store.ts`
- Move to `./gyoshu-notebooks/retrospectives/`

#### Task 1.5: Migration Command
**File**: `.opencode/command/gyoshu-migrate.md`
- Scan old `~/.gyoshu/sessions/`
- Create research for each session
- Move notebooks and artifacts
- **Never delete old sessions automatically**

#### Task 1.6: Update .gitignore Template
Ensure `./gyoshu-notebooks/runtime/` is gitignored (sockets, locks)

---

### Phase 2: Basic Discovery - Day 3

#### Task 2.1: Add Research List/Search to Research Manager
- `action: "list"` - List all researches
- `action: "search"` - Simple keyword search in goals/titles
- **No separate index tool** - scan directories directly

#### Task 2.2: Update gyoshu-run Command
- Create or continue RESEARCH (not just session)
- Show available prior research before starting

#### Task 2.3: Update gyoshu-continue Command
- Continue existing RESEARCH
- Show what's available from prior runs

---

### Phase 3: Asset Management + Wikipedia (Day 4-5) - DEFERRED

Only implement after Phase 1-2 proven:
- [ ] Asset Store with SHA-256 CAS
- [ ] gyoshu-wikipedia Agent
- [ ] External knowledge caching

---

### Phase 4: Context Engineering + Code Reuse (Day 6+) - DEFERRED

Only implement after Phase 3:
- [ ] Context Builder Tool
- [ ] Code Promoter Tool
- [ ] Registry Manager
- [ ] /gyoshu-promote Command

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Storage folder name | `gyoshu-notebooks/` | Visible, descriptive, not hidden |
| Primary unit | Research | Matches scientific inquiry lifecycle |
| Storage scope | Project-local | Research belongs to projects |
| Wikipedia agent | Single composite | Simpler than multiple specialized agents |
| Code reuse | Explicit promotion | Reproducible, visible, documented |
| Context gathering | Hybrid (eager + lazy) | Fast start, complete when needed |
| Asset deduplication | SHA-256 content-addressed | Industry standard, proven |

---

## Success Criteria

1. **Discovery works**: `/gyoshu-discover "clustering"` finds relevant prior research
2. **Assets reused**: Same dataset not downloaded twice
3. **Context rich**: Jogyo receives prior findings, available code, constraints
4. **Code promoted**: Good notebook code becomes importable library
5. **Research persistent**: Research survives session restarts
6. **Migration clean**: Old sessions import without data loss

---

## Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing workflows | Backward-compatible session-manager reads old path, migration tool |
| Migration data loss | Never auto-delete old sessions, explicit migrate command |
| Path inconsistency bugs | Centralize ALL paths in `lib/paths.ts` FIRST |
| Cross-platform filesystem issues | Reuse existing atomic write utilities |
| Scope creep | Phase 1 must work end-to-end before starting Phase 2 |

---

## Oracle Review Summary

**Status**: YELLOW - Direction sound, scope needs trimming

### Critical Issues (MUST Address)
1. **Path centralization FIRST** - Remove all hardcoded `~/.gyoshu/sessions` before any other changes
2. **Project root detection** - Define clear strategy for finding project root
3. **Runtime hygiene** - `./gyoshu-notebooks/runtime/` must be gitignored (sockets, locks)
4. **Backwards compatibility** - Support reading old sessions during transition

### Recommended Simplifications
1. Skip `research-index.ts` - Directory scan is fine at this scale
2. Defer `gyoshu-wikipedia` - Local discovery first, external later
3. Fold context-builder into planner - Promote to tool later if needed

### Integration Boundaries
- **gyoshu (planner)**: Owns research lifecycle, creates sessions, calls notebook-writer
- **jogyo (executor)**: Pure consumer - receives context, emits markers, no storage management

---

## Files to Create/Modify

### New Files (12)
- `.opencode/tool/research-manager.ts`
- `.opencode/tool/research-search.ts`
- `.opencode/tool/notebook-search.ts`
- `.opencode/tool/research-index.ts`
- `.opencode/tool/asset-store.ts`
- `.opencode/tool/context-builder.ts`
- `.opencode/tool/code-promoter.ts`
- `.opencode/tool/registry-manager.ts`
- `.opencode/tool/migration-tool.ts`
- `.opencode/tool/reindex-tool.ts`
- `.opencode/agent/gyoshu-wikipedia.md`
- `.opencode/command/gyoshu-discover.md`
- `.opencode/command/gyoshu-promote.md`

### Modified Files (7)
- `.opencode/tool/session-manager.ts`
- `.opencode/tool/notebook-writer.ts`
- `.opencode/tool/python-repl.ts`
- `.opencode/tool/retrospective-store.ts`
- `.opencode/agent/jogyo.md`
- `.opencode/agent/gyoshu.md`
- `.opencode/command/gyoshu-run.md`
- `.opencode/command/gyoshu-continue.md`

---

## Next Steps

1. **Oracle Review**: Get final architecture validation
2. **Create Todo List**: Convert this plan to executable checklist
3. **Begin Implementation**: Start with Phase 1 (Foundation)
