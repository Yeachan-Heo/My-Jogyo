---
description: "[DEPRECATED] Gracefully abort current research with state preservation"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu abort [sessionId]`
>
> Example: `/gyoshu abort $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu abort $ARGUMENTS`

---

## Original Documentation

Abort the research session: $ARGUMENTS

If no session ID is provided, aborts the currently active session.

### What Abort Does

1. **Stops in-progress operations** - Halts any running REPL execution
2. **Sets goalStatus to ABORTED** - Marks session as intentionally stopped
3. **Generates partial report** - Creates report with work completed so far
4. **Preserves all state** - Notebook, artifacts, and REPL variables are saved

### Resume Later

The aborted session can be resumed later using:

```
/gyoshu continue [session_id]
```

All preserved state will be available when resuming.

### Difference from unlock

- **abort**: Gracefully stop research you want to pause or cancel
- **unlock**: Fix stuck sessions after crashes (forces lock release)

Use abort when you're done for now; use unlock when something went wrong.
