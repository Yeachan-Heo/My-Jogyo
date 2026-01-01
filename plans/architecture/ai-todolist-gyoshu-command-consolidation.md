# Gyoshu Command Consolidation & Independence Plan

**Goals**: 
1. Simplify 13+ commands down to 2 commands for better UX
2. Make Gyoshu fully independent from oh-my-opencode

**Parent Plan**: `gyoshu-research-system-plan.md`
**Prerequisite**: Phase 2 Discovery complete ✅

---

## Independence Architecture (from Oracle)

### Principle: Platform-Only Independence

Gyoshu depends ONLY on:
- **Core OpenCode tools**: read, write, glob, grep, bash, webfetch (always available)
- **Optional MCP tools**: context7_*, grep_app_searchGitHub (graceful fallback if missing)

Gyoshu does NOT depend on:
- ❌ `@librarian` → Use `@jogyo-insight` instead
- ❌ `@oracle` → Gyoshu has its own planning in `@gyoshu`
- ❌ `@explore` → Use `@jogyo-insight` + local grep/glob
- ❌ `@executor` → Use `@jogyo` for code execution

### Gyoshu's Own Agent Stack

| Agent | Role | Replaces |
|-------|------|----------|
| `@gyoshu` | Planner/orchestrator | (standalone) |
| `@jogyo` | Research executor (Python REPL) | `@executor` for research |
| `@jogyo-feedback` | Past learnings explorer | (unique to Gyoshu) |
| `@jogyo-insight` | External evidence gatherer | `@librarian` |

### Namespacing (Collision Prevention)

All Gyoshu components use prefixes:
- Commands: `/gyoshu`, `/gyoshu-auto`
- Tools: `python-repl`, `notebook-writer`, `session-manager`, `research-manager`, `gyoshu-*`
- Agents: `gyoshu`, `jogyo`, `jogyo-*`
- Storage: `./gyoshu/`

---

## Design Summary (from Oracle)

### Final Command Structure

| Command | Purpose |
|---------|---------|
| `/gyoshu [subcommand\|goal]` | Unified interactive research command |
| `/gyoshu-auto <goal>` | Autonomous research (separate execution model) |

### `/gyoshu` Subcommands

| Subcommand | Maps From | Description |
|------------|-----------|-------------|
| (no args) | NEW | Show status + smart suggestions |
| `<goal>` | `/gyoshu-run` | Start interactive research with goal |
| `plan <goal>` | `/gyoshu-plan` | Create research plan |
| `continue [id]` | `/gyoshu-continue` | Continue existing research |
| `repl <query>` | `/gyoshu-repl` | Direct REPL exploration |
| `list [filters]` | `/gyoshu-list` | List all researches |
| `search <query>` | `/gyoshu-search` | Search researches & notebooks |
| `report [id]` | `/gyoshu-report` | Generate report |
| `replay <sid>` | `/gyoshu-replay` | Replay for reproducibility |
| `unlock <sid>` | `/gyoshu-unlock` | Unlock stuck session |
| `migrate [opts]` | `/gyoshu-migrate` | Migrate legacy sessions |
| `abort [sid]` | `/gyoshu-abort` | Abort current research |
| `help` | NEW | Show usage and examples |

### Reserved Subcommands (Case-Sensitive)
```
plan, continue, repl, list, search, report, replay, unlock, migrate, abort, help
```

If first token doesn't match a reserved subcommand → treat entire argument as `<goal>`.

---

## Phase 1: Create Unified Command (Non-Breaking)

- [x] 1. Create `.opencode/command/gyoshu.md`
   - Dispatcher logic: parse first token, route to appropriate workflow
   - Reserved subcommands list
   - Fallback: treat as goal → start interactive research
   - Include all workflow documentation inline
   - **Parallelizable**: NO (foundation)

- [x] 2. Implement status display (no args)
   - Call `research-manager(action: "list")` to find active research
   - If one active: show compact summary + suggest continue
   - If multiple: show numbered table + ask user to pick
   - If none: suggest `/gyoshu <goal>` or `/gyoshu list`
   - **Parallelizable**: NO (part of Task 1)

- [x] 3. Implement subcommand routing
   - `plan <goal>` → planning workflow
   - `continue [id]` → continuation workflow with context display
   - `repl <query>` → direct REPL mode
   - `list [filters]` → list with optional filters
   - `search <query>` → search across researches/notebooks
   - `report [id]` → report generation
   - `replay <sid>` → replay workflow
   - `unlock <sid>` → unlock workflow
   - `migrate [opts]` → migration workflow
   - `abort [sid]` → abort workflow
   - `help` → usage display
   - **Parallelizable**: NO (part of Task 1)

- [x] 4. Implement goal detection (non-subcommand)
   - If first token not in reserved list → treat as goal
   - Run discovery workflow (search for similar research)
   - Ask: continue existing or start fresh
   - Start interactive research
   - **Parallelizable**: NO (part of Task 1)

- [x] 5. Update `/gyoshu-auto` to be the only autonomous entry
   - Verify it works standalone
   - Update documentation to clarify it's for autonomous mode
   - **Parallelizable**: YES (independent)

---

## Phase 2: Deprecate Old Commands

- [x] 6. Create deprecation wrapper template
   - Show warning: `⚠️ Deprecated: use /gyoshu <subcommand> instead`
   - Forward to new unified command
   - **Parallelizable**: NO (template first)

- [x] 7. Wrap old commands with deprecation
   - `/gyoshu-run` → forwards to `/gyoshu` (goal mode)
   - `/gyoshu-plan` → forwards to `/gyoshu plan`
   - `/gyoshu-continue` → forwards to `/gyoshu continue`
   - `/gyoshu-repl` → forwards to `/gyoshu repl`
   - `/gyoshu-list` → forwards to `/gyoshu list`
   - `/gyoshu-search` → forwards to `/gyoshu search`
   - `/gyoshu-report` → forwards to `/gyoshu report`
   - `/gyoshu-replay` → forwards to `/gyoshu replay`
   - `/gyoshu-unlock` → forwards to `/gyoshu unlock`
   - `/gyoshu-migrate` → forwards to `/gyoshu migrate`
   - `/gyoshu-abort` → forwards to `/gyoshu abort`
   - `/gyoshu-interactive` → forwards to `/gyoshu` (default mode)
   - **Parallelizable**: YES (after Task 6)

---

## Phase 3: Documentation & Cleanup

- [x] 8. Update AGENTS.md
   - Remove old command list
   - Document new `/gyoshu` unified command
   - Document `/gyoshu-auto` as separate
   - Add migration guide from old commands
   - **Parallelizable**: YES (anytime after Phase 1)

- [x] 9. Update README.md ✅
   - Simplify Quick Start with new commands
   - Update Commands table
   - **Parallelizable**: YES (with Task 8)

- [x] 10. Update gyoshu.md agent documentation ✅
   - Remove references to old commands
   - Document unified command workflow
   - **Parallelizable**: YES (with Task 8)

---

## Acceptance Criteria

### Command Consolidation
1. [ ] `/gyoshu` (no args) shows status and suggestions
2. [ ] `/gyoshu <goal>` starts interactive research with discovery
3. [ ] All subcommands work correctly
4. [ ] Old commands show deprecation warning but still work
5. [ ] `/gyoshu-auto` remains the only autonomous entry
6. [ ] User can accomplish all tasks with just `/gyoshu` and `/gyoshu-auto`

### Independence
7. [ ] No references to @librarian, @oracle, @explore, @executor
8. [ ] jogyo-insight works without MCP tools (graceful fallback)
9. [ ] Gyoshu works standalone (without oh-my-opencode)
10. [ ] Independence documented in README or INDEPENDENCE.md

---

## UX Examples

### Example 1: No Args (Status)
```
> /gyoshu

🔬 Gyoshu Research

📊 Current Project Status:
| # | Research | Status | Runs | Last Updated |
|---|----------|--------|------|--------------|
| 1 | iris-clustering | active | 2 | 2024-01-15 |
| 2 | churn-analysis | completed | 5 | 2024-01-10 |

💡 Suggestions:
- Continue #1: `/gyoshu continue iris-clustering`
- Start new: `/gyoshu <your research goal>`
- Search: `/gyoshu search <query>`
```

### Example 2: Goal Provided
```
> /gyoshu analyze wine quality factors

🔍 Searching for similar research...

Found 1 similar research:
- "Wine Dataset Analysis" (completed, 3 runs)

Options:
1. Continue existing: `/gyoshu continue wine-dataset-analysis`
2. Start fresh: I'll create new research now

What would you like to do?
```

### Example 3: Subcommand
```
> /gyoshu list --status active

📋 Active Researches:
| Research | Title | Runs | Last Updated |
|----------|-------|------|--------------|
| iris-clustering | Iris Species Analysis | 2 | 2024-01-15 |
```

### Example 4: Help
```
> /gyoshu help

🔬 Gyoshu - Scientific Research Assistant

Usage:
  /gyoshu                     Show status and suggestions
  /gyoshu <goal>              Start new research
  /gyoshu plan <goal>         Create research plan only
  /gyoshu continue [id]       Continue existing research
  /gyoshu list [--status X]   List all researches
  /gyoshu search <query>      Search researches & notebooks
  /gyoshu report [id]         Generate research report
  /gyoshu repl <query>        Direct REPL exploration
  /gyoshu migrate [--dry-run] Migrate legacy sessions
  /gyoshu replay <sessionId>  Replay for reproducibility
  /gyoshu unlock <sessionId>  Unlock stuck session
  /gyoshu abort               Abort current research

For autonomous research:
  /gyoshu-auto <goal>         Hands-off bounded execution
```

---

## Edge Cases & Gotchas

1. **Ambiguous goals**: If goal starts with reserved word (e.g., "list the findings")
   - Solution: Match reserved words exactly as first token only
   - User can quote: `/gyoshu "list the key findings from..."`

2. **ID confusion**: `researchId` vs `sessionId`
   - Accept both in `continue/report`
   - Detect by format (`ses_...` = sessionId, else = researchId)

3. **Multiple active sessions**
   - Don't auto-select, ask user to pick
   - Show numbered table for easy selection

4. **State detection**
   - Don't auto-unlock or auto-migrate
   - Only detect and suggest actions

---

## Files to Create

1. `.opencode/command/gyoshu.md` - Unified command

## Files to Modify

1. `.opencode/command/gyoshu-run.md` - Deprecation wrapper
2. `.opencode/command/gyoshu-plan.md` - Deprecation wrapper
3. `.opencode/command/gyoshu-continue.md` - Deprecation wrapper
4. `.opencode/command/gyoshu-repl.md` - Deprecation wrapper
5. `.opencode/command/gyoshu-list.md` - Deprecation wrapper
6. `.opencode/command/gyoshu-search.md` - Deprecation wrapper
7. `.opencode/command/gyoshu-report.md` - Deprecation wrapper
8. `.opencode/command/gyoshu-replay.md` - Deprecation wrapper
9. `.opencode/command/gyoshu-unlock.md` - Deprecation wrapper
10. `.opencode/command/gyoshu-migrate.md` - Deprecation wrapper
11. `.opencode/command/gyoshu-abort.md` - Deprecation wrapper
12. `.opencode/command/gyoshu-interactive.md` - Deprecation wrapper
13. `.opencode/command/gyoshu-auto.md` - Keep as-is (verify)
14. `.opencode/agent/gyoshu.md` - Update references
15. `AGENTS.md` - Update command docs
16. `README.md` - Update command docs

---

## Estimated Effort

| Phase | Tasks | Effort |
|-------|-------|--------|
| Phase 1: Create Unified Command | 1-5 | 3-4h |
| Phase 2: Deprecate Old Commands | 6-7 | 1-2h |
| Phase 3: Documentation | 8-10 | 1h |
| Phase 4: Independence Hardening | 11-14 | 2-3h |

**Total**: ~8-10 hours

---

## Phase 4: Notebook Execution Capture (Critical UX Fix)

**Problem:** Executed code is NOT being captured in notebooks. Users expect notebooks to contain all executed code + outputs (like VibeQuant's agent_report.md + raw_report.md).

**Current Flow (Broken):**
```
python-repl(code) → returns output → [LOST - not written to notebook]
```

**Expected Flow:**
```
python-repl(code) → returns output → notebook-writer(code + output) → notebook.ipynb
```

- [x] 11. Create auto-capture mechanism for code execution
   - Option A: Modify python-repl to accept notebookPath and auto-append cells
   - Option B: Create wrapper that calls python-repl then notebook-writer
   - Option C: Update jogyo agent instructions to ALWAYS call notebook-writer after python-repl
   - Recommend Option A (cleanest integration)
   - **Parallelizable**: NO (critical path)

- [x] 11.5. **[NEW]** Per-project Python environment isolation
   - Gyoshu MUST use dedicated venv per project, NEVER global Python
   - Auto-detect existing venv: `./venv`, `./.venv`, `./gyoshu/venv`
   - Auto-create venv if none exists: `./gyoshu/venv`
   - Store venv path in session/research manifest
   - python-repl must use project venv's Python interpreter
   - Install research dependencies (pandas, numpy, scikit-learn, matplotlib) on first use
   - **Parallelizable**: NO (critical for Task 12)

- [ ] 12. Update jogyo agent to capture all code
   - Every python-repl call should result in a notebook cell
   - Capture: code source, stdout, stderr, plots, errors
   - Format outputs properly (stream, execute_result, display_data, error)
   - **Parallelizable**: NO (depends on Task 11)

- [ ] 13. Add markdown report generation (like VibeQuant)
   - Generate `report.md` - Executive summary with findings
   - Extract from structured markers: [FINDING], [CONCLUSION], [METRIC], etc.
   - Store in `./gyoshu/research/{researchId}/artifacts/{runId}/`
   - **Parallelizable**: YES (after Task 12)

---

## Phase 5: Independence Hardening

- [ ] 14. Add MCP tool fallbacks to jogyo-insight
   - Check if context7_* available, fallback to webfetch
   - Check if grep_app_searchGitHub available, fallback to local grep
   - Document graceful degradation behavior
   - **Parallelizable**: NO (foundation)

- [ ] 15. Remove any oh-my-opencode references
   - Audit all agent files for @librarian, @oracle, @explore, @executor references
   - Replace with Gyoshu equivalents
   - Update documentation
   - **Parallelizable**: YES (after Task 14)

- [ ] 16. Add independence contract documentation
   - Create `INDEPENDENCE.md` or add to README
   - Document: what Gyoshu depends on, what it doesn't
   - Document: MCP tools are optional enhancements
   - **Parallelizable**: YES (with Task 15)

- [ ] 17. Test standalone operation
   - Test without oh-my-opencode installed
   - Test without MCP tools configured
   - Verify graceful fallbacks work
   - **Parallelizable**: YES (after Tasks 14-16)

---

## Phase 6: Future Cleanup (Breaking - Later)

After sufficient adoption (weeks/months):
- [ ] Delete deprecated command files
- [ ] Remove deprecation warnings
- [ ] Clean up any remaining references
