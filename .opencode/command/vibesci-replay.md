---
description: Replay a VibeSci session for reproducibility
agent: vibesci-planner
---

Replay session: $ARGUMENTS

This will:
1. Start a fresh REPL environment
2. Execute all cells from the session notebook in order
3. Verify outputs match original execution
4. Report any differences (reproducibility check)
