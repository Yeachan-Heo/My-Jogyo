---
description: Direct REPL access for exploratory research
agent: vibesci
---

Explore or investigate in REPL mode:

$ARGUMENTS

## REPL Mode

This is **direct access** to the research agent, bypassing the planner. You have more freedom:

- **Exploratory**: Can investigate tangential questions
- **Interactive**: Propose and run additional experiments on the fly
- **Persistent**: Variables from previous executions are still available
- **Autonomous**: Agent can suggest follow-up analyses

## When to Use

- Quick data exploration (`what columns does df have?`)
- Debugging research code
- Ad-hoc statistical tests
- Exploring intermediate results
- One-off visualizations

## State Preservation

Your REPL environment persists across calls:
- All variables, DataFrames, and models remain in memory
- Import statements carry forward
- Previous computations can be referenced

## Examples

```
/vibesci-repl what does the df DataFrame contain?
/vibesci-repl plot the correlation matrix for numeric columns
/vibesci-repl run a t-test between groups A and B
```
