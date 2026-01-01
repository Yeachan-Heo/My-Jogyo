---
description: "[DEPRECATED] Manually unlock a stuck Gyoshu session"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu unlock <sessionId>`
>
> Example: `/gyoshu unlock $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu unlock $ARGUMENTS`

---

## Original Documentation

Unlock session: $ARGUMENTS

WARNING: Only use this if a session is stuck due to a crash.
If a process is still running, this may cause data corruption.

Use --force to override safety checks.
