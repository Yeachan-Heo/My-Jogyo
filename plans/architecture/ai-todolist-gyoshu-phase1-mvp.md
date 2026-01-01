# Gyoshu Research System - Phase 1 MVP

**Goal**: Transform from session-centric to research-centric with project-local storage

**Parent Plan**: `gyoshu-research-system-plan.md`

**Oracle Status**: YELLOW → Focus on foundation first

---

## Oracle Recommendations (Incorporated)

| Topic | Recommendation |
|-------|----------------|
| **Folder name** | `./gyoshu/` (not `./gyoshu-notebooks/` - future-proof, shorter) |
| **Terminology** | "Research" + "Run" user-facing; "Session" = internal runtime only |
| **Run storage** | Hybrid: summaries in `research.json`, details in `runs/{runId}.json` |
| **Project root** | `./gyoshu/config.json` → git root → cwd; env override `GYOSHU_PROJECT_ROOT` |
| **Migration** | Legacy readable + explicit `/gyoshu-migrate` + warning when legacy exists |
| **MVP scope** | Path + research-manager + notebook-writer + commands + gitignore |
| **Order** | Config/root first → storage → commands → migration/tests |

---

## Pre-Phase: Path Centralization (CRITICAL - DO FIRST)

- [x] 1. Create centralized path resolver library
  - File: `.opencode/lib/paths.ts`
  - Functions: `getGyoshuRoot()`, `getResearchDir()`, `getRuntimeDir()`, `getSessionDir()`, `getRunPath()`, etc.
  - Include `getLegacySessionsDir()` and `hasLegacySessions()` for backwards compat
  - Project root detection (Oracle strategy):
    1. `GYOSHU_PROJECT_ROOT` env var (explicit override)
    2. Walk up for `./gyoshu/config.json` (marker file)
    3. Walk up for `.git` directory (git root)
    4. Fall back to cwd
  - **Parallelizable**: NO (foundation for all other tasks)

- [x] 2. Update session-manager.ts to use path resolver
  - Replace hardcoded `SESSIONS_DIR = path.join(os.homedir(), ".gyoshu", "sessions")`
  - Import from `../lib/paths.ts`
  - Keep backwards compat: check legacy path if new path empty
  - **Parallelizable**: NO (depends on Task 1)

- [x] 3. Update notebook-writer.ts to use path resolver
  - Replace any hardcoded paths
  - Import from `../lib/paths.ts`
  - **Parallelizable**: YES (with Tasks 4-7, after Task 1)

- [x] 4. Update python-repl.ts to use path resolver
  - Replace any hardcoded paths
  - **Parallelizable**: YES (with Tasks 3, 5-7, after Task 1)

- [x] 5. Update gyoshu-snapshot.ts to use path resolver
  - **Parallelizable**: YES (with Tasks 3-4, 6-7, after Task 1)

- [x] 6. Update gyoshu-completion.ts to use path resolver
  - **Parallelizable**: YES (with Tasks 3-5, 7, after Task 1)

- [x] 7. Update retrospective-store.ts to use path resolver
  - Change from `.gyoshu/retrospectives/` to `./gyoshu/retrospectives/`
  - **Parallelizable**: YES (with Tasks 3-6, after Task 1)

- [x] 8. Update gyoshu-hooks.ts plugin to use path resolver
  - **Parallelizable**: YES (with Tasks 3-7, after Task 1)

---

## Phase 1A: Research Manager

- [x] 9. Design ResearchManifest schema (Oracle hybrid approach)
  - **research.json** (summaries + run list):
    ```typescript
    interface ResearchManifest {
      schemaVersion: 1;  // Oracle: add from day one
      researchId: string;
      title: string;
      createdAt: string;
      updatedAt: string;
      status: "active" | "completed" | "archived";
      tags: string[];
      
      // Lineage
      parentResearchId?: string;
      derivedFrom?: Array<{ researchId: string; note?: string }>;
      
      // Run summaries only (details in runs/{runId}.json)
      runs: Array<{
        runId: string;
        startedAt: string;
        endedAt?: string;
        mode: "PLANNER" | "AUTO" | "REPL";
        goal: string;
        status: GoalStatus;
        // Summary only - full details in separate file
      }>;
      
      // Rolling summaries
      summaries: {
        executive: string;
        methods: string[];
        pitfalls: string[];
      };
    }
    ```
  - **runs/{runId}.json** (full run details):
    ```typescript
    interface RunDetail {
      schemaVersion: 1;
      runId: string;
      researchId: string;
      // Full execution details
      keyResults: Array<{ type: string; text: string; value?: string }>;
      artifacts: string[];
      sessionId?: string;
      contextBundle?: ContextBundle;  // Future: Phase 5
      executionLog?: Array<{ timestamp: string; event: string }>;
    }
    ```
  - Store at `./gyoshu/research/{researchId}/research.json`
  - **Parallelizable**: NO (design first)

- [x] 10. Create research-manager.ts tool
  - File: `.opencode/tool/research-manager.ts`
  - Actions: create, get, list, update, delete, addRun, getRun
  - Use path resolver from lib/paths.ts
  - Use atomic writes from lib/atomic-write.ts
  - Hybrid storage: update research.json + write runs/{runId}.json
  - **Parallelizable**: NO (depends on Task 9)

- [x] 11. Add researchId field to session-manager
  - Link sessions to owning research
  - Sessions become pure runtime containers (bridge, lock only)
  - Remove notebook/artifact storage from sessions
  - **Parallelizable**: YES (with Task 10, after Task 2)

---

## Phase 1B: Notebook Writer Updates

- [x] 12. Update notebook-writer for research-scoped storage
  - Change path from session-based to research-based
  - Support `./gyoshu/research/{researchId}/notebooks/{name}.ipynb`
  - Support multiple notebooks per research
  - **Parallelizable**: NO (depends on Tasks 9-10)

---

## Phase 1C: Config & Migration

- [x] 13. Create config.json schema and initialization
  - File: `./gyoshu/config.json`
  - Include: version, schemaVersion, createdAt, projectName
  - Auto-create on first gyoshu access
  - Emit warning if legacy `~/.gyoshu/sessions/` exists
  - **Parallelizable**: YES (with Task 12)

- [ ] 14. Create migration tool (DEFERRED to Phase 2)
  - File: `.opencode/tool/migration-tool.ts`
  - Scan old `~/.gyoshu/sessions/`
  - Create research for each session
  - Move notebooks and artifacts
  - **Never auto-delete old sessions**
  - **Parallelizable**: NO (depends on Task 10)

- [ ] 15. Create /gyoshu-migrate command (DEFERRED to Phase 2)
  - File: `.opencode/command/gyoshu-migrate.md`
  - Invoke migration-tool
  - Show progress and results
  - **Parallelizable**: YES (with Task 14, after Task 14 complete)

---

## Phase 1D: Agent Updates

- [x] 16. Update gyoshu.md planner agent
  - Use research-manager instead of session-manager for research lifecycle
  - Keep session-manager for runtime only
  - Update file permissions for new paths
  - **Parallelizable**: NO (depends on Task 10)

- [x] 17. Update jogyo.md executor agent
  - Update file permissions for new paths
  - **Parallelizable**: YES (with Task 16)

- [x] 18. Update jogyo-insight.md agent
  - Update glob patterns for new paths
  - Search in `./gyoshu/research/*/notebooks/*.ipynb`
  - **Parallelizable**: YES (with Tasks 16-17)

---

## Phase 1E: Command Updates

- [x] 19. Update /gyoshu-run command
  - Create research (not just session)
  - Initialize research-manager
  - **Parallelizable**: NO (depends on Tasks 16-18)

- [x] 20. Update /gyoshu-continue command
  - Continue existing research
  - Load research manifest
  - **Parallelizable**: YES (with Task 19)

---

## Phase 1F: Testing & Documentation

- [x] 21. Add unit tests for path resolver
  - Test all path functions
  - Test project root detection
  - **Parallelizable**: YES (after Task 1)

- [x] 22. Add integration tests for research-manager
  - Test CRUD operations
  - Test atomic writes
  - **Parallelizable**: YES (after Task 10)

- [x] 23. Update AGENTS.md documentation
  - Document new storage structure
  - Document migration process
  - **Parallelizable**: YES (after all other tasks)

- [x] 24. Add .gitignore entry for runtime
  - Ensure `gyoshu/runtime/` is gitignored (sockets, locks)
  - **Parallelizable**: YES (anytime)

---

## Acceptance Criteria

1. [x] All tools use centralized path resolver (no hardcoded paths)
2. [x] Sessions are pure runtime (bridge socket, lock only)
3. [x] Research + Run are primary user-facing units
4. [x] Storage is project-local at `./gyoshu/`
5. [ ] Old sessions readable via migration or backwards compat (DEFERRED - migration tool in Phase 2)
6. [x] Warning shown when legacy `~/.gyoshu/sessions/` exists
7. [x] `/gyoshu-run` creates research, not just session
8. [x] `/gyoshu-continue` continues research, not just session
9. [x] Tests pass (122 tests passing)
10. [x] Documentation updated

---

## Files to Create

1. `.opencode/lib/paths.ts` - Path resolver
2. `.opencode/tool/research-manager.ts` - Research CRUD
3. `.opencode/tool/migration-tool.ts` - Migration utility
4. `.opencode/command/gyoshu-migrate.md` - Migration command

## Files to Modify

1. `.opencode/tool/session-manager.ts` - Use paths.ts, add researchId
2. `.opencode/tool/notebook-writer.ts` - Research-scoped paths
3. `.opencode/tool/python-repl.ts` - Use paths.ts
4. `.opencode/tool/gyoshu-snapshot.ts` - Use paths.ts
5. `.opencode/tool/gyoshu-completion.ts` - Use paths.ts
6. `.opencode/tool/retrospective-store.ts` - Use paths.ts, new location
7. `.opencode/plugin/gyoshu-hooks.ts` - Use paths.ts
8. `.opencode/agent/gyoshu.md` - Use research-manager
9. `.opencode/agent/jogyo.md` - Update permissions
10. `.opencode/agent/jogyo-insight.md` - Update glob patterns
11. `.opencode/command/gyoshu-run.md` - Create research
12. `.opencode/command/gyoshu-continue.md` - Continue research
13. `AGENTS.md` - Documentation

---

## Estimated Effort

| Task Group | Tasks | Effort | Dependencies |
|------------|-------|--------|--------------|
| Path Centralization | 1-8 | 4h | None |
| Research Manager | 9-11 | 4h | Path done |
| Notebook Writer | 12 | 2h | Research Manager |
| Config & Migration | 13-15 | 3h | Research Manager |
| Agent Updates | 16-18 | 2h | Research Manager |
| Command Updates | 19-20 | 2h | Agent Updates |
| Testing & Docs | 21-24 | 2h | All above |

**Total**: ~19 hours (2-3 days)
