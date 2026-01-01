---
description: "[DEPRECATED] Start a new Gyoshu research"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu <your research goal>`
>
> Example: `/gyoshu analyze wine quality factors`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all research modes:
- `/gyoshu <goal>` - Start interactive research (replaces this command)
- `/gyoshu-auto <goal>` - Autonomous research (unchanged)

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu $ARGUMENTS`

---

## Original Documentation

Start a NEW research for:

$ARGUMENTS

### Discovery Phase (Before Creating)

Before creating new research, **search for similar prior work** to avoid duplication:

1. **Extract keywords** from the research goal above
2. **Search for similar research** using `research-manager(action: "search")`
3. **If results found**, display to user with options to continue or start fresh
4. **If no results**, proceed to New Research Phase

### New Research Phase

If starting fresh:
1. Create a new research with research-manager
2. Add a run to the research
3. Initialize a fresh REPL environment (session)
4. Initialize a new Jupyter notebook for the run
5. Begin executing in PLANNER mode (interactive)

> **Note:** This starts an interactive research where you guide each step. For fully autonomous research, use `/gyoshu-auto` instead.
