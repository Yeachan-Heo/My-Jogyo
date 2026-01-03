---
description: Start goal-based autonomous research with bounded execution
agent: gyoshu
---

Start an AUTONOMOUS research session for the following goal:

$ARGUMENTS

---

> **This is the standalone autonomous research command.** For interactive, step-by-step research, use `/gyoshu <goal>` instead. The `/gyoshu-auto` command runs to completion without user intervention (within budget limits).

---

## AUTO Mode Behavior

This command runs in **AUTO mode** - bounded autonomous execution that:
1. Creates or continues a session targeting the specified goal
2. Runs a bounded loop: delegate to @jogyo → **verify with @baksa** → check completion
3. Continues until goal is COMPLETED, BLOCKED (needs user input), or budget exhausted

### Adversarial Verification Loop

Every cycle includes mandatory verification by @baksa (the PhD reviewer):

```
FOR each cycle:
  1. Delegate task to @jogyo
  2. Receive completion signal
  3. CHALLENGE LOOP (max 3 rounds):
     a. Get snapshot of evidence
     b. Invoke @baksa to challenge claims
     c. If trust score >= 80: ACCEPT, continue
     d. If trust score < 80: REWORK request to @jogyo
     e. If 3 rounds fail: Mark BLOCKED, report to user
  4. Increment cycle, continue to next objective
```

This ensures research quality through systematic skepticism - no claim passes without verification.

### Stage Watchdog

The Stage Watchdog supervises Jogyo's execution of each stage, ensuring bounded execution and graceful recovery from stuck or runaway processes.

#### Polling Behavior

During stage execution, Gyoshu monitors progress every **5-10 seconds**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Stage Execution                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│   t=0s     t=5s     t=10s    t=15s    t=20s    ...         │
│     │        │        │        │        │                   │
│     ▼        ▼        ▼        ▼        ▼                   │
│   [poll]  [poll]  [poll]  [poll]  [poll]                   │
│                                                             │
│   Each poll checks:                                         │
│   ✓ New cells executed since last poll?                     │
│   ✓ New markers emitted ([STAGE:progress], [METRIC:*])?     │
│   ✓ New artifacts created in output directory?              │
│   ✓ Runtime within maxDuration limit?                       │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

**Progress Signals:**
| Signal | Indicates | Example |
|--------|-----------|---------|
| New cells | Execution is progressing | Cell count: 5 → 6 |
| New markers | Research milestones reached | `[STAGE:progress:pct=50]` |
| New artifacts | Output being produced | `model.pkl` created |
| REPL output | Active computation | stdout/stderr activity |

**Stall Detection:**
A stage is considered **stalled** if no progress signals are detected for 3 consecutive polls (15-30 seconds). Stall triggers a warning but not immediate intervention—some operations (model training) may have long compute phases without output.

#### Timeout Thresholds

Timeouts are based on the stage's `maxDurationSec` from the stage envelope:

| Threshold | Time | Action |
|-----------|------|--------|
| **Soft Timeout** | `maxDuration` | Warning logged, grace period begins |
| **Hard Timeout** | `maxDuration + 30s` | Interrupt signal sent |
| **Absolute Limit** | 600s (10 min) | Cannot exceed regardless of envelope |

**Timeline Diagram:**

```
Time 0                   maxDuration              maxDuration+30s
  │                           │                         │
  │←──── Normal Execution ────│←──── Grace Period ─────│
  │                           │                         │
  │  [STAGE:begin]            │  [WARNING: soft        │  [SIGINT sent]
  │                           │   timeout exceeded]     │
  │  Regular polling          │                         │
  │  every 5-10s              │  Polling intensifies   │  Escalation
  │                           │  to every 2s           │  begins
  │                           │                         │
```

#### Escalation Sequence

When hard timeout is reached, the watchdog escalates through increasingly forceful termination signals:

```
┌─────────────────────────────────────────────────────────────────────┐
│                     WATCHDOG ESCALATION                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  t=maxDur          t=maxDur+5s      t=maxDur+8s      t=maxDur+10s  │
│      │                  │                │                │         │
│      ▼                  ▼                ▼                ▼         │
│   SIGINT            SIGTERM          SIGKILL         CHECKPOINT    │
│   (graceful)        (terminate)      (force kill)    (emergency)   │
│                                                                     │
│  ┌──────────┐      ┌──────────┐      ┌──────────┐   ┌───────────┐  │
│  │ Request  │──5s─▶│  Force   │──3s─▶│  Kill    │─2s▶│  Save     │  │
│  │ cleanup  │      │ terminate│      │  process │    │  state    │  │
│  └──────────┘      └──────────┘      └──────────┘   └───────────┘  │
│                                                                     │
│  Expected:          If SIGINT        Last resort     Always runs   │
│  Python handles     ignored or       for hung        to preserve   │
│  KeyboardInterrupt  too slow         native code     progress      │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**Signal Details:**

| Step | Signal | Wait | Expected Response |
|------|--------|------|-------------------|
| 1 | `SIGINT` | 5s | Python raises `KeyboardInterrupt`, cleanup handlers run |
| 2 | `SIGTERM` | 3s | Process terminates, may skip cleanup |
| 3 | `SIGKILL` | 2s | Kernel terminates process immediately |
| 4 | Checkpoint | - | Emergency checkpoint saved regardless of process state |

**Why This Sequence:**
- `SIGINT` allows graceful shutdown (flush buffers, close files, save partial results)
- `SIGTERM` gives the OS a chance to clean up resources
- `SIGKILL` is the nuclear option for truly stuck processes (e.g., native code infinite loops)
- Emergency checkpoint preserves whatever state was achieved

#### Emergency Checkpoint

When the watchdog aborts a stage, it **always** triggers an emergency checkpoint to preserve progress:

```python
# Watchdog triggers emergency checkpoint
checkpoint-manager(
    action="save",
    reportTitle="...",
    runId="...",
    checkpointId="ckpt-emergency-{timestamp}",
    stageId="{current_stage_id}",
    status="emergency",           # Marks this as watchdog-triggered
    reason="timeout",             # Reason: timeout | abort | error
    # Note: artifacts may be incomplete - validation skipped for speed
)
```

**Emergency vs Normal Checkpoints:**

| Aspect | Normal Checkpoint | Emergency Checkpoint |
|--------|-------------------|----------------------|
| Timing | After stage completes | During/after abort |
| Artifacts | Fully validated (SHA256) | Best-effort (may be incomplete) |
| Status | `saved` | `emergency` |
| Resume | Full rehydration | May need manual review |
| Speed | ~1-2s | <500ms (no validation) |

**After Emergency Checkpoint:**
1. Stage marked as `INTERRUPTED` in run state
2. User notified with abort reason and checkpoint location
3. Cycle increments, but stage flagged for review
4. On `/gyoshu continue`, user can choose to:
   - Resume from emergency checkpoint (review artifacts first)
   - Restart stage from previous checkpoint
   - Abort research entirely

**Marker Emitted:**
```
[CHECKPOINT:emergency:id=ckpt-emergency-1704189600:stage=S03_train_model:reason=timeout]
```

## Adaptive Budgets

Gyoshu uses **adaptive budgets** that adjust based on task complexity and runtime progress. There are no fixed defaults - budgets are computed dynamically.

### Budget Computation

1. **Initial Estimation**: Gyoshu analyzes the goal to estimate complexity (L0-L4)
2. **Runtime Adaptation**: Budgets adjust based on:
   - Progress signals (new findings, artifacts, trust scores)
   - Stall detection (no progress → reduce scope)
   - Breakthroughs (high trust + discoveries → extend if beneficial)
3. **Pool + Reserve Model**: 
   - Fast stages "donate" unused time to later stages
   - 15% reserve kept for pivots/recovery
   - Hard caps never exceeded without user approval

### Hard Caps (Non-Negotiable)

| Parameter | Hard Cap | Requires User Approval to Exceed |
|-----------|----------|----------------------------------|
| maxCycles | 25 | Yes |
| maxToolCalls | 300 | Yes |
| maxTimeMinutes | 180 | Yes |

### Adaptation Triggers

| Signal | Response |
|--------|----------|
| Stall (no progress 60s+) | Simplify/split stage, reduce scope |
| Low trust (<60) twice | Reframe stage, after 3 fails → BLOCKED |
| High trust (≥90) + discovery | Small extension (+10-20%) within caps |
| Budget 80%+ consumed | Surface options to user |

## Stopping Conditions

The autonomous loop stops when any of these occur:
- **COMPLETED**: Research goal achieved, findings documented
- **BLOCKED**: Requires user decision, data access, or clarification
- **BUDGET_EXHAUSTED**: Any budget limit reached

## Example Usage

```
/gyoshu-auto analyze the iris dataset and identify clustering patterns
/gyoshu-auto investigate correlation between features X and Y in sales data
/gyoshu-auto reproduce the analysis from paper.pdf and validate findings
```

The planner will autonomously coordinate research execution, handle errors, and produce a final report.
