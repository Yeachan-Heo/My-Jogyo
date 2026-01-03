# Checkpoint/Resume System with Watchdog

> **Goal:** Implement full checkpoint/resume capability with mid-execution watchdog for Gyoshu/Jogyo research automation.

## Overview

Currently, Gyoshu delegates work to Jogyo and only verifies AFTER completion (post-hoc via Baksa). This wastes time when Jogyo goes down a wrong path. This plan implements:

1. **Step Slicing** - Jogyo executes in bounded stages, not monoliths
2. **Checkpoint System** - Durable artifacts + markers at stage boundaries
3. **Watchdog Supervisor** - Gyoshu monitors execution, can interrupt
4. **Resume Protocol** - Pick up from last valid checkpoint

## Architecture

```
User (/gyoshu-auto goal)
        |
        v
  Gyoshu (Planner/Orchestrator)
   - Stage plan + watchdog timer
   - Checkpoint/resume decisions
   - Interrupt authority
        |
        | delegates "Stage N" (bounded, max 4 min)
        v
  Jogyo (Executor)
   - Executes single stage
   - Emits [STAGE], [CHECKPOINT] markers
   - Writes artifacts at boundaries
        |
        v
 python-repl tool
   - SessionLock (single-writer)
   - Timeout + interrupt escalation
   - autoCapture -> notebook-writer
        |
        v
 checkpoint-manager (NEW)
   - save/list/validate/resume
   - Atomic checkpoint.json writes
   - Generate rehydration cells
```

## State Machine

```
STAGE STATES:
  PENDING -> RUNNING -> COMPLETED
                    \-> INTERRUPTING -> INTERRUPTED -> RESUMABLE
                    \-> FAILED -> RESUMABLE (if checkpoint exists)
                            \-> BLOCKED (if no checkpoint)

RUN STATES:
  PLANNED -> IN_PROGRESS -> COMPLETED
                        \-> ABORTED (manual)
                        \-> INTERRUPTED (watchdog)
```

---

## Phase 1: Step Slicing Protocol (Foundation)

### Task 1.1: Define Stage Protocol Spec
**File:** `docs/stage-protocol.md` (NEW)
**Parallelizable:** YES (with 1.2)

- [x] 1.1.1 Define stage envelope format (stageId, goal, inputs, outputs, maxDurationSec)
- [x] 1.1.2 Define stage naming convention: `S{NN}_{verb}_{noun}` (e.g., `S01_load_data`)
- [x] 1.1.3 Define idempotence requirements (stages must be re-runnable)
- [x] 1.1.4 Define artifact naming: `{runId}/{stageId}/{artifactName}`
- [x] 1.1.5 Document max stage durations (default 4 min, absolute max 10 min)

### Task 1.2: Add STAGE Marker to Parser
**File:** `src/lib/marker-parser.ts`
**Parallelizable:** YES (with 1.1)

- [x] 1.2.1 Add `STAGE` marker type to taxonomy (category: WORKFLOW)
- [x] 1.2.2 Support subtypes: `begin`, `end`, `progress`
- [x] 1.2.3 Support key=value attributes: `id=S01_load_data:duration=120s`
- [x] 1.2.4 Add tests for STAGE marker parsing
- [x] 1.2.5 Update marker-parser.test.ts

### Task 1.3: Update Jogyo Agent for Stage Protocol
**File:** `src/agent/jogyo.md`
**Parallelizable:** NO (depends on 1.1)

- [x] 1.3.1 Add "Stage Execution Protocol" section
- [x] 1.3.2 Document stage boundary requirements (emit markers, write artifacts)
- [x] 1.3.3 Add idempotence rules (unique artifact names, no in-place mutation)
- [x] 1.3.4 Add stage templates for common patterns (load, eda, train, eval)
- [x] 1.3.5 Document "when to split" guidance (> 3 min = split)

### Task 1.4: Update Gyoshu for Stage Delegation
**File:** `src/agent/gyoshu.md`
**Parallelizable:** NO (depends on 1.1)

- [x] 1.4.1 Add "Stage Planning" section
- [x] 1.4.2 Document stage delegation format (stageId, goal, maxDuration)
- [x] 1.4.3 Add stage plan template for research workflows
- [x] 1.4.4 Document inter-stage verification points

---

## Phase 2: Checkpoint Marker & Manifest System

### Task 2.1: Add CHECKPOINT Marker Type
**File:** `src/lib/marker-parser.ts`
**Parallelizable:** YES (with 2.2)

- [x] 2.1.1 Add `CHECKPOINT` marker type (category: WORKFLOW)
- [x] 2.1.2 Support subtypes: `saved`, `begin`, `end`, `emergency`
- [x] 2.1.3 Support attributes: `id`, `runId`, `stage`, `manifest`, `status`
- [x] 2.1.4 Add tests for CHECKPOINT parsing
- [x] 2.1.5 Example: `[CHECKPOINT:saved:id=ckpt-001:stage=S02_eda:manifest=reports/.../checkpoint.json]`

### Task 2.2: Define Checkpoint Manifest Schema ✅ COMPLETE
**File:** `src/lib/checkpoint-schema.ts` (NEW)
**Parallelizable:** YES (with 2.1)

- [x] 2.2.1 Define `CheckpointManifest` TypeScript interface
- [x] 2.2.2 Include fields: checkpointId, researchSessionID, reportTitle, runId, stageId
- [x] 2.2.3 Include timing: createdAt, executionCount
- [x] 2.2.4 Include notebook reference: path, checkpointCellId
- [x] 2.2.5 Include python env: pythonPath, packages, platform
- [x] 2.2.6 Include artifacts array: relativePath, sha256, sizeBytes
- [x] 2.2.7 Include rehydration: mode (artifacts_only|with_vars), rehydrationCellSource
- [x] 2.2.8 Include integrity: manifestSha256
- [x] 2.2.9 Add Zod validation schema

### Task 2.3: Create Checkpoint Manager Tool ✅ COMPLETE
**File:** `src/tool/checkpoint-manager.ts` (NEW)
**Parallelizable:** NO (depends on 2.2)

- [x] 2.3.1 Create tool with actions: save, list, validate, resume, prune
- [x] 2.3.2 Implement `save`: write checkpoint.json atomically, append checkpoint cell
- [x] 2.3.3 Implement `list`: find checkpoints for reportTitle/runId
- [x] 2.3.4 Implement `validate`: verify artifacts exist, check sha256, report integrity
- [x] 2.3.5 Implement `resume`: find last valid checkpoint, generate rehydration cell
- [x] 2.3.6 Implement `prune`: keep last K checkpoints, clean old ones
- [x] 2.3.7 Use `durableAtomicWrite` for manifest writes
- [x] 2.3.8 Tag checkpoint cells with `gyoshu-checkpoint`

### Task 2.4: Update Paths Library ✅ COMPLETE
**File:** `src/lib/paths.ts`
**Parallelizable:** YES (with 2.3)

- [x] 2.4.1 Add `getCheckpointDir(reportTitle, runId)` function
- [x] 2.4.2 Returns `reports/{reportTitle}/checkpoints/{runId}/`
- [x] 2.4.3 Add `getCheckpointManifestPath(reportTitle, runId, checkpointId)`
- [x] 2.4.4 Add tests for new path functions

### Task 2.5: Write Checkpoint Manager Tests
**File:** `src/tool/checkpoint-manager.test.ts` (NEW)
**Parallelizable:** NO (depends on 2.3)

- [x] 2.5.1 Test save action: creates manifest, appends cell
- [x] 2.5.2 Test list action: finds checkpoints in order
- [x] 2.5.3 Test validate action: passes valid, fails corrupt
- [x] 2.5.4 Test resume action: generates rehydration cell
- [x] 2.5.5 Test prune action: keeps K, removes old
- [x] 2.5.6 Test corruption fallback: skips invalid, uses previous

---

## Phase 3: Watchdog Supervisor System

### Task 3.1: Add Watchdog Logic to Gyoshu AUTO ✅ COMPLETE
**File:** `src/command/gyoshu-auto.md`
**Parallelizable:** NO (depends on Phase 2)

- [x] 3.1.1 Add "Stage Watchdog" section documenting supervisor behavior
- [x] 3.1.2 Document polling cadence (every 5-10s during stage execution)
- [x] 3.1.3 Document timeout thresholds (soft: maxDuration, hard: maxDuration + 30s)
- [x] 3.1.4 Document escalation: interrupt -> wait 5s -> terminate -> wait 3s -> kill
- [x] 3.1.5 Document emergency checkpoint trigger on watchdog abort

### Task 3.2: Update Gyoshu Agent Watchdog Behavior
**File:** `src/agent/gyoshu.md`
**Parallelizable:** YES (with 3.1)

- [x] 3.2.1 Add "Watchdog Supervision" section
- [x] 3.2.2 Document signals to watch: no new cells, no markers, runtime exceeded
- [x] 3.2.3 Document intervention decision tree
- [x] 3.2.4 Document post-interrupt recovery flow
- [x] 3.2.5 Add watchdog state machine diagram

### Task 3.3: Enhance Python REPL Interrupt ✅ COMPLETE
**File:** `src/tool/python-repl.ts`
**Parallelizable:** YES (with 3.2)

- [x] 3.3.1 Review current interrupt escalation (SIGINT -> SIGTERM -> SIGKILL)
- [x] 3.3.2 Add `interruptWithTimeout` option for graceful shutdown window
- [x] 3.3.3 Ensure interrupt preserves last cell output if possible
- [x] 3.3.4 Add tests for interrupt escalation timing

### Task 3.4: Add Emergency Checkpoint Support ✅ COMPLETE
**File:** `src/tool/checkpoint-manager.ts`
**Parallelizable:** NO (depends on 3.3)

- [x] 3.4.1 Add `emergency` action for watchdog-triggered checkpoints
- [x] 3.4.2 Emergency checkpoint = metadata only (no artifact validation)
- [x] 3.4.3 Mark status as `interrupted` in manifest
- [x] 3.4.4 Store reason: `watchdog_timeout`, `manual_abort`, `error`

---

## Phase 4: Resume Protocol

**Currently in progress:** None

### Task 4.1: Implement Resume Discovery
**File:** `src/tool/checkpoint-manager.ts`
**Parallelizable:** NO (depends on Phase 2, 3)

- [x] 4.1.1 Add `findLastValidCheckpoint(reportTitle, runId?)` function
- [x] 4.1.2 Search checkpoints in reverse chronological order
- [x] 4.1.3 Validate each: manifest parses, artifacts exist, sha256 matches
- [x] 4.1.4 Return first valid checkpoint or null
- [x] 4.1.5 Log validation failures for debugging

### Task 4.2: Implement Rehydration Cell Generator
**File:** `src/tool/checkpoint-manager.ts`
**Parallelizable:** NO (depends on 4.1)

- [x] 4.2.1 Generate imports from checkpoint python.packages
- [x] 4.2.2 Generate random seed restoration if stored
- [x] 4.2.3 Generate artifact loading code (joblib.load, pd.read_parquet, etc.)
- [x] 4.2.4 Generate variable assignments from loaded artifacts
- [x] 4.2.5 Add `[REHYDRATED:from=ckpt-xxx]` marker to output
- [x] 4.2.6 Return complete cell source as string array

### Task 4.3: Update Gyoshu Continue Flow
**File:** `src/command/gyoshu.md`
**Parallelizable:** NO (depends on 4.2)

- [x] 4.3.1 Update `continue` subcommand to check for resumable state
- [x] 4.3.2 If checkpoint exists: offer resume from checkpoint
- [x] 4.3.3 On resume: execute rehydration cell, then continue from next stage
- [x] 4.3.4 If no checkpoint: continue from last notebook cell as before
- [x] 4.3.5 Document resume flow in command help

### Task 4.4: Add Resume Integration Tests
**File:** `tests/checkpoint-resume.test.ts` (NEW)
**Parallelizable:** NO (depends on 4.3)

- [x] 4.4.1 Test: create checkpoint, "crash" bridge, resume, verify rehydration
- [x] 4.4.2 Test: multiple checkpoints, resume from latest valid
- [x] 4.4.3 Test: corrupt checkpoint, fallback to previous
- [x] 4.4.4 Test: resume continues from correct next stage
- [x] 4.4.5 Test: artifacts load correctly after rehydration

---

## Phase 5: Integration & Polish

### Task 5.1: Update Gyoshu Snapshot
**File:** `src/tool/gyoshu-snapshot.ts`
**Parallelizable:** YES (with 5.2)

- [x] 5.1.1 Add `lastCheckpoint` field to snapshot output
- [x] 5.1.2 Include: checkpointId, stageId, createdAt, status
- [x] 5.1.3 Add `resumable` boolean based on checkpoint validity

### Task 5.2: Update Report Generation
**File:** `src/lib/report-markdown.ts`
**Parallelizable:** YES (with 5.1)

- [x] 5.2.1 Add optional "Execution History" section
- [x] 5.2.2 List stages executed with timing
- [x] 5.2.3 Note any interrupts/resumes

### Task 5.3: Update AGENTS.md Documentation
**File:** `AGENTS.md`
**Parallelizable:** YES (with 5.1, 5.2)

- [x] 5.3.1 Add "Checkpoint System" section
- [x] 5.3.2 Document checkpoint markers and format
- [x] 5.3.3 Document resume commands and behavior
- [x] 5.3.4 Add troubleshooting for checkpoint issues

### Task 5.4: End-to-End Integration Test
**File:** `tests/integration.test.ts`
**Parallelizable:** NO (final integration)

- [x] 5.4.1 Add test: full research with stages + checkpoints
- [x] 5.4.2 Add test: watchdog timeout triggers checkpoint + abort
- [x] 5.4.3 Add test: resume from aborted research
- [x] 5.4.4 Verify notebook contains checkpoint cells
- [x] 5.4.5 Verify artifacts in correct locations

---

## File Change Summary

### New Files
| File | Purpose |
|------|---------|
| `docs/stage-protocol.md` | Stage slicing specification |
| `src/lib/checkpoint-schema.ts` | Checkpoint manifest types + validation |
| `src/tool/checkpoint-manager.ts` | Checkpoint CRUD + resume logic |
| `src/tool/checkpoint-manager.test.ts` | Checkpoint tool tests |
| `tests/checkpoint-resume.test.ts` | Integration tests for resume |

### Modified Files
| File | Changes |
|------|---------|
| `src/lib/marker-parser.ts` | Add STAGE, CHECKPOINT markers |
| `src/lib/paths.ts` | Add checkpoint path helpers |
| `src/agent/jogyo.md` | Add stage execution protocol |
| `src/agent/gyoshu.md` | Add watchdog + resume behavior |
| `src/command/gyoshu.md` | Update continue for checkpoint resume |
| `src/command/gyoshu-auto.md` | Add watchdog supervision |
| `src/tool/python-repl.ts` | Enhance interrupt handling |
| `src/tool/gyoshu-snapshot.ts` | Add checkpoint info |
| `src/lib/report-markdown.ts` | Add execution history |
| `AGENTS.md` | Document checkpoint system |

---

## Effort Estimates

| Phase | Tasks | Estimate | Dependencies |
|-------|-------|----------|--------------|
| Phase 1: Step Slicing | 4 tasks | 4-6 hours | None |
| Phase 2: Checkpoint System | 5 tasks | 8-12 hours | Phase 1 |
| Phase 3: Watchdog | 4 tasks | 4-6 hours | Phase 2 |
| Phase 4: Resume | 4 tasks | 6-8 hours | Phase 2, 3 |
| Phase 5: Integration | 4 tasks | 4-6 hours | All |
| **Total** | **21 tasks** | **26-38 hours** | |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Checkpoint artifact corruption | Medium | High | SHA256 validation + fallback to previous |
| REPL dies mid-checkpoint | Medium | Medium | Write manifest last as commit record |
| Native code ignores SIGINT | Medium | Medium | SIGKILL escalation + emergency checkpoint |
| Resume env mismatch | Low | Medium | Store env info, warn on drift |
| Checkpoint size bloat | Low | Low | Prune old checkpoints, size limits |

---

## Success Criteria

1. **Stage Slicing**: Jogyo never runs > 4 min without checkpoint
2. **Checkpoint Durability**: Checkpoints survive bridge crashes
3. **Resume Accuracy**: `continue` restores to exact last-good state
4. **Watchdog Responsiveness**: Stuck stages interrupted within 30s of timeout
5. **Zero Data Loss**: No research work lost on interrupt/crash

---

## Notes

- This plan prioritizes **artifacts-only resume** (robust) over variable snapshotting (complex)
- Watchdog lives in Gyoshu planner, not bridge (simpler architecture)
- Emergency checkpoints are metadata-only (no artifact validation)
- Default retention: 5 checkpoints per run
