---
description: "[DEPRECATED] Generate comprehensive research report"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu report [id]`
>
> Example: `/gyoshu report $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu report $ARGUMENTS`

---

## Original Documentation

Generate a comprehensive research report for the current session.

Additional focus areas (if specified): $ARGUMENTS

The report should include:
1. Executive summary
2. Methodology
3. Key findings with evidence
4. Visualizations
5. Conclusions
6. Limitations
7. Recommended next steps

> **Note:** If the session was signaled complete (`gyoshu_completion`), the report will highlight key results (`keyResults`) and reference generated artifacts (`artifactPaths`).
