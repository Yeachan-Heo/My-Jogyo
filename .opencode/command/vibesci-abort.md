---
description: Gracefully abort current research with state preservation
agent: vibesci-planner
---

Abort the research session: $ARGUMENTS

If no session ID is provided, aborts the currently active session.

## What Abort Does

1. **Stops in-progress operations** - Halts any running REPL execution
2. **Sets goalStatus to ABORTED** - Marks session as intentionally stopped
3. **Generates partial report** - Creates report with work completed so far
4. **Preserves all state** - Notebook, artifacts, and REPL variables are saved

## Resume Later

The aborted session can be resumed later using:

```
/vibesci-continue [session_id]
```

All preserved state will be available when resuming.

## Difference from /vibesci-unlock

- **abort**: Gracefully stop research you want to pause or cancel
- **unlock**: Fix stuck sessions after crashes (forces lock release)

Use abort when you're done for now; use unlock when something went wrong.
