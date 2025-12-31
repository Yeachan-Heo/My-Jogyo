# VibeSci → Gyoshu Rebrand Plan

**Goal**: Surgically rebrand VibeSci to Gyoshu with Korean-themed naming
**Created**: 2024-12-31
**Estimated Tasks**: 35 checkboxes
**Estimated Time**: 2-3 hours

## Naming Convention

| Current | New | Korean | Role |
|---------|-----|--------|------|
| `vibesci-planner` | `gyoshu` | 교수 (Professor) | Primary orchestrator agent |
| `vibesci` | `jogyo` | 조교 (Assistant) | Research executor subagent |
| `VibeSci` | `Gyoshu` | - | Product/repository name |

## Pre-Flight Checklist

- [ ] 1. Verify clean git state and create safety branch
  - **Command**: `git status && git checkout -b rebrand/vibesci-to-gyoshu`
  - **Parallelizable**: NO (must be first)
  - **Acceptance**: Branch created, working tree clean

- [ ] 2. Run existing tests to establish baseline
  - **Command**: `pytest -v && bun test`
  - **Parallelizable**: NO (depends on Task 1)
  - **Acceptance**: All tests pass before changes

---

## Phase 1: File Renames (Atomic Operations)

### 1.1 Agent Files

- [ ] 3. Rename vibesci-planner.md → gyoshu.md (primary agent)
  - **Command**: `git mv .opencode/agent/vibesci-planner.md .opencode/agent/gyoshu.md`
  - **Parallelizable**: YES (with Tasks 4-6)
  - **Acceptance**: File exists at new path

- [ ] 4. Rename vibesci.md → jogyo.md (subagent)
  - **Command**: `git mv .opencode/agent/vibesci.md .opencode/agent/jogyo.md`
  - **Parallelizable**: YES (with Tasks 3, 5-6)
  - **Acceptance**: File exists at new path

- [ ] 5. Rename vibesci-feedback.md → jogyo-feedback.md
  - **Command**: `git mv .opencode/agent/vibesci-feedback.md .opencode/agent/jogyo-feedback.md`
  - **Parallelizable**: YES (with Tasks 3-4, 6)
  - **Acceptance**: File exists at new path

- [ ] 6. Rename vibesci-insight.md → jogyo-insight.md
  - **Command**: `git mv .opencode/agent/vibesci-insight.md .opencode/agent/jogyo-insight.md`
  - **Parallelizable**: YES (with Tasks 3-5)
  - **Acceptance**: File exists at new path

### 1.2 Command Files

- [ ] 7. Rename all vibesci-*.md command files to gyoshu-*.md
  - **Commands**:
    ```bash
    git mv .opencode/command/vibesci-plan.md .opencode/command/gyoshu-plan.md
    git mv .opencode/command/vibesci-run.md .opencode/command/gyoshu-run.md
    git mv .opencode/command/vibesci-continue.md .opencode/command/gyoshu-continue.md
    git mv .opencode/command/vibesci-report.md .opencode/command/gyoshu-report.md
    git mv .opencode/command/vibesci-replay.md .opencode/command/gyoshu-replay.md
    git mv .opencode/command/vibesci-unlock.md .opencode/command/gyoshu-unlock.md
    git mv .opencode/command/vibesci-auto.md .opencode/command/gyoshu-auto.md
    git mv .opencode/command/vibesci-interactive.md .opencode/command/gyoshu-interactive.md
    git mv .opencode/command/vibesci-repl.md .opencode/command/gyoshu-repl.md
    git mv .opencode/command/vibesci-abort.md .opencode/command/gyoshu-abort.md
    ```
  - **Parallelizable**: YES (with Tasks 3-6, 8-10)
  - **Acceptance**: 10 command files renamed, `ls .opencode/command/` shows gyoshu-* files

### 1.3 Tool Files

- [ ] 8. Rename vibesci-completion.ts → gyoshu-completion.ts
  - **Command**: `git mv .opencode/tool/vibesci-completion.ts .opencode/tool/gyoshu-completion.ts`
  - **Parallelizable**: YES (with Tasks 3-7, 9-10)
  - **Acceptance**: File exists at new path

- [ ] 9. Rename vibesci-snapshot.ts → gyoshu-snapshot.ts
  - **Command**: `git mv .opencode/tool/vibesci-snapshot.ts .opencode/tool/gyoshu-snapshot.ts`
  - **Parallelizable**: YES (with Tasks 3-8, 10)
  - **Acceptance**: File exists at new path

### 1.4 Bridge File

- [ ] 10. Rename vibesci_bridge.py → gyoshu_bridge.py
  - **Command**: `git mv .opencode/bridge/vibesci_bridge.py .opencode/bridge/gyoshu_bridge.py`
  - **Parallelizable**: YES (with Tasks 3-9)
  - **Acceptance**: File exists at new path

### 1.5 Directory Rename

- [ ] 11. Rename plans/vibesci/ → plans/gyoshu/
  - **Command**: `git mv plans/vibesci plans/gyoshu`
  - **Parallelizable**: YES (with Tasks 3-10)
  - **Acceptance**: Directory exists at new path with contents

---

## Phase 2: Content Updates - Core Source Files

### 2.1 Agent Definition Updates

- [ ] 12. Update gyoshu.md (formerly vibesci-planner.md) content
  - **Changes**:
    - Title: "VibeSci Planner Agent" → "Gyoshu Research Planner"
    - Tool references: `vibesci-completion` → `gyoshu-completion`, `vibesci-snapshot` → `gyoshu-snapshot`
    - Delegation: `@vibesci` → `@jogyo`, `@vibesci-feedback` → `@jogyo-feedback`, `@vibesci-insight` → `@jogyo-insight`
    - Commands: `/vibesci-*` → `/gyoshu-*`
    - Paths: `~/.vibesci/` → `~/.gyoshu/`, `.vibesci/` → `.gyoshu/`
  - **Parallelizable**: YES (with Tasks 13-15)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 13. Update jogyo.md (formerly vibesci.md) content
  - **Changes**:
    - Title: "VibeSci Research Agent" → "Jogyo Research Agent"
    - Tool references: `vibesci-completion` → `gyoshu-completion`, `vibesci_completion` → `gyoshu_completion`
    - Paths: `~/.vibesci/` → `~/.gyoshu/`
    - Description: Update Korean meaning in header comment
  - **Parallelizable**: YES (with Tasks 12, 14-15)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 14. Update jogyo-feedback.md content
  - **Changes**:
    - All `vibesci` → `jogyo` or `gyoshu` as appropriate
    - Path references: `.vibesci/retrospectives/` → `.gyoshu/retrospectives/`
  - **Parallelizable**: YES (with Tasks 12-13, 15)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 15. Update jogyo-insight.md content
  - **Changes**: Similar to Task 14
  - **Parallelizable**: YES (with Tasks 12-14)
  - **Acceptance**: No "vibesci" references remain in file

### 2.2 Command File Updates

- [ ] 16. Update all 10 gyoshu-*.md command files
  - **Pattern replacements in each file**:
    - `/vibesci-*` → `/gyoshu-*` (command names)
    - `vibesci-planner` → `gyoshu` (agent references)
    - `@vibesci` → `@jogyo` (subagent delegation)
    - `~/.vibesci/` → `~/.gyoshu/` (paths)
  - **Parallelizable**: YES (with Tasks 12-15, 17-20)
  - **Acceptance**: `grep -r "vibesci" .opencode/command/` returns empty

### 2.3 Tool File Updates

- [ ] 17. Update gyoshu-completion.ts content
  - **Changes**:
    - JSDoc: "VibeSci" → "Gyoshu"
    - Tool name registration (if any)
    - Path constants: `~/.vibesci/` → `~/.gyoshu/`
    - Any `vibesci` string literals
  - **Parallelizable**: YES (with Tasks 12-16, 18-20)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 18. Update gyoshu-snapshot.ts content
  - **Changes**: Similar to Task 17
  - **Parallelizable**: YES (with Tasks 12-17, 19-20)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 19. Update session-manager.ts
  - **Changes**:
    - JSDoc: "VibeSci" → "Gyoshu"
    - `SESSIONS_DIR` constant: `.vibesci` → `.gyoshu`
    - Any comments/strings referencing VibeSci
  - **Parallelizable**: YES (with Tasks 12-18, 20)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 20. Update other tool files (notebook-writer.ts, python-repl.ts, retrospective-store.ts)
  - **Changes**:
    - Cell ID prefix: `vibesci-` → `gyoshu-` (in cell-identity.ts or notebook-writer.ts)
    - JSDoc comments
    - Path constants
  - **Parallelizable**: YES (with Tasks 12-19)
  - **Acceptance**: `grep -r "vibesci" .opencode/tool/` returns empty

### 2.4 Library File Updates

- [ ] 21. Update .opencode/lib/*.ts files
  - **Files**: cell-identity.ts, session-lock.ts, others
  - **Changes**:
    - Cell ID prefix: `vibesci-` → `gyoshu-`
    - Any path references
  - **Parallelizable**: YES (with Tasks 12-20, 22)
  - **Acceptance**: `grep -r "vibesci" .opencode/lib/` returns empty

### 2.5 Bridge File Update

- [ ] 22. Update gyoshu_bridge.py content
  - **Changes**:
    - Module docstring: "VibeSci" → "Gyoshu"
    - `__name__` default: `__vibesci__` → `__gyoshu__`
    - Any comments referencing VibeSci
  - **Parallelizable**: YES (with Tasks 12-21)
  - **Acceptance**: No "vibesci" references remain in file

---

## Phase 3: Configuration File Updates

- [ ] 23. Update package.json
  - **Changes**:
    ```json
    "name": "vibesci" → "name": "gyoshu"
    "description": "... VibeSci ..." → "... Gyoshu ..."
    ```
  - **Parallelizable**: YES (with Tasks 24-25)
  - **Acceptance**: `jq .name package.json` returns "gyoshu"

- [ ] 24. Update pyproject.toml
  - **Changes**:
    ```toml
    name = "vibesci" → name = "gyoshu"
    ```
  - **Parallelizable**: YES (with Tasks 23, 25)
  - **Acceptance**: `grep "^name" pyproject.toml` shows "gyoshu"

- [ ] 25. Update install.sh
  - **Changes**:
    - Echo messages: "VibeSci" → "Gyoshu"
    - Paths: `~/.vibesci/` → `~/.gyoshu/`
    - Commands: `/vibesci-*` → `/gyoshu-*`
    - GitHub URL if hardcoded
  - **Parallelizable**: YES (with Tasks 23-24)
  - **Acceptance**: No "vibesci" references remain in file

---

## Phase 4: Test File Updates

- [ ] 26. Update tests/test_bridge.py
  - **Changes**:
    - Import: `from vibesci_bridge import` → `from gyoshu_bridge import`
    - Module references: `vibesci_bridge` → `gyoshu_bridge`
    - Namespace assertion: `__vibesci__` → `__gyoshu__`
    - Docstrings
  - **Parallelizable**: YES (with Tasks 27-29)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 27. Update tests/integration.test.ts
  - **Changes**:
    - Bridge path: `vibesci_bridge.py` → `gyoshu_bridge.py`
    - Error message assertions containing "vibesci"
  - **Parallelizable**: YES (with Tasks 26, 28-29)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 28. Update tests/cell-identity.test.ts
  - **Changes**:
    - Regex patterns: `/^vibesci-[a-f0-9]{8}$/` → `/^gyoshu-[a-f0-9]{8}$/`
    - All 9 occurrences of the pattern
  - **Parallelizable**: YES (with Tasks 26-27, 29)
  - **Acceptance**: No "vibesci" references remain in file

- [ ] 29. Update tests/atomic-write.test.ts and tests/session-lock.test.ts
  - **Changes**:
    - Temp directory prefixes: `vibesci-atomic-write-test-` → `gyoshu-atomic-write-test-`
    - `vibesci-session-lock-test-` → `gyoshu-session-lock-test-`
  - **Parallelizable**: YES (with Tasks 26-28)
  - **Acceptance**: No "vibesci" references remain in files

---

## Phase 5: Documentation Updates

- [ ] 30. Update README.md
  - **Changes**:
    - Title: `# VibeSci` → `# Gyoshu`
    - All command examples: `/vibesci-*` → `/gyoshu-*`
    - Agent references: `@vibesci` → `@jogyo`, `vibesci-planner` → `gyoshu`
    - Paths: `~/.vibesci/` → `~/.gyoshu/`
    - GitHub URLs (if repo is renamed)
    - Architecture diagram file paths
    - Product description
  - **Parallelizable**: YES (with Task 31)
  - **Acceptance**: No "vibesci" or "VibeSci" references remain

- [ ] 31. Update AGENTS.md
  - **Changes**:
    - Title: "VibeSci Repository Guide" → "Gyoshu Repository Guide"
    - All import examples: `from vibesci_bridge import` → `from gyoshu_bridge import`
    - Path references
    - File path table
    - Project structure diagram
  - **Parallelizable**: YES (with Task 30)
  - **Acceptance**: No "vibesci" or "VibeSci" references remain

---

## Phase 6: Verification & Cleanup

- [ ] 32. Run comprehensive grep to find any remaining references
  - **Command**: `grep -ri "vibesci" --include="*.ts" --include="*.py" --include="*.md" --include="*.json" --include="*.toml" --include="*.sh" . | grep -v node_modules | grep -v .venv | grep -v plans/gyoshu/ai-todolist`
  - **Parallelizable**: NO (depends on all previous tasks)
  - **Acceptance**: No matches found (except this plan file and historical plans)

- [ ] 33. Regenerate bun.lock
  - **Command**: `rm bun.lock && bun install`
  - **Parallelizable**: NO (depends on Task 23)
  - **Acceptance**: New bun.lock generated with "gyoshu" name

- [ ] 34. Run full test suite
  - **Command**: `pytest -v && bun test`
  - **Parallelizable**: NO (depends on all file changes)
  - **Acceptance**: All tests pass

- [ ] 35. Create summary commit
  - **Command**: `git add -A && git commit -m "refactor: rebrand VibeSci to Gyoshu (교수/Professor)"`
  - **Parallelizable**: NO (must be last)
  - **Acceptance**: Clean commit with all changes

---

## Post-Rebrand Tasks (Optional)

These are NOT part of the core rebrand but may be desired:

- [ ] Rename GitHub repository from VibeSci to Gyoshu
- [ ] Update any external documentation or links
- [ ] Create migration script for existing `~/.vibesci/` directories
- [ ] Update any CI/CD configurations
- [ ] Announce rebrand to users

---

## Parallelization Summary

| Phase | Parallelizable Groups |
|-------|----------------------|
| Pre-Flight | Sequential (Tasks 1-2) |
| Phase 1 | All file renames in parallel (Tasks 3-11) |
| Phase 2 | All content updates in parallel (Tasks 12-22) |
| Phase 3 | All config updates in parallel (Tasks 23-25) |
| Phase 4 | All test updates in parallel (Tasks 26-29) |
| Phase 5 | Doc updates in parallel (Tasks 30-31) |
| Phase 6 | Sequential verification (Tasks 32-35) |

---

## Risk Mitigation

1. **Git branch isolation**: All work on dedicated branch
2. **Test baseline**: Verify tests pass before changes
3. **Incremental verification**: Can run tests after each phase
4. **Easy rollback**: `git checkout main` reverts everything
5. **Grep verification**: Final check catches any missed references

---

## Execution Notes

- **CRITICAL**: Perform file renames BEFORE content updates to avoid broken references during transition
- **ORDER MATTERS**: Pattern replacements must follow the priority order in Phase 2 (longer patterns first)
- **TEST FREQUENTLY**: Run `bun test` after Phase 2, Phase 4 to catch issues early
- **PYTHON PATH**: After renaming bridge, update conftest.py path if needed
