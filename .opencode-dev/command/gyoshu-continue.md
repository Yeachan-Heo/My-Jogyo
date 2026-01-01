---
description: "[DEPRECATED] Continue existing Gyoshu research (preserves REPL state)"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu continue [id]`
>
> Example: `/gyoshu continue $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu continue $ARGUMENTS`

---

## Original Documentation

Continue the current research and active run with:

$ARGUMENTS

### Overview

This command continues an existing research project, displaying rich context from prior work to help you pick up where you left off.

### Context Display

When continuing research, the agent will display:

- **Research Context**: Title, ID, status, dates, goal
- **Previous Runs Summary**: Table with run details and status counts
- **Key Findings**: Up to 5 findings from recent runs with marker prefixes
- **Available Artifacts**: Table with artifact paths, types, run source
- **REPL State Hint**: Variable availability, mode, cell replay note

### Notes

- This command can also resume ABORTED runs (goalStatus: ABORTED)
- The run mode (PLANNER, AUTO, REPL) is preserved from when it was paused or aborted
- Use `/gyoshu` to start completely fresh research
- Use `/gyoshu search` to find specific content in prior research
