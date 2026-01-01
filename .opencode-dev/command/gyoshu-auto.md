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
2. Runs a bounded loop: delegate to @jogyo → verify progress → check completion
3. Continues until goal is COMPLETED, BLOCKED (needs user input), or budget exhausted

## Default Budgets

| Parameter | Default | Description |
|-----------|---------|-------------|
| maxCycles | 10 | Maximum delegation cycles to @jogyo |
| maxToolCalls | 100 | Maximum tool invocations across all cycles |
| maxTimeMinutes | 60 | Maximum wall-clock time for the session |

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
