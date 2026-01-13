---
description: Unified Gyoshu research command - start, continue, search, and manage research
agent: gyoshu
---

# /gyoshu - Unified Research Command

$ARGUMENTS

---

## Command Routing

Parse first token and route:

| First Token | Action |
|-------------|--------|
| (empty) | Show status |
| `help` | Show help |
| `doctor` | System health check |
| `plan <goal>` | Create plan only |
| `continue [id]` | Resume research |
| `repl <query>` | Direct REPL |
| `list` | List projects |
| `search <query>` | Search notebooks |
| `report [id]` | Generate report |
| `migrate` | Migrate data |
| `unlock <id>` | Unlock session |
| `abort` | Abort research |
| `<goal>` | Start new research |

## Status Display (no args)

Check for active research and show suggestions:

```
research-manager(action="list", status="active")
```

Output format:
```
GYOSHU STATUS

Active Research: [title] (status)
Last Activity: [time]

Suggestions:
- /gyoshu continue - Resume active research
- /gyoshu <goal> - Start new research
```

## Help

Show command reference:
```
/gyoshu                    Show status
/gyoshu <goal>             Start research
/gyoshu plan <goal>        Create plan only
/gyoshu continue [id]      Resume research
/gyoshu list               List projects
/gyoshu search <query>     Search notebooks
/gyoshu report [id]        Generate report
/gyoshu doctor             Check health
```

## Doctor

Run diagnostics:
1. Check Python environment (.venv)
2. Check runtime directory
3. List active sessions
4. Report any issues

## Start Research

When user provides a goal:

1. Search for similar prior research:
   ```
   research-manager(action="search", query="<goal keywords>")
   ```

2. Create research session:
   ```
   research-manager(action="create", title="<title>", goal="<goal>")
   ```

3. Delegate to @jogyo via Task tool

4. Verify results with @baksa

5. On completion, generate report

## Continue Research

Resume existing research:
```
research-manager(action="get", reportTitle="<id>")
gyoshu-snapshot(researchSessionID="<sessionId>")
```

Then continue from last checkpoint.

## List/Search

List: `research-manager(action="list")`
Search: `research-manager(action="search", query="<query>")`

## Report

Generate report for completed research:
```
research-manager(action="report", reportTitle="<id>")
```

See AGENTS.md for complete workflow documentation.
