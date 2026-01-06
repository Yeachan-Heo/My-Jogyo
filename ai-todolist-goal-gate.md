# AI Todolist: Fix Gyoshu Premature SUCCESS Bug

> **Goal**: Implement a Two-Gate System that prevents SUCCESS status when research goals are not met, even if evidence quality (Trust Gate) is high.

## Problem Statement

Currently, Gyoshu can declare SUCCESS when:
1. Trust Gate passes (Baksa verification >= 80)
2. Quality Gates pass (statistical evidence present)

But there's **NO check** that the actual research goal is achieved. Example:
- User: "Build a model with 90% accuracy"
- Jogyo builds model with 75% accuracy (with perfect statistical evidence)
- Baksa verifies evidence is solid -> Trust = 85
- Result: **SUCCESS** (but goal was 90%!)

## Solution: Two-Gate System

| Trust Gate | Goal Gate | Result |
|------------|-----------|--------|
| PASS | MET | SUCCESS |
| PASS | NOT_MET | PARTIAL -> Pivot |
| PASS | BLOCKED | BLOCKED |
| FAIL | MET | PARTIAL -> Rework trust |
| FAIL | NOT_MET | PARTIAL |
| FAIL | BLOCKED | BLOCKED |

---

## Phase 0: Prompt Alignment (Quick Win)

> **Effort**: 1-2 hours | **Risk**: Low | **Impact**: Medium
> **Goal**: Immediate behavioral improvement without code changes

### Task 0.1: Update gyoshu.md - Require Goal Contract
- [ ] **File**: `src/agent/gyoshu.md`
- [ ] **Location**: After "Starting New Research" section (~line 503)
- [ ] **Changes**:
  - Add "Goal Contract Creation" section requiring structured acceptance criteria
  - Add validation that Goal Contract exists before accepting SUCCESS
  - Add decision matrix showing Trust Gate + Goal Gate logic
- [ ] **Estimated Lines**: +50-80 lines

### Task 0.2: Update jogyo.md - Never Claim Unmet Goals
- [ ] **File**: `src/agent/jogyo.md`
- [ ] **Location**: "Completion Signaling" section (~line 999)
- [ ] **Changes**:
  - Add explicit rule: "NEVER signal SUCCESS unless acceptance criteria demonstrably met"
  - Add requirement to check goal metrics before completion
  - Add Goal Evidence section showing how to reference acceptance criteria
- [ ] **Estimated Lines**: +30-40 lines

### Task 0.3: Update baksa.md - Add Goal Evidence Challenge
- [ ] **File**: `src/agent/baksa.md`
- [ ] **Location**: "Challenge Generation Protocol" section (~line 42)
- [ ] **Changes**:
  - Add "Goal Achievement Challenges" section
  - Add challenge: "Does the evidence show acceptance criteria are met?"
  - Add trust score penalty for claiming SUCCESS without meeting goal metrics
- [ ] **Estimated Lines**: +40-50 lines

---

## Phase 1: Goal Contract Schema (Short)

> **Effort**: 2-3 hours | **Risk**: Low | **Impact**: High
> **Goal**: Define structured acceptance criteria in notebook frontmatter

### Task 1.1: Extend GyoshuFrontmatter Interface
- [ ] **File**: `src/lib/notebook-frontmatter.ts`
- [ ] **Location**: After `GyoshuFrontmatter` interface (~line 61)
- [ ] **Changes**:
  ```typescript
  /** Acceptance criteria kind */
  export type AcceptanceCriteriaKind = 
    | "metric_threshold"    // e.g., accuracy >= 0.90
    | "marker_required"     // e.g., [METRIC:baseline_accuracy] must exist
    | "artifact_exists"     // e.g., model.pkl must be created
    | "finding_count";      // e.g., at least 3 verified findings

  /** Single acceptance criterion */
  export interface AcceptanceCriterion {
    id: string;              // e.g., "AC1"
    kind: AcceptanceCriteriaKind;
    description?: string;    // Human-readable description
    // For metric_threshold
    metric?: string;         // e.g., "cv_accuracy_mean"
    op?: ">=" | ">" | "<=" | "<" | "==" | "!=";
    target?: number;
    // For marker_required
    marker?: string;         // e.g., "METRIC:baseline_accuracy"
    // For artifact_exists
    artifactPattern?: string; // e.g., "*.pkl"
    // For finding_count
    minCount?: number;
  }

  /** Goal contract for acceptance criteria */
  export interface GoalContract {
    version: number;         // Schema version (1)
    goal_text: string;       // Original user goal
    goal_type?: string;      // e.g., "ml_classification", "eda", "hypothesis_test"
    acceptance_criteria: AcceptanceCriterion[];
    max_goal_attempts?: number;  // Default: 3
  }
  ```
- [ ] **Then extend GyoshuFrontmatter**:
  ```typescript
  export interface GyoshuFrontmatter {
    // ... existing fields ...
    /** Goal contract for acceptance criteria evaluation */
    goal_contract?: GoalContract;
  }
  ```
- [ ] **Estimated Lines**: +60-80 lines

### Task 1.2: Update extractFrontmatter to Parse Goal Contract
- [ ] **File**: `src/lib/notebook-frontmatter.ts`
- [ ] **Location**: `extractFrontmatter` function (~line 474)
- [ ] **Changes**:
  - Add parsing for `goal_contract` field from YAML
  - Handle nested `acceptance_criteria` array
  - Validate required fields per criterion kind
- [ ] **Estimated Lines**: +30-40 lines

### Task 1.3: Update serializeToYaml for Goal Contract
- [ ] **File**: `src/lib/notebook-frontmatter.ts`
- [ ] **Location**: `serializeToYaml` function (~line 290)
- [ ] **Changes**:
  - Handle nested object serialization for goal_contract
  - Ensure acceptance_criteria array serializes correctly
- [ ] **Estimated Lines**: +20-30 lines

### Task 1.4: Add Goal Contract Validation
- [ ] **File**: `src/lib/notebook-frontmatter.ts`
- [ ] **Location**: After `validateFrontmatter` function (~line 700)
- [ ] **Changes**:
  ```typescript
  export function validateGoalContract(contract: GoalContract): { 
    isValid: boolean; 
    errors: string[] 
  }
  ```
  - Validate version is 1
  - Validate goal_text is non-empty
  - Validate each criterion has required fields for its kind
- [ ] **Estimated Lines**: +40-50 lines

### Task 1.5: Add Tests for Goal Contract Schema
- [ ] **File**: `src/lib/notebook-frontmatter.test.ts` (new or extend existing)
- [ ] **Changes**:
  - Test parsing valid goal contract
  - Test serialization roundtrip
  - Test validation errors for invalid contracts
  - Test backward compatibility (notebooks without goal_contract)
- [ ] **Estimated Lines**: +100-150 lines

---

## Phase 2: Goal Gate Evaluator Library (Short-Medium)

> **Effort**: 4-6 hours | **Risk**: Medium | **Impact**: High
> **Goal**: Library that evaluates acceptance criteria against notebook outputs

### Task 2.1: Create Goal Gates Library
- [ ] **File**: `src/lib/goal-gates.ts` (NEW)
- [ ] **Changes**:
  ```typescript
  /**
   * Goal Gates Library - Evaluate acceptance criteria against research outputs.
   * 
   * Complements quality-gates.ts (Trust Gate) with Goal Gate evaluation.
   * Together they form the Two-Gate system for research completion.
   * 
   * @module goal-gates
   */
  
  import { GoalContract, AcceptanceCriterion } from "./notebook-frontmatter";
  import { parseMarkers, ParsedMarker } from "./marker-parser";
  
  export type CriterionStatus = "MET" | "NOT_MET" | "BLOCKED" | "UNKNOWN";
  
  export interface CriterionResult {
    criterion: AcceptanceCriterion;
    status: CriterionStatus;
    actualValue?: number | string | boolean;
    message: string;
  }
  
  export interface GoalGateResult {
    passed: boolean;           // All criteria MET
    overallStatus: "MET" | "NOT_MET" | "BLOCKED" | "NO_CONTRACT";
    criteriaResults: CriterionResult[];
    metCount: number;
    totalCount: number;
    blockers?: string[];       // For BLOCKED status
  }
  
  /**
   * Evaluate goal contract against notebook outputs.
   */
  export function evaluateGoalGate(
    contract: GoalContract | undefined,
    notebookOutput: string,
    artifacts: string[]
  ): GoalGateResult
  ```
- [ ] **Estimated Lines**: 150-200 lines

### Task 2.2: Implement Metric Threshold Evaluator
- [ ] **File**: `src/lib/goal-gates.ts`
- [ ] **Changes**:
  ```typescript
  function evaluateMetricThreshold(
    criterion: AcceptanceCriterion,
    markers: ParsedMarker[]
  ): CriterionResult
  ```
  - Find `[METRIC:{metric}]` marker in outputs
  - Parse numeric value
  - Apply comparison operator
  - Return MET/NOT_MET with actual vs target
- [ ] **Estimated Lines**: +40-50 lines

### Task 2.3: Implement Marker Required Evaluator
- [ ] **File**: `src/lib/goal-gates.ts`
- [ ] **Changes**:
  ```typescript
  function evaluateMarkerRequired(
    criterion: AcceptanceCriterion,
    markers: ParsedMarker[]
  ): CriterionResult
  ```
  - Check if specified marker type exists
  - Support wildcards (e.g., "METRIC:baseline_*")
- [ ] **Estimated Lines**: +25-35 lines

### Task 2.4: Implement Artifact Exists Evaluator
- [ ] **File**: `src/lib/goal-gates.ts`
- [ ] **Changes**:
  ```typescript
  function evaluateArtifactExists(
    criterion: AcceptanceCriterion,
    artifacts: string[]
  ): CriterionResult
  ```
  - Match artifact patterns (glob-style)
  - Return MET if matching artifact found
- [ ] **Estimated Lines**: +20-30 lines

### Task 2.5: Implement Finding Count Evaluator
- [ ] **File**: `src/lib/goal-gates.ts`
- [ ] **Changes**:
  ```typescript
  function evaluateFindingCount(
    criterion: AcceptanceCriterion,
    markers: ParsedMarker[],
    qualityGateResult: QualityGateResult
  ): CriterionResult
  ```
  - Count verified findings (from quality gates)
  - Compare against minCount
- [ ] **Estimated Lines**: +20-25 lines

### Task 2.6: Add Pivot Protocol Support
- [ ] **File**: `src/lib/goal-gates.ts`
- [ ] **Changes**:
  ```typescript
  export interface PivotRecommendation {
    shouldPivot: boolean;
    attemptNumber: number;
    maxAttempts: number;
    suggestions: string[];
  }
  
  export function recommendPivot(
    result: GoalGateResult,
    attemptHistory: GoalGateResult[]
  ): PivotRecommendation
  ```
  - Track attempt count
  - Suggest different approaches after failures
  - Mark as "Unachievable" after 2+ distinct approaches fail
- [ ] **Estimated Lines**: +40-50 lines

### Task 2.7: Add Goal Gates Tests
- [ ] **File**: `src/lib/goal-gates.test.ts` (NEW)
- [ ] **Changes**:
  - Test metric threshold evaluation (>=, <, ==, etc.)
  - Test marker required evaluation
  - Test artifact exists evaluation
  - Test finding count evaluation
  - Test overall goal gate pass/fail logic
  - Test pivot recommendations
- [ ] **Estimated Lines**: +200-250 lines

---

## Phase 3: Enforce in Completion Tool (Short)

> **Effort**: 3-4 hours | **Risk**: Medium | **Impact**: Critical
> **Goal**: Integrate Goal Gate into gyoshu-completion.ts

### Task 3.1: Import and Load Goal Contract
- [ ] **File**: `src/tool/gyoshu-completion.ts`
- [ ] **Location**: After imports (~line 15)
- [ ] **Changes**:
  - Import goal-gates.ts
  - Import notebook-frontmatter.ts for extractFrontmatter
  - Add function to load goal contract from notebook
- [ ] **Estimated Lines**: +20-30 lines

### Task 3.2: Evaluate Goal Gate Before Final Status
- [ ] **File**: `src/tool/gyoshu-completion.ts`
- [ ] **Location**: After quality gate evaluation (~line 361)
- [ ] **Changes**:
  ```typescript
  // Evaluate Goal Gate (in addition to Trust Gate)
  let goalGateResult: GoalGateResult | undefined;
  
  if (status === "SUCCESS" && reportTitle) {
    const notebookPath = getNotebookPath(reportTitle);
    const notebook = JSON.parse(await fs.readFile(notebookPath, "utf-8"));
    const frontmatter = extractFrontmatter(notebook);
    
    if (frontmatter?.goal_contract) {
      goalGateResult = evaluateGoalGate(
        frontmatter.goal_contract,
        allOutput.join("\n"),
        typedEvidence?.artifactPaths || []
      );
      
      // Apply Two-Gate Decision Matrix
      if (!goalGateResult.passed) {
        adjustedStatus = "PARTIAL";
        warnings.push({
          code: "GOAL_NOT_MET",
          message: `Goal criteria not met: ${goalGateResult.metCount}/${goalGateResult.totalCount} criteria passed`,
          severity: "warning"
        });
      }
    }
  }
  ```
- [ ] **Estimated Lines**: +40-50 lines

### Task 3.3: Update Response with Goal Gate Result
- [ ] **File**: `src/tool/gyoshu-completion.ts`
- [ ] **Location**: Response construction (~line 436)
- [ ] **Changes**:
  - Add goalGates section to response
  - Include criteriaResults for transparency
  - Include pivot recommendations if applicable
- [ ] **Estimated Lines**: +20-30 lines

### Task 3.4: Track Goal Attempt Count
- [ ] **File**: `src/tool/gyoshu-completion.ts`
- [ ] **Changes**:
  - Store goal attempt count in session manifest
  - Increment on each PARTIAL due to goal failure
  - Trigger BLOCKED if max_goal_attempts exceeded
- [ ] **Estimated Lines**: +30-40 lines

### Task 3.5: Add Integration Tests
- [ ] **File**: `tests/goal-gates-integration.test.ts` (NEW)
- [ ] **Changes**:
  - Test SUCCESS with goal met
  - Test PARTIAL downgrade when goal not met
  - Test BLOCKED after max attempts
  - Test backward compatibility (no goal contract)
  - Test interaction with quality gates
- [ ] **Estimated Lines**: +150-200 lines

---

## Phase 4: Surface in Snapshots (Optional)

> **Effort**: 1-2 hours | **Risk**: Low | **Impact**: Medium
> **Goal**: Make goal status visible in gyoshu_snapshot for planner

### Task 4.1: Add Goal Status to Snapshot
- [ ] **File**: `src/tool/gyoshu-snapshot.ts`
- [ ] **Changes**:
  - Add `goalContract` summary to snapshot response
  - Add `goalProgress` showing met/total criteria
  - Add `lastGoalAttempt` tracking
- [ ] **Estimated Lines**: +30-40 lines

### Task 4.2: Update Snapshot Response Type
- [ ] **File**: `src/tool/gyoshu-snapshot.ts`
- [ ] **Changes**:
  ```typescript
  interface SnapshotResponse {
    // ... existing fields ...
    goalContract?: {
      goal_text: string;
      criteriaCount: number;
      metCount: number;
      attemptNumber: number;
      maxAttempts: number;
    };
  }
  ```
- [ ] **Estimated Lines**: +15-20 lines

---

## Phase 5: Documentation Update

> **Effort**: 1-2 hours | **Risk**: None | **Impact**: High
> **Goal**: Document the new Two-Gate system

### Task 5.1: Update AGENTS.md
- [ ] **File**: `AGENTS.md`
- [ ] **Location**: After "Research Quality Standards" section
- [ ] **Changes**:
  - Add "Goal Contract" section explaining the concept
  - Add "Two-Gate System" section with decision matrix
  - Add "Acceptance Criteria Types" reference table
  - Add examples of goal contracts for common research types
- [ ] **Estimated Lines**: +100-150 lines

### Task 5.2: Update README.md
- [ ] **File**: `README.md`
- [ ] **Location**: Features section
- [ ] **Changes**:
  - Add bullet about Goal Gate preventing premature SUCCESS
  - Update "Research Quality" section if exists
- [ ] **Estimated Lines**: +10-20 lines

---

## Implementation Order (Recommended)

```
Phase 0 (Immediate) ─────────────────────────────────────┐
  Task 0.1: gyoshu.md (Goal Contract requirement)        │
  Task 0.2: jogyo.md (Never claim unmet goals)           │ Can deploy immediately
  Task 0.3: baksa.md (Goal evidence challenges)          │ for behavioral improvement
─────────────────────────────────────────────────────────┘

Phase 1 (Foundation) ────────────────────────────────────┐
  Task 1.1: GyoshuFrontmatter interface                  │
  Task 1.2: extractFrontmatter parsing                   │ Schema must be stable
  Task 1.3: serializeToYaml update                       │ before library work
  Task 1.4: validateGoalContract                         │
  Task 1.5: Schema tests                                 │
─────────────────────────────────────────────────────────┘
                           │
                           ▼
Phase 2 (Library) ───────────────────────────────────────┐
  Task 2.1: goal-gates.ts skeleton                       │
  Task 2.2: Metric threshold evaluator                   │ Parallel development
  Task 2.3: Marker required evaluator                    │ possible for evaluators
  Task 2.4: Artifact exists evaluator                    │
  Task 2.5: Finding count evaluator                      │
  Task 2.6: Pivot protocol                               │
  Task 2.7: Library tests                                │
─────────────────────────────────────────────────────────┘
                           │
                           ▼
Phase 3 (Integration) ───────────────────────────────────┐
  Task 3.1: Import/load goal contract                    │
  Task 3.2: Evaluate goal gate                           │ Critical path -
  Task 3.3: Update response                              │ enforce the gates
  Task 3.4: Track attempt count                          │
  Task 3.5: Integration tests                            │
─────────────────────────────────────────────────────────┘
                           │
                           ▼
Phase 4 (Optional) ──────────────────────────────────────┐
  Task 4.1: Snapshot goal status                         │ Nice to have for
  Task 4.2: Snapshot response type                       │ planner visibility
─────────────────────────────────────────────────────────┘
                           │
                           ▼
Phase 5 (Documentation) ─────────────────────────────────┐
  Task 5.1: AGENTS.md update                             │
  Task 5.2: README.md update                             │
─────────────────────────────────────────────────────────┘
```

---

## Effort Summary

| Phase | Tasks | Estimated Hours | Risk |
|-------|-------|-----------------|------|
| **Phase 0** | 3 | 1-2 hours | Low |
| **Phase 1** | 5 | 2-3 hours | Low |
| **Phase 2** | 7 | 4-6 hours | Medium |
| **Phase 3** | 5 | 3-4 hours | Medium |
| **Phase 4** | 2 | 1-2 hours | Low |
| **Phase 5** | 2 | 1-2 hours | None |
| **Total** | 24 | 12-19 hours | - |

---

## Success Criteria

After implementation:

1. **Goal Contract Required**: Creating research with clear goals automatically generates acceptance criteria
2. **Goal Gate Enforced**: SUCCESS status only possible when:
   - Trust Gate passes (Baksa verification >= 80)
   - Quality Gates pass (statistical evidence present)
   - **Goal Gate passes (acceptance criteria met)** <- NEW
3. **Pivot on Failure**: When goal not met but evidence is solid:
   - Status becomes PARTIAL
   - Pivot recommendations provided
   - Max 3 attempts before BLOCKED
4. **Backward Compatible**: Existing notebooks without goal_contract still work (goal gate skipped)
5. **Transparent**: Goal gate results visible in completion response and snapshots

---

## Test Scenarios

### Scenario A: Goal Met + Trust High
```yaml
goal_contract:
  goal_text: "Build model with >= 80% accuracy"
  acceptance_criteria:
    - id: AC1
      kind: metric_threshold
      metric: cv_accuracy_mean
      op: ">="
      target: 0.80
```
- Model achieves 85% accuracy
- Trust score: 90
- **Expected**: SUCCESS

### Scenario B: Goal Not Met + Trust High
```yaml
goal_contract:
  goal_text: "Build model with >= 90% accuracy"
  acceptance_criteria:
    - id: AC1
      kind: metric_threshold
      metric: cv_accuracy_mean
      op: ">="
      target: 0.90
```
- Model achieves 75% accuracy (with perfect evidence)
- Trust score: 85
- **Expected**: PARTIAL (downgraded from SUCCESS)
- **Message**: "Goal criteria not met: 0/1 criteria passed"

### Scenario C: No Goal Contract (Backward Compat)
- Research created before goal_contract feature
- Trust score: 82
- Quality gates pass
- **Expected**: SUCCESS (goal gate skipped)

### Scenario D: Multiple Criteria, Partial Met
```yaml
goal_contract:
  goal_text: "Analyze customer churn with statistical evidence"
  acceptance_criteria:
    - id: AC1
      kind: metric_threshold
      metric: cv_accuracy_mean
      op: ">="
      target: 0.75
    - id: AC2
      kind: marker_required
      marker: "METRIC:baseline_accuracy"
    - id: AC3
      kind: finding_count
      minCount: 2
```
- Accuracy: 78% (MET)
- Baseline present (MET)
- Only 1 verified finding (NOT_MET)
- **Expected**: PARTIAL
- **Message**: "Goal criteria not met: 2/3 criteria passed"

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Breaking existing research | Backward compatibility: goal_contract is optional |
| Over-strict criteria blocking research | max_goal_attempts allows pivoting before BLOCKED |
| Complex criterion types needed | Start with 4 types, extensible interface for future |
| Performance impact on completion | Goal gate runs once at completion, minimal overhead |
| User confusion about two gates | Clear documentation and error messages |

---

## Open Questions

1. **Auto-generate criteria?** Should Gyoshu auto-generate acceptance criteria from goal text?
   - Pro: Less burden on user/planner
   - Con: May generate incorrect criteria
   - Recommendation: Start with manual, add auto-gen in future phase

2. **Criterion weights?** Should some criteria be more important than others?
   - Pro: Allows partial success for "nice to have" vs "must have"
   - Con: Adds complexity
   - Recommendation: Start simple (all or nothing), add weights later if needed

3. **Goal type inference?** Should goal_type affect which criteria kinds are relevant?
   - Pro: Better defaults per research type
   - Con: More complexity
   - Recommendation: Keep goal_type as metadata only, not logic driver
