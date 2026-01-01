# Gyoshu Research System - Phase 2: Discovery & Migration

**Goal**: Enable discovery of prior research and migrate legacy sessions

**Parent Plan**: `gyoshu-research-system-plan.md`
**Prerequisite**: Phase 1 MVP complete ✅

**Currently in progress**: None

---

## Phase 2A: Migration Tool (Deferred from Phase 1)

- [x] 1. Create migration-tool.ts
  - File: `.opencode/tool/migration-tool.ts`
  - Actions: scan, migrate, verify
  - Scan old `~/.gyoshu/sessions/` for legacy sessions
  - Create research for each session
  - Move notebooks and artifacts to `./gyoshu/research/{researchId}/`
  - **Never auto-delete old sessions**
  - Support dry-run mode
  - **Parallelizable**: NO (foundation)

- [x] 2. Create /gyoshu-migrate command
  - File: `.opencode/command/gyoshu-migrate.md`
  - Invoke migration-tool
  - Show scan results before migration
  - Display progress and results
  - **Parallelizable**: YES (with Task 1, after Task 1 complete)

---

## Phase 2B: Research Discovery

- [x] 3. Add search action to research-manager
  - Add `action: "search"` to research-manager.ts
  - Search by: title, goal, tags, status
  - Return ranked results with snippets
  - Simple keyword matching (no separate index)
  - **Parallelizable**: NO (core feature)

- [x] 4. Create notebook-search.ts tool
  - File: `.opencode/tool/notebook-search.ts`
  - Full-text search within notebooks
  - Search code cells, markdown cells, outputs
  - Scope to specific research or global
  - Return: notebookPath, cellId, snippet, score
  - **Parallelizable**: YES (with Task 3)

- [x] 5. Update gyoshu.md to use discovery
  - Before starting new research, search for similar prior work
  - Display relevant prior research to user
  - Option to continue existing or start fresh
  - **Parallelizable**: NO (depends on Tasks 3-4)

---

## Phase 2C: Enhanced Commands

- [x] 6. Update /gyoshu-run to show prior research
  - Before creating new research, search for similar goals
  - Display: "Found N similar researches: ..."
  - Offer: "Continue existing?" or "Start new?"
  - **Parallelizable**: NO (depends on Task 5)

- [x] 7. Update /gyoshu-continue with discovery
  - Show what's available from prior runs
  - Display: key findings, available variables, artifacts
  - Load context from research manifest
  - **Parallelizable**: YES (with Task 6)

- [x] 8. Create /gyoshu-list command
  - File: `.opencode/command/gyoshu-list.md`
  - List all researches in project
  - Filter by: status, tags, date range
  - Display: title, goal, status, last updated
  - **Parallelizable**: YES (anytime)

- [x] 9. Create /gyoshu-search command
  - File: `.opencode/command/gyoshu-search.md`
  - Search across researches and notebooks
  - Display results with snippets
  - Link to continue specific research
  - **Parallelizable**: YES (with Task 8)

---

## Phase 2D: Testing & Documentation

- [x] 10. Add tests for migration-tool
  - Test scan of legacy sessions
  - Test migration to new structure
  - Test verify action
  - Test dry-run mode
  - **Parallelizable**: YES (after Task 1)

- [x] 11. Add tests for notebook-search
  - Test full-text search
  - Test scoped search
  - Test output searching
  - **Parallelizable**: YES (after Task 4)

- [x] 12. Update AGENTS.md with discovery docs
   - Document /gyoshu-list command
   - Document /gyoshu-search command
   - Document /gyoshu-migrate command
   - **Parallelizable**: YES (after all other tasks)

---

## Acceptance Criteria

1. [x] Legacy sessions at `~/.gyoshu/sessions/` can be migrated
2. [x] `/gyoshu-migrate` shows clear progress and results
3. [x] `/gyoshu-list` shows all researches with status
4. [x] `/gyoshu-search` finds relevant prior work
5. [x] `/gyoshu-run` suggests similar prior research
6. [x] `/gyoshu-continue` shows available context
7. [x] All tests pass (310 tests: 188 in .opencode/ + 122 in tests/)
8. [x] Documentation updated (AGENTS.md, README.md references)

---

## Files to Create

1. `.opencode/tool/migration-tool.ts` - Migration utility
2. `.opencode/tool/notebook-search.ts` - Notebook search
3. `.opencode/command/gyoshu-migrate.md` - Migration command
4. `.opencode/command/gyoshu-list.md` - List command
5. `.opencode/command/gyoshu-search.md` - Search command

## Files to Modify

1. `.opencode/tool/research-manager.ts` - Add search action
2. `.opencode/agent/gyoshu.md` - Add discovery workflow
3. `.opencode/command/gyoshu-run.md` - Show prior research
4. `.opencode/command/gyoshu-continue.md` - Show available context
5. `AGENTS.md` - Add discovery docs

---

## Estimated Effort

| Task Group | Tasks | Effort | Dependencies |
|------------|-------|--------|--------------|
| Migration Tool | 1-2 | 3h | None |
| Research Discovery | 3-5 | 4h | Migration done |
| Enhanced Commands | 6-9 | 3h | Discovery done |
| Testing & Docs | 10-12 | 2h | All above |

**Total**: ~12 hours (1-2 days)
