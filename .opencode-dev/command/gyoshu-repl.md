---
description: "[DEPRECATED] Direct REPL access for exploratory research"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu repl <query>`
>
> Example: `/gyoshu repl $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu repl $ARGUMENTS`

---

## Original Documentation

Explore or investigate in REPL mode:

$ARGUMENTS

### REPL Mode

This is **direct access** to the research agent, bypassing the planner. You have more freedom:

- **Exploratory**: Can investigate tangential questions
- **Interactive**: Propose and run additional experiments on the fly
- **Persistent**: Variables from previous executions are still available
- **Autonomous**: Agent can suggest follow-up analyses

### When to Use

- Quick data exploration (`what columns does df have?`)
- Debugging research code
- Ad-hoc statistical tests
- Exploring intermediate results
- One-off visualizations

### State Preservation

Your REPL environment persists across calls:
- All variables, DataFrames, and models remain in memory
- Import statements carry forward
- Previous computations can be referenced

### Examples

```
/gyoshu repl what does the df DataFrame contain?
/gyoshu repl plot the correlation matrix for numeric columns
/gyoshu repl run a t-test between groups A and B
```
