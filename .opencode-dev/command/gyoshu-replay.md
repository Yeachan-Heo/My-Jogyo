---
description: "[DEPRECATED] Replay a Gyoshu session for reproducibility"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu replay <sessionId>`
>
> Example: `/gyoshu replay $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu replay $ARGUMENTS`

---

## Original Documentation

Replay session: $ARGUMENTS

This will:
1. Start a fresh REPL environment
2. Execute all cells from the session notebook in order
3. Verify outputs match original execution
4. Report any differences (reproducibility check)
