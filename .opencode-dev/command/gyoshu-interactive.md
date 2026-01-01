---
description: "[DEPRECATED] Start user-guided research with single-cycle control"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu <your research goal>`
>
> Example: `/gyoshu explore correlation between temperature and sales`

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

Start an INTERACTIVE research session for the following goal:

$ARGUMENTS

### PLANNER Mode Behavior

This command runs in **PLANNER mode** - single-cycle, user-guided execution that:
1. Creates or continues a session in interactive mode
2. Executes ONE research cycle: delegate to @jogyo → verify results → report back
3. Returns control to you with findings and options for next steps

### User Control

After each cycle, you will receive:
- **Progress summary**: What was accomplished in this step
- **Key findings**: Data insights, metrics, or discoveries
- **Options for next action**:
  - Continue to the next planned step
  - Adjust the approach based on findings
  - Switch to AUTO mode for remaining steps
  - Generate a report and conclude

### When to Use PLANNER Mode

Choose interactive research when you want:
- **Fine-grained control** over each research step
- **Opportunity to adjust** direction based on intermediate findings
- **Learning experience** to understand the research process
- **Exploratory research** where the path isn't fully determined

### Comparison with AUTO Mode

| Aspect | PLANNER (this command) | AUTO (`/gyoshu-auto`) |
|--------|------------------------|------------------------|
| Cycles | Single, then user input | Multiple, bounded loop |
| Control | User-guided each step | Autonomous until goal/budget |
| Best for | Exploration, learning | Well-defined goals |
| Switching | Can switch to AUTO anytime | Falls back to PLANNER on blocks |

The planner will execute one research cycle and present you with findings and options to continue.
