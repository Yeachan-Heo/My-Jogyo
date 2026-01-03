# Notepad - Notebook-Centric Architecture

## Notepad Section

[2026-01-01 10:30] - Task 1: Create migration-tool.ts

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- paths.ts already had all required legacy path helpers exported

### IMPLEMENTATION DECISIONS
- Used sessionId as researchId for migrated sessions (simplifies mapping and verification)
- Created a unique runId with format `migrated-{timestamp}` to distinguish migrated runs
- Used COPY (not move) for all file transfers - this is critical for safety
- Added "migrated-from-legacy" tag to all migrated research for easy identification
- Implemented dry-run mode that simulates the full migration process without writes
- Scan action returns detailed metadata including already-migrated status to prevent duplicate work

### PROBLEMS FOR NEXT TASKS
- Task 2 (/gyoshu-migrate command) should use this tool's output to display progress
- The scan action provides all info needed for the command's user interface
- Consider adding progress callbacks if migrating many sessions

### VERIFICATION RESULTS
- File created: .opencode/tool/migration-tool.ts
- Followed existing patterns from research-manager.ts (tool structure, validation, types)
- Used path helpers from paths.ts (getLegacySessionsDir, getLegacySessionPath, etc.)
- Used atomic writes from atomic-write.ts (durableAtomicWrite, fileExists, readFile)
- Implements all three required actions: scan, migrate, verify
- Dry-run mode fully implemented
- NEVER deletes legacy sessions (critical safety requirement)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Tool structure follows consistent pattern - tool({description, args, execute})
  - Evidence: research-manager.ts:371, session-manager.ts:246, migration-tool.ts:724
- [PROMOTE:CONV] Convention: All tool args use tool.schema.* methods for validation
  - Evidence: research-manager.ts:377-394, session-manager.ts:252-266
- [PROMOTE:CONV] Convention: validateId function pattern prevents path traversal attacks
  - Evidence: research-manager.ts:208-227, session-manager.ts:181-200, migration-tool.ts:231-250
- [PROMOTE:CONV] Convention: Section separators use `// ===== SECTION NAME =====` format
  - Evidence: research-manager.ts:39-41, session-manager.ts, paths.ts

Time taken: ~15 minutes

[2026-01-02 08:15] - Task 1.1: Define Stage Protocol Spec

### DISCOVERED ISSUES
- No pre-existing issues discovered
- The `docs/` directory did not exist - had to create it
- marker-parser.ts already had STAGE, CHECKPOINT, REHYDRATED markers defined (Task 1.2 was completed prior)

### IMPLEMENTATION DECISIONS
- Created comprehensive 584-line specification document at `docs/stage-protocol.md`
- Organized into 8 major sections with table of contents for navigation
- Stage envelope includes required fields (stageId, goal, inputs, outputs, maxDurationSec) and optional fields (dependencies, retryable, checkpointAfter)
- Added JSON schema for programmatic validation of stage envelopes
- Naming convention `S{NN}_{verb}_{noun}` includes common verb vocabulary and anti-pattern examples
- Idempotence section includes 4 core requirements with code examples: unique artifacts, no mutation, deterministic ops, atomic writes
- Included idempotence checklist for stage completion verification
- Artifact path format: `{runId}/{stageId}/{artifactName}` with full directory structure example
- Duration tiers: Quick (30-60s), Standard (60-240s), Extended (240-480s), Maximum (480-600s)
- Documented timeout escalation: soft limit (maxDuration) -> grace period -> hard limit (maxDuration + 30s)
- Added state machine diagram with 8 states and transition rules
- Included complete marker format reference for STAGE, CHECKPOINT, REHYDRATED markers

### PROBLEMS FOR NEXT TASKS
- Task 1.3 (Jogyo agent update) should reference this spec for stage execution protocol
- Task 1.4 (Gyoshu agent update) should reference this spec for stage planning
- Phase 2 (Checkpoint System) will build upon the artifact naming conventions defined here

### VERIFICATION RESULTS
- File created: docs/stage-protocol.md (584 lines)
- Verified all 5 sub-requirements covered:
  - 1.1.1: Stage envelope format (lines 56-144)
  - 1.1.2: Naming convention (lines 148-205)
  - 1.1.3: Idempotence requirements (lines 208-300)
  - 1.1.4: Artifact naming (lines 304-379)
  - 1.1.5: Max stage durations (lines 383-454)
- No tests needed (documentation-only task)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Stage envelope uses both required and optional fields for flexibility
  - Evidence: docs/stage-protocol.md:62-78
  - Use case: Required fields ensure minimum viable stage definition, optional fields allow customization
- [PROMOTE:CONV] Convention: Documentation uses table of contents with anchor links for navigation
  - Evidence: docs/stage-protocol.md:11-20
  - Helps readers find sections quickly in long specs
- [PROMOTE:PAT] Pattern: Include anti-pattern examples alongside valid examples in specifications
  - Evidence: docs/stage-protocol.md:195-204 (Invalid Stage IDs table)
  - Use case: Helps implementers avoid common mistakes

Time taken: ~10 minutes


### DISCOVERED ISSUES
- AGENTS.md already had the Ephemeral section updated for OS temp directories (lines 443-466)
- README.md still referenced `gyoshu/runtime/` in project root (lines 194-202)
- Implementation code exists in `.opencode-dev/` (development version), not `.opencode/` (production)
- The jogyo-paper-writer agent mentioned in directive does not exist in codebase (likely planned for future)

### IMPLEMENTATION DECISIONS
- Updated README.md "Research Storage" section to remove `gyoshu/runtime/` reference
- Added new "Runtime Data (Ephemeral)" subsection with OS temp directory locations
- Documented: Linux XDG_RUNTIME_DIR, Linux fallback (~/.cache), macOS (~/Library/Caches)
- Included GYOSHU_RUNTIME_DIR environment variable override
- Mentioned session ID hashing to 12 chars for Unix socket path limits
- Did NOT add AI report documentation since the feature doesn't exist yet in codebase

### PROBLEMS FOR NEXT TASKS
- AI report generation (jogyo-paper-writer, useAIReport, gatherReportContext) needs to be implemented
- When AI report features are added, documentation should be updated accordingly
- Production `.opencode/` directory still has old paths.ts - needs to be synced from `.opencode-dev/`

### VERIFICATION RESULTS
- Ran: `cd .opencode-dev && bun test` (383 pass, 0 fail, 925 expect() calls)
- Ran: `pytest -v --tb=short` (50 pass, all Python tests)
- Tests in main `tests/` directory show 122 pass, 5 errors (pre-existing module resolution issues)
- README.md updated: Research Storage section now consistent with AGENTS.md Ephemeral section

### LEARNINGS
- [PROMOTE:PAT] Pattern: Development vs Production directories (.opencode-dev vs .opencode)
  - Evidence: git diff shows changes in .opencode-dev/, production uses .opencode/
  - Use case: Development can proceed without affecting production users
- [PROMOTE:GOTCHA] Problem: Documentation can get ahead of implementation
  - Symptoms: AGENTS.md documents OS temp dirs but .opencode/lib/paths.ts still uses ./gyoshu/runtime
  - Solution: Verify documentation matches actual code, or clearly note planned vs implemented features

Time taken: ~15 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing report-markdown.ts was well-structured with clear marker extraction patterns
- gyoshu-completion.ts already had report generation integration

### IMPLEMENTATION DECISIONS
- Created new agent: `.opencode-dev/agent/jogyo-paper-writer.md`
  - Uses `anthropic/claude-sonnet-4-5-high` model (matches other jogyo agents)
  - Temperature 0.4 for balanced creativity/accuracy
  - Write permissions limited to `./reports/**`
  - Comprehensive style guidelines for narrative prose
- Added `ReportContext` interface to `report-markdown.ts`
  - Contains: title, objective, hypotheses, methodology, findings, metrics, limitations, nextSteps, artifacts, rawOutputs, frontmatter, conclusion
  - Structured format suitable for AI consumption
- Added `gatherReportContext()` function
  - Reads notebook and extracts all markers
  - Combines cell outputs for additional context
  - Extracts methodology from EXPERIMENT/ANALYSIS markers
- Added `useAIReport: boolean` flag to gyoshu-completion tool
  - When true, gathers context instead of generating rule-based report
  - Returns context in `aiReport.context` for caller to use with paper-writer agent
  - Backwards compatible: defaults to false (rule-based)
- Updated jogyo.md with AI report documentation section

### PROBLEMS FOR NEXT TASKS
- Planner (gyoshu.md) should be updated to handle AI report flow when completion returns `aiReport.ready: true`
- Consider adding automatic paper-writer invocation in future iteration

### VERIFICATION RESULTS
- Ran: `cd .opencode-dev && bun test` (383 pass, 0 fail, 925 expect() calls)
- Created: .opencode-dev/agent/jogyo-paper-writer.md (179 lines)
- Modified: .opencode-dev/lib/report-markdown.ts (added ReportContext interface + gatherReportContext function)
- Modified: .opencode-dev/tool/gyoshu-completion.ts (added useAIReport parameter)
- Modified: .opencode-dev/agent/jogyo.md (added AI-Generated Narrative Reports section)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Agent files for specialized tasks use narrow tool permissions
  - Evidence: jogyo-paper-writer.md only allows write to ./reports/**
  - Use case: Paper writer only needs to write reports, not access REPL or other tools
- [PROMOTE:PAT] Pattern: Context gathering function for AI consumption
  - Evidence: report-markdown.ts:gatherReportContext() creates structured JSON for AI
  - Use case: Transform marker-extracted data into AI-friendly format
- [PROMOTE:CONV] Convention: New boolean flags default to false for backwards compatibility
  - Evidence: gyoshu-completion.ts useAIReport defaults to undefined (falsy)
  - Existing workflows unchanged

Time taken: ~25 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered
- gyoshu-snapshot.ts and gyoshu-completion.ts still reference old SessionManifest interface
  - These tools will need updates in Phase 6 (Agent Updates) to read from notebook frontmatter instead

### IMPLEMENTATION DECISIONS
- Replaced heavy `SessionManifest` with lightweight `BridgeMeta` interface
- BridgeMeta only contains: sessionId, bridgeStarted, pythonEnv (type, pythonPath), notebookPath, workspace, slug
- Removed: environment metadata (pythonVersion, platform, packages, randomSeeds)
- Removed: cell execution tracking (executedCells, executionOrder, lastSuccessfulExecution)
- Removed: goal tracking (goalStatus, budgets, mode, goal, abortReason)
- Created `ensureGyoshuRuntimeSync()` to initialize minimal gyoshu/ structure
- Auto-creates .gitignore with `*` pattern to ignore all runtime content
- Removed legacy session path fallback (now runtime-only)
- Session file renamed from `manifest.json` to `bridge_meta.json`

### PROBLEMS FOR NEXT TASKS
- Task 14 (update jogyo.md agent): Should read research state from notebook frontmatter, not session manifest
- Task 15 (update gyoshu.md planner): Should update snapshot/completion tools to use notebook frontmatter
- gyoshu-snapshot.ts still defines its own SessionManifest interface - will break on new sessions
- gyoshu-completion.ts still updates session manifest - needs refactor to update notebook frontmatter

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Modified: .opencode/tool/session-manager.ts (509 → 449 lines)
- Session-manager now only handles runtime state
- .gitignore auto-created with "*" pattern on first session create

### LEARNINGS
- [PROMOTE:PAT] Pattern: Separate durable state (notebook frontmatter) from ephemeral state (runtime/)
  - Evidence: session-manager.ts now uses BridgeMeta for runtime-only, research data in notebook
  - Use case: Clean separation allows git to track research while ignoring runtime
- [PROMOTE:CONV] Convention: Runtime directories get auto-generated .gitignore with "*" pattern
  - Evidence: session-manager.ts:106-112 (ensureGyoshuRuntimeSync)
  - Ensures ephemeral data never gets committed

Time taken: ~20 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing patterns from research-manager.ts were well-structured
- readme-index.ts already had all required functions exported

### IMPLEMENTATION DECISIONS
- Added three new actions to research-manager.ts: `workspace-list`, `workspace-create`, `workspace-sync`
- Added helper function `updateRootReadme()` to generate root-level README.md with all workspaces
- Used `generateRootReadme()` from readme-index.ts for consistent README generation
- Added `name` and `description` optional args for workspace-create action
- Path validation in workspace-create prevents directory traversal attacks (same pattern as validateId)
- workspace-sync without name syncs all workspaces AND the root README
- Added `workspace` to reserved subcommands in gyoshu.md
- Created complete Workspace Workflow section with all three actions documented

### PROBLEMS FOR NEXT TASKS
- Task 12 (simplify session-manager.ts) can proceed independently
- Task 14 (update jogyo.md agent) should consider workspace-aware operations
- Workspace creation does NOT auto-create outputs directory - should be done by research creation

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Modified: .opencode/tool/research-manager.ts
  - Added imports: generateRootReadme, WorkspaceEntry, toDisplayName
  - Added actions: workspace-list, workspace-create, workspace-sync
  - Added helper: updateRootReadme()
  - Added args: name, description
- Modified: .opencode/command/gyoshu.md
  - Added `workspace` to reserved subcommands
  - Added routing for workspace subcommand
  - Added complete Workspace Workflow section (~90 lines)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Workspace actions follow CRUD pattern with hyphenated names
  - Evidence: research-manager.ts action enum: "workspace-list", "workspace-create", "workspace-sync"
  - Use case: Clear separation of resource (workspace) from operation (list/create/sync)
- [PROMOTE:CONV] Convention: Sync operations update multiple README files atomically
  - Evidence: research-manager.ts:1562-1580 (workspace-sync updates individual + root README)
  - When syncing all, both workspace READMEs and root README are regenerated
- [PROMOTE:PAT] Pattern: Reuse existing validation patterns for new entity types
  - Evidence: research-manager.ts:1534-1536 (workspace name validation mirrors validateId)
  - Consistent security across all path-based operations

Time taken: ~20 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing patterns from research-manager.ts were well-structured

### IMPLEMENTATION DECISIONS
- Added `NotebookResearchItem` interface for notebook-based listing results with extra fields (workspace, notebookPath)
- Created `loadNotebook()` helper function to load and parse `.ipynb` files safely
- Created `listResearchFromNotebooks()` function that:
  - Scans `getNotebookRootDir()` for workspace subdirectories
  - For each workspace, scans for `.ipynb` files
  - Parses frontmatter using `extractFrontmatter()` from notebook-frontmatter.ts
  - Converts to list format compatible with legacy API
- Updated `list` action case to:
  - First try `listResearchFromNotebooks()` (new approach)
  - If notebooks found, return with `source: "notebooks"` flag
  - Apply status/tags filters on notebook results
  - Fall back to legacy code with `source: "legacy"` if no notebooks found
- Added `source` field to list response to indicate data origin for consumers

### PROBLEMS FOR NEXT TASKS
- Task 8 (update create/update actions) should use similar approach to create notebooks with frontmatter
- Task 9 (notebook-search.ts) should use listResearchFromNotebooks() pattern for workspace-scoped search
- Consumers should check `source` field to know if results are from notebooks or legacy

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Modified: .opencode/tool/research-manager.ts
- Added: .opencode/tool/research-manager.test.ts (7 new tests for notebook-based listing)
- New tests cover: frontmatter parsing, multiple workspaces, status filtering, tags filtering, legacy fallback, invalid frontmatter handling, empty directory handling

### LEARNINGS
- [PROMOTE:PAT] Pattern: Dual-source listing with source indicator in response
  - Evidence: research-manager.ts list action returns `source: "notebooks" | "legacy"`
  - Use case: Consumers can adapt behavior based on data source during migration period
- [PROMOTE:PAT] Pattern: Workspace scanning with notebook frontmatter extraction
  - Evidence: research-manager.ts:listResearchFromNotebooks()
  - Scans directories for .ipynb files, parses frontmatter, builds unified list
- [PROMOTE:CONV] Convention: Filter functions applied to notebook results match legacy API
  - Evidence: Status and tags filters work identically for both notebook and legacy sources
  - Ensures backwards compatibility during migration

Time taken: ~25 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- paths.ts and notebook-frontmatter.ts were already complete (Tasks 1-2)
- Parameter schema used `required: ["action", "notebookPath"]` which needed updating for optional notebookPath

### IMPLEMENTATION DECISIONS
- Added three new optional parameters: `workspace`, `slug`, `title` for new-style path construction
- Made `notebookPath` optional - either `notebookPath` OR `(workspace + slug)` must be provided
- Used conditional logic: `useNewStyle = workspace && slug` to determine path construction method
- Path format: `{getNotebookRootDir()}/{workspace}/{slug}.ipynb` for new-style
- Used `ensureFrontmatterCell()` ONLY for NEW notebooks with workspace+slug (not for existing notebooks)
- Report cell placement uses `splice(1, 0, cell)` when frontmatter added (position 1), otherwise `unshift` (position 0)
- Return object includes `hasFrontmatter`, `workspace`, `slug`, `notebookPath` for consumer clarity

### PROBLEMS FOR NEXT TASKS
- Task 5 (cell tagging) can proceed with the updated notebook-writer
- Task 6 (python-repl auto-capture) should use workspace+slug params when creating notebooks
- Task 7 (research-manager refactor) should use workspace+slug when creating new research notebooks

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Modified: .opencode/tool/notebook-writer.ts
- Added imports: `fileExists`, `getNotebookRootDir`, `ensureFrontmatterCell`, `GyoshuFrontmatter`
- Added parameters: workspace, slug, title (all optional)
- Updated ensure_notebook action with new path logic and frontmatter insertion
- Backwards compatible: existing `notebookPath` parameter still works for legacy mode

### LEARNINGS
- [PROMOTE:PAT] Pattern: Dual-path API with conditional construction
  - Evidence: notebook-writer.ts:244-261 (useNewStyle conditional for path construction)
  - Use case: Support both new and legacy APIs during migration period
- [PROMOTE:CONV] Convention: Cell insertion order matters with frontmatter
  - Evidence: notebook-writer.ts:290-297 (splice at 1 vs unshift)
  - Frontmatter at 0, report at 1 for new-style; report at 0 for legacy
- [PROMOTE:GOTCHA] Problem: Parameter schema `required` blocks optional alternatives
  - Symptoms: Can't use workspace+slug if notebookPath is required
  - Solution: Remove notebookPath from required array, add validation in execute()

Time taken: ~15 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered
- Existing command files in `.opencode/command/` follow consistent patterns

### IMPLEMENTATION DECISIONS
- Used `gyoshu` agent (consistent with other commands like gyoshu-run, gyoshu-continue)
- Documented $ARGUMENTS for flexibility (supports --dry-run and optional session_id)
- Created detailed 5-step workflow for the gyoshu agent to follow:
  1. Scan: Uses migration-tool action: "scan"
  2. Confirm: Asks user before proceeding (skipped for dry-run)
  3. Execute: Uses migration-tool action: "migrate"
  4. Verify: Uses migration-tool action: "verify" (skipped for dry-run)
  5. Summary: Displays clear results with next steps
- Included visual progress indicators (emojis, tables) for user experience
- Added clear messaging for all scenarios (success, dry-run, failures, no sessions)

### PROBLEMS FOR NEXT TASKS
- Task 12 (Update AGENTS.md) should document this command
- The command references /gyoshu-list which will be created in Task 8

### VERIFICATION RESULTS
- File created: .opencode/command/gyoshu-migrate.md
- Followed existing command format (YAML frontmatter with description and agent)
- Matches patterns from gyoshu-run.md, gyoshu-continue.md, gyoshu-abort.md
- Supports dry-run mode flag as specified in requirements
- Shows scan results before migration
- Asks for confirmation before migrating
- Displays progress during migration
- Shows final results with summary

### LEARNINGS
- [PROMOTE:CONV] Convention: Command files use YAML frontmatter with 'description' and 'agent' fields
  - Evidence: gyoshu-run.md:1-4, gyoshu-continue.md:1-4, gyoshu-abort.md:1-4
- [PROMOTE:CONV] Convention: $ARGUMENTS placeholder for user input in commands
  - Evidence: gyoshu-run.md:8, gyoshu-continue.md:6, gyoshu-abort.md:6
- [PROMOTE:PAT] Pattern: Commands document step-by-step workflow using numbered sections
  - Evidence: gyoshu-abort.md:12-16, gyoshu-migrate.md:17-136

Time taken: ~10 minutes

[2026-01-01 12:45] - Task 3: Add search action to research-manager

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing code patterns were well-structured and easy to follow

### IMPLEMENTATION DECISIONS
- Added `search` to the action enum alongside existing actions
- Created SearchResult interface for type-safe search results
- Implemented scoring logic: title match (+3), goal match (+2), tag match (+1 each), status match (+1)
- Used case-insensitive matching via toLowerCase() for user-friendly search
- Results sorted by score descending for relevance ranking
- Snippet extraction prioritizes: title > goal > tags > status
- Goal snippets truncated to 100 characters with ellipsis for long content

### PROBLEMS FOR NEXT TASKS
- Task 4 (notebook-search.ts) can use similar patterns for scoring and result formatting
- Task 5 (gyoshu.md discovery) should use this search action to find similar prior work
- Tasks 8 and 9 (gyoshu-list and gyoshu-search commands) will invoke this search action

### VERIFICATION RESULTS
- Ran: bun test (122 pass, 0 fail)
- Modified: .opencode/tool/research-manager.ts
- Added search action to enum (line 494)
- Added SearchResult interface (lines 196-212)
- Added search helper functions (lines 385-480)
- Added search case handler (lines 959-1028)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Search scoring with weighted field matches
  - Evidence: research-manager.ts:398-423
  - Title gets highest weight (+3), goal (+2), tags (+1 each), status (+1)
- [PROMOTE:CONV] Convention: Use containsIgnoreCase helper for case-insensitive string matching
  - Evidence: research-manager.ts:393-396

Time taken: ~10 minutes

[2026-01-01 13:00] - Task 10: Add tests for migration-tool

### DISCOVERED ISSUES
- Legacy sessions path (~/.gyoshu/sessions/) is hardcoded in paths.ts constant
- Had to create actual files at legacy location with careful cleanup to avoid conflicts
- No existing migration-tool tests to build upon

### IMPLEMENTATION DECISIONS
- Created test fixtures at actual ~/.gyoshu/sessions/ with unique prefixes (test-session-*)
- Used careful cleanup in afterEach to remove only test-created sessions
- Tracked whether we created the legacy dir to avoid removing user's existing sessions
- Used GYOSHU_PROJECT_ROOT env var for project isolation (same pattern as research-manager.test.ts)
- Organized tests into logical groups: Scan, Migrate, Dry-Run, Verify, Directory Structure, Metadata

### PROBLEMS FOR NEXT TASKS
- None - this task is self-contained testing
- Test patterns here can be reused for Task 11 (notebook-search tests)

### VERIFICATION RESULTS
- Ran: bun test ./.opencode/tool/migration-tool.test.ts
- All 39 tests pass with 137 expect() calls
- Ran: bun test (all tests) - 122 pass, 0 fail across 4 files
- Created: .opencode/tool/migration-tool.test.ts (1041 lines)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Test file structure mirrors implementation sections
  - Evidence: migration-tool.test.ts organizes tests by action type matching migration-tool.ts
- [PROMOTE:CMD] Command verified: `bun test ./.opencode/tool/migration-tool.test.ts`
  - Context: Run from project root, prefix with ./ for path-based test selection
  - Output: 39 pass, 0 fail
- [PROMOTE:CONV] Convention: Test helpers use execute() wrapper that parses JSON result
  - Evidence: research-manager.test.ts:33-42, migration-tool.test.ts:47-53
- [PROMOTE:GOTCHA] Problem: bun test requires ./ prefix for paths starting with .opencode
  - Symptoms: "The following filters did not match any test files"
  - Solution: Use `bun test ./.opencode/...` instead of `bun test .opencode/...`

Time taken: ~20 minutes

[2026-01-01 14:15] - Task 5: Update gyoshu.md to use discovery

### DISCOVERED ISSUES
- No pre-existing issues discovered
- gyoshu.md had clean structure with clear sections to extend

### IMPLEMENTATION DECISIONS
- Added "Discovery Before New Research" section (lines 42-115 in updated file)
- Positioned discovery BEFORE "Starting New Research" to enforce workflow order
- Documented complete 6-step workflow:
  1. Extract keywords from user goal
  2. Search using research-manager search action
  3. Display top 3 results if found
  4. Handle no results case (proceed to new research)
  5. Handle user choosing to continue existing
  6. Handle user choosing to start fresh
- Added "When to Skip Discovery" section for edge cases (explicit "start fresh", provided researchId, etc.)
- Included complete API example showing search call and response format
- Added visual example of how to display results to user

### PROBLEMS FOR NEXT TASKS
- Task 6 (/gyoshu-run) should implement this discovery workflow
- Task 7 (/gyoshu-continue) can reference this section for context loading
- Task 9 (/gyoshu-search) provides user-accessible search command

### VERIFICATION RESULTS
- Modified: .opencode/agent/gyoshu.md
- Added ~75 lines of discovery workflow documentation
- Verified file structure preserved - all existing sections intact
- Section flow: Discovery → Starting New Research → Continuing Research

### LEARNINGS
- [PROMOTE:PAT] Pattern: Agent documentation adds workflow sections with numbered steps + code examples
  - Evidence: gyoshu.md:42-115 (Discovery), gyoshu.md:168-233 (AUTO mode workflow)
- [PROMOTE:CONV] Convention: API examples in agent docs show both call syntax and JSON response
  - Evidence: gyoshu.md:52-75 (search call + response), gyoshu.md:198-232 (cycle execution)

Time taken: ~10 minutes

[2026-01-01 13:45] - Task 7: Update /gyoshu-continue with discovery

### DISCOVERED ISSUES
- No pre-existing issues discovered
- Original file was minimal (17 lines) with just basic REPL preservation note

### IMPLEMENTATION DECISIONS
- Expanded file from 17 lines to 183 lines with comprehensive documentation
- Added structured context display sections:
  1. Research Context (title, ID, status, dates, goal)
  2. Previous Runs Summary (table with run details and status counts)
  3. Key Findings (up to 5 findings from recent runs with marker prefixes)
  4. Available Artifacts (table with artifact paths, types, run source)
  5. REPL State Hint (variable availability, mode, cell replay note)
- Documented 5-step implementation workflow for gyoshu agent:
  1. Get Research Manifest (research-manager get)
  2. Calculate Run Statistics
  3. Get Recent Run Details (research-manager getRun)
  4. Display Context (using templates)
  5. Continue Research (check for active runs, offer options)
- Added complete example session output showing realistic context display
- Included notes about resuming ABORTED runs and mode preservation

### PROBLEMS FOR NEXT TASKS
- Task 12 (Update AGENTS.md) should reference this enhanced command
- The context display format should be consistent with /gyoshu-list and /gyoshu-search

### VERIFICATION RESULTS
- Ran: bun test (122 pass, 0 fail, 230 expect() calls)
- Modified: .opencode/command/gyoshu-continue.md (17 → 183 lines)
- Follows existing command patterns from gyoshu-search.md and gyoshu-list.md
- Uses research-manager API documented in research-manager.ts
- Matches context display requirements from directive

### LEARNINGS
- [PROMOTE:PAT] Pattern: Command files document step-by-step implementation for agents
  - Evidence: gyoshu-continue.md:76-123, gyoshu-search.md:29-106, gyoshu-list.md:41-51
- [PROMOTE:CONV] Convention: Context display uses markdown tables and code blocks for readability
  - Evidence: gyoshu-continue.md:31-40, gyoshu-search.md:75-91

Time taken: ~10 minutes

[2026-01-01 15:30] - Task 1-4: Create unified /gyoshu command

### DISCOVERED ISSUES
- No pre-existing issues discovered
- All existing command files were well-structured and consistent

### IMPLEMENTATION DECISIONS
- Created comprehensive 992-line unified command file at `.opencode/command/gyoshu.md`
- Used dispatcher pattern with routing logic that checks first token against reserved subcommands
- Reserved subcommands: plan, continue, repl, list, search, report, replay, unlock, migrate, abort, help
- Empty arguments → Status Display Workflow
- Non-subcommand arguments → New Research Workflow with discovery phase
- Each subcommand workflow documented inline with complete implementation steps
- REPL workflow delegates to @jogyo agent (not gyoshu) for direct Python REPL access
- Added edge case handling for ambiguous goals, ID confusion, multiple active sessions
- Status display shows numbered table of researches with quick action suggestions
- Discovery workflow searches for similar prior work before creating new research

### PROBLEMS FOR NEXT TASKS
- Task 5: /gyoshu-auto remains separate and should verify standalone operation
- Task 6-7: Deprecation wrappers should redirect old commands to new unified command
- Task 8-10: Documentation updates should reflect the unified command structure

### VERIFICATION RESULTS
- Ran: bun test (122 pass, 0 fail, 230 expect() calls)
- Created: .opencode/command/gyoshu.md (992 lines)
- All existing tests still pass - no regressions

### LEARNINGS
- [PROMOTE:PAT] Pattern: Dispatcher pattern for unified commands - parse first token, route to workflows
  - Evidence: gyoshu.md:11-64 (dispatcher section with routing logic)
- [PROMOTE:CONV] Convention: Reserved subcommands use case-sensitive exact match on first token
  - Evidence: gyoshu.md:17-21 (reserved subcommands list)
- [PROMOTE:CONV] Convention: Empty arguments triggers status/help display, not error
  - Evidence: gyoshu.md:73-119 (Status Display Workflow)
- [PROMOTE:PAT] Pattern: Discovery before creation - search for similar prior work to avoid duplication
  - Evidence: gyoshu.md:148-205 (Discovery Phase in New Research Workflow)

Time taken: ~20 minutes

[2026-01-01 16:00] - Task 5: Update /gyoshu-auto to be the only autonomous entry

### DISCOVERED ISSUES
- No issues discovered - the command was already well-structured as standalone

### IMPLEMENTATION DECISIONS
- Added clarifying callout box at line 12 to explicitly state this is THE standalone autonomous command
- Distinguished from `/gyoshu <goal>` which is for interactive research
- Emphasized "runs to completion without user intervention (within budget limits)"
- No functional changes needed - command was already properly independent

### PROBLEMS FOR NEXT TASKS
- Task 8 (AGENTS.md) should document both `/gyoshu` and `/gyoshu-auto` as the two primary commands
- Task 9 (README.md) should update commands table to show unified structure

### VERIFICATION RESULTS
- Verified: gyoshu-auto.md has own YAML frontmatter (agent: gyoshu, standalone description)
- Verified: No overlap with /gyoshu subcommands (plan, continue, repl, list, search, report, replay, unlock, migrate, abort, help)
- Verified: /gyoshu.md lines 96-97 explicitly reference /gyoshu-auto as separate autonomous command
- Verified: /gyoshu uses PLANNER mode (interactive), /gyoshu-auto uses AUTO mode (autonomous)
- File modified: .opencode/command/gyoshu-auto.md (41 → 47 lines)

### LEARNINGS
- [PROMOTE:CONV] Convention: /gyoshu = interactive (PLANNER mode), /gyoshu-auto = autonomous (AUTO mode)
  - Evidence: gyoshu.md:244-246, gyoshu-auto.md:12, gyoshu-auto.md:18
- [PROMOTE:PAT] Pattern: Callout boxes use markdown blockquote with bold lead-in for emphasis
  - Evidence: gyoshu-auto.md:12 "> **This is the standalone autonomous research command.**"

Time taken: ~5 minutes

[2026-01-01 16:30] - Task 6: Create deprecation wrapper template

### DISCOVERED ISSUES
- No pre-existing issues discovered
- Existing command files follow consistent YAML frontmatter pattern

### IMPLEMENTATION DECISIONS
- Created TWO template variants to cover all deprecation cases:
  1. **Subcommand Template**: For commands that map to `/gyoshu <subcommand>` (e.g., `/gyoshu-plan` → `/gyoshu plan`)
  2. **Goal Mode Template**: For commands that map to `/gyoshu` with goal argument (e.g., `/gyoshu-run` → `/gyoshu <goal>`)
- Kept `agent: gyoshu` to ensure the command still routes to the correct agent
- Deprecation warning uses ⚠️ emoji and markdown blockquote for visibility
- Template includes "WHY" and "HOW" sections to help users transition
- Backwards compatibility maintained by forwarding all arguments to new command

### PROBLEMS FOR NEXT TASKS
- Task 7 should copy the appropriate template variant for each command
- Mapping table provided below for easy reference

### VERIFICATION RESULTS
- Templates documented in this notepad for Task 7 to use
- Both template variants cover all 12 commands to be deprecated

### LEARNINGS
- [PROMOTE:PAT] Pattern: Deprecation wrappers keep original functionality while adding migration guidance
  - Evidence: Template structure below maintains agent routing while adding warning

Time taken: ~10 minutes

---

[2026-01-01 23:15] - Task 2: Create notebook-frontmatter.ts library

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- The cell-identity.ts already exports Notebook and NotebookCell interfaces which I reused
- No existing YAML parsing in the codebase - had to implement simple parser without external dependencies

### IMPLEMENTATION DECISIONS
- Implemented simple YAML parser without external library (as required by directive)
  - Supports: key-value pairs, nested objects (one level), arrays, quoted strings, booleans, numbers, null
  - State machine approach with indentation tracking for nested structures
- Used immutable pattern for updateFrontmatter() and ensureFrontmatterCell() - return new notebook, don't mutate
- Stored gyoshu metadata under `gyoshu:` namespace to avoid conflicts with Quarto fields
- Frontmatter cell uses `cell_type: "raw"` with YAML content between `---` delimiters (Quarto-compatible)
- Bounded run history to last 10 entries to prevent frontmatter bloat
- Added validation function that checks schema_version and all required fields

### PROBLEMS FOR NEXT TASKS
- Task 3 (readme-index.ts) can use similar patterns for parsing/serializing markdown with sentinels
- Task 4 (notebook-writer.ts update) should use ensureFrontmatterCell() when creating notebooks
- The YAML parser only supports one level of nesting - sufficient for current schema but may need extension if schema evolves

### VERIFICATION RESULTS
- Ran: bun test ./.opencode/lib/notebook-frontmatter.test.ts (59 pass, 0 fail, 134 expect() calls)
- Ran: bun test (163 pass, 0 fail, 327 expect() calls - no regressions)
- Created: .opencode/lib/notebook-frontmatter.ts (~785 lines)
- Created: .opencode/lib/notebook-frontmatter.test.ts (~665 lines)
- All functions tested: parseSimpleYaml, serializeToYaml, extractFrontmatter, updateFrontmatter, ensureFrontmatterCell, validateFrontmatter, hasFrontmatter, getCurrentRun, addRun, updateRun

### LEARNINGS
- [PROMOTE:PAT] Pattern: Immutable notebook operations - deep clone with JSON.parse(JSON.stringify()) before modification
  - Evidence: notebook-frontmatter.ts:550, notebook-frontmatter.ts:614
  - Use case: Preserve original notebook for comparison, prevent accidental mutation
- [PROMOTE:CONV] Convention: Frontmatter cell must be raw type at index 0 with YAML between --- delimiters
  - Evidence: notebook-frontmatter.ts:394-408 (isFrontmatterCell), plan lines 77-78
  - Quarto compatibility requirement
- [PROMOTE:PAT] Pattern: Simple YAML parsing with state machine tracking indentation and current context
  - Evidence: notebook-frontmatter.ts:113-248 (parseSimpleYaml)
  - Avoids external YAML library dependency while handling common YAML subset
- [PROMOTE:CONV] Convention: Run history bounded to last 10 entries
  - Evidence: notebook-frontmatter.ts:753-755 (addRun), plan line 102
  - Prevents frontmatter bloat while preserving recent history
- [PROMOTE:CMD] Command verified: `bun test ./.opencode/lib/notebook-frontmatter.test.ts`
  - Context: Run from project root to test specific lib file
  - Output: 59 pass, 0 fail

Time taken: ~20 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- paths.ts already had well-structured caching pattern with `cachedProjectRoot` and `clearProjectRootCache()`

### IMPLEMENTATION DECISIONS
- Added `ProjectProfile` interface with `notebookDir`, `outputsDir`, and `detected` fields
- Created `NOTEBOOK_DIR_CANDIDATES` constant array with priority-ordered detection candidates:
  1. `notebooks/` → `outputs/` (most common)
  2. `nbs/` → `outputs/` (nbdev convention)
  3. `analysis/` → `analysis_outputs/` (analysis projects)
  4. `jupyter/` → `outputs/` (some projects)
- Detection uses `fs.existsSync` + `fs.statSync().isDirectory()` to ensure we detect only directories (not files with same name)
- Used module-level `cachedProjectProfile` for caching, matching existing `cachedProjectRoot` pattern
- Detection is NOT creating directories - just detecting existing conventions

### PROBLEMS FOR NEXT TASKS
- Task 4 (notebook-writer.ts update) should use `getNotebookRootDir()` instead of hardcoded paths
- Task 6 (python-repl.ts update) should use `getNotebookRootDir()` for auto-capture paths
- All components should call `clearProjectProfileCache()` in test setup/teardown

### VERIFICATION RESULTS
- Ran: `bun test ./.opencode/lib/paths.test.ts` (66 pass, 0 fail, 106 expect() calls)
- Ran: `bun test` (163 pass, 0 fail, 327 expect() calls)
- Added 17 new tests for project profile detection:
  - detectProjectProfile (8 tests): notebooks/, nbs/, analysis/, jupyter/ detection, priority, defaults, file-not-dir, caching
  - clearProjectProfileCache (1 test): cache clearing
  - getNotebookRootDir (3 tests): detected path, default path, absolute path
  - getOutputsRootDir (4 tests): notebooks convention, analysis convention, default, absolute path
  - consistency (1 test): profile + getters match

### LEARNINGS
- [PROMOTE:PAT] Pattern: Caching with clear function - module-level cache variable + export clear function for testing
  - Evidence: paths.ts:94 `cachedProjectRoot`, paths.ts:181 `clearProjectRootCache()`, paths.ts:124 `cachedProjectProfile`, paths.ts:175 `clearProjectProfileCache()`
- [PROMOTE:CONV] Convention: Directory detection checks both existence AND isDirectory() to avoid false positives on files
  - Evidence: paths.ts:153 `fs.existsSync(notebookPath) && fs.statSync(notebookPath).isDirectory()`
- [PROMOTE:PAT] Pattern: Priority-ordered detection uses array of candidates iterated in order
  - Evidence: paths.ts:97-102 `NOTEBOOK_DIR_CANDIDATES` array with priority comments
- [PROMOTE:CONV] Convention: Profile detection does NOT create directories - detection is read-only
  - Evidence: paths.ts:144-168 `detectProjectProfile()` only reads, never writes

Time taken: ~15 minutes


### DISCOVERED ISSUES
- No pre-existing issues discovered
- All 12 command files existed and were well-structured
- One command (gyoshu-repl.md) originally had `agent: jogyo`, changed to `agent: gyoshu` for unified routing

### IMPLEMENTATION DECISIONS
- Applied Template A (subcommand mapping) to 10 commands: plan, continue, repl, list, search, report, replay, unlock, migrate, abort
- Applied Template B (goal mode mapping) to 2 commands: run, interactive
- Kept `agent: gyoshu` in all files to ensure proper routing through unified command
- Preserved original documentation in "Original Documentation" section for reference
- Used ⚠️ emoji in blockquote for high-visibility deprecation warning
- Each wrapper includes: warning, new command suggestion, example, explanation, and forwarding instruction

### PROBLEMS FOR NEXT TASKS
- Task 8 (AGENTS.md): Should remove old command list and document new unified structure
- Task 9 (README.md): Should update Quick Start and Commands table
- Task 10 (gyoshu.md agent): Should remove references to old commands
- Old commands still appear in command listings; will be cleaned up in Phase 6 (future)

### VERIFICATION RESULTS
- Verified: All 12 command files updated with deprecation wrappers
- Verified: Each file has [DEPRECATED] prefix in description
- Verified: Each file has ⚠️ warning in blockquote format
- Verified: Each file shows correct new command to use
- Verified: Each file maintains `agent: gyoshu` for routing
- Verified: Original functionality preserved for backwards compatibility

### LEARNINGS
- [PROMOTE:PAT] Pattern: Deprecation wrappers use YAML frontmatter with "[DEPRECATED]" prefix + blockquote warning
  - Evidence: gyoshu-plan.md:1-15, gyoshu-run.md:1-15
- [PROMOTE:CONV] Convention: Deprecation warning uses ⚠️ emoji + bold "DEPRECATED COMMAND" in blockquote
  - Evidence: All 12 deprecated command files follow identical format

Time taken: ~10 minutes


Below are reusable templates for wrapping old commands with deprecation warnings.

---

### TEMPLATE A: Subcommand Mapping

Use this for commands that map to `/gyoshu <subcommand>`.

**Commands using Template A:**
| Old Command | New Command | Subcommand |
|-------------|-------------|------------|
| `/gyoshu-plan` | `/gyoshu plan` | `plan` |
| `/gyoshu-continue` | `/gyoshu continue` | `continue` |
| `/gyoshu-repl` | `/gyoshu repl` | `repl` |
| `/gyoshu-list` | `/gyoshu list` | `list` |
| `/gyoshu-search` | `/gyoshu search` | `search` |
| `/gyoshu-report` | `/gyoshu report` | `report` |
| `/gyoshu-replay` | `/gyoshu replay` | `replay` |
| `/gyoshu-unlock` | `/gyoshu unlock` | `unlock` |
| `/gyoshu-migrate` | `/gyoshu migrate` | `migrate` |
| `/gyoshu-abort` | `/gyoshu abort` | `abort` |

**Template A Content:**
```markdown
---
description: "[DEPRECATED] {ORIGINAL_DESCRIPTION}"
agent: gyoshu
---

> ⚠️ **DEPRECATED COMMAND**
>
> This command is deprecated and will be removed in a future release.
>
> **Use instead:** `/gyoshu {SUBCOMMAND} {ARGS}`
>
> Example: `/gyoshu {SUBCOMMAND} $ARGUMENTS`

---

**Why the change?** Gyoshu commands have been consolidated. The new `/gyoshu` command handles all subcommands in one place.

**This command still works** for backwards compatibility, but please update your workflow.

---

## Forwarding to New Command

Execute as: `/gyoshu {SUBCOMMAND} $ARGUMENTS`

{INCLUDE_ORIGINAL_DOCUMENTATION_IF_NEEDED}
```

---

### TEMPLATE B: Goal Mode Mapping

Use this for commands that map to `/gyoshu <goal>` (goal mode).

**Commands using Template B:**
| Old Command | New Command | Notes |
|-------------|-------------|-------|
| `/gyoshu-run` | `/gyoshu <goal>` | Start new interactive research |
| `/gyoshu-interactive` | `/gyoshu <goal>` | Same as gyoshu-run (PLANNER mode) |

**Template B Content:**
```markdown
---
description: "[DEPRECATED] {ORIGINAL_DESCRIPTION}"
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

{INCLUDE_ORIGINAL_DOCUMENTATION_IF_NEEDED}
```

---

[2026-01-01 18:15] - Task 11: Create auto-capture mechanism for code execution

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing code patterns were well-structured and easy to follow

### IMPLEMENTATION DECISIONS
- Chose **Option A** (modify python-repl.ts) as recommended - cleanest integration with single tool call
- Added optional `notebookPath` and `autoCapture` parameters to python-repl execute action
- Created helper functions: `splitIntoLines`, `convertExecuteResultToOutputs`, `appendCodeCellToNotebook`
- Added execution counter per session for proper notebook cell numbering (`executionCounters` Map)
- Auto-capture happens after code execution if both `notebookPath` and `autoCapture=true` are provided
- Returns enriched result with `notebookCapture` status object containing cellId, cellIndex, error
- Reused existing patterns from notebook-writer.ts for cell creation and notebook handling
- Added `autoCaptured: true` metadata to cells created by auto-capture for identification

### PROBLEMS FOR NEXT TASKS
- Task 12 (Update jogyo agent) should use the new `notebookPath` and `autoCapture=true` parameters
- When continuing a session, jogyo should get notebookPath from session manifest
- Execution counter resets per session - consider persisting to session manifest if needed across restarts

### VERIFICATION RESULTS
- Ran: bun test (141 pass, 0 fail, 282 expect() calls)
- Created: tests/auto-capture.test.ts (19 new tests)
- Modified: .opencode/tool/python-repl.ts (added ~150 lines)
- All output types covered: stdout → stream, stderr → stream, error → error output
- Notebook format: nbformat 4.5 with cell IDs, atomic writes

### LEARNINGS
- [PROMOTE:PAT] Pattern: Auto-capture uses executeAndCapture wrapper for consistent result enrichment
  - Evidence: python-repl.ts:872-893 (executeAndCapture function wraps result with notebook capture)
- [PROMOTE:CONV] Convention: Notebook cell outputs use nbformat types (stream, execute_result, error)
  - Evidence: python-repl.ts:94-120 (interface definitions matching Jupyter spec)
- [PROMOTE:GOTCHA] Problem: Code lines need proper newline handling for notebook source format
  - Symptoms: Notebook cells showing as single line instead of multiline
  - Solution: splitIntoLines adds \n to all lines except last, filters empty lines

Time taken: ~25 minutes

---

### TEMPLATE VARIABLES TO REPLACE

| Variable | Description | Example |
|----------|-------------|---------|
| `{ORIGINAL_DESCRIPTION}` | Original description from YAML frontmatter | "Create a Gyoshu research plan" |
| `{SUBCOMMAND}` | The subcommand keyword | "plan", "continue", "list" |
| `{ARGS}` | Placeholder description of arguments | "<goal>", "[id]", "[filters]" |
| `{INCLUDE_ORIGINAL_DOCUMENTATION_IF_NEEDED}` | Optional: Keep relevant docs for context | Discovery workflow, etc. |

---

### COMPLETE MAPPING TABLE FOR TASK 7

| # | Old Command | Template | New Command | Example |
|---|-------------|----------|-------------|---------|
| 1 | `/gyoshu-run` | B | `/gyoshu <goal>` | `/gyoshu analyze iris data` |
| 2 | `/gyoshu-plan` | A | `/gyoshu plan <goal>` | `/gyoshu plan clustering analysis` |
| 3 | `/gyoshu-continue` | A | `/gyoshu continue [id]` | `/gyoshu continue iris-analysis` |
| 4 | `/gyoshu-repl` | A | `/gyoshu repl <query>` | `/gyoshu repl quick exploration` |
| 5 | `/gyoshu-list` | A | `/gyoshu list [filters]` | `/gyoshu list --status active` |
| 6 | `/gyoshu-search` | A | `/gyoshu search <query>` | `/gyoshu search correlation` |
| 7 | `/gyoshu-report` | A | `/gyoshu report [id]` | `/gyoshu report` |
| 8 | `/gyoshu-replay` | A | `/gyoshu replay <sid>` | `/gyoshu replay ses_abc123` |
| 9 | `/gyoshu-unlock` | A | `/gyoshu unlock <sid>` | `/gyoshu unlock ses_abc123` |
| 10 | `/gyoshu-migrate` | A | `/gyoshu migrate [opts]` | `/gyoshu migrate --dry-run` |
| 11 | `/gyoshu-abort` | A | `/gyoshu abort [sid]` | `/gyoshu abort` |
| 12 | `/gyoshu-interactive` | B | `/gyoshu <goal>` | `/gyoshu analyze wine data` |

---

[2026-01-01 20:30] - Task 11.5: Per-project Python environment isolation

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- The existing project already has a .venv directory which the detection finds correctly

### IMPLEMENTATION DECISIONS
- Renamed `detectPythonEnvironment()` to `detectExistingPythonEnv()` (sync, returns null if not found)
- Created `detectOrCreatePythonEnv()` as async function that creates venv if needed
- Created `createGyoshuVenv()` to create ./gyoshu/venv and install packages
- Added `gyoshu-venv` as a new PythonEnvType to distinguish Gyoshu-managed venvs
- Added `created?: boolean` to PythonEnvironment interface to indicate newly created venvs
- Core packages: pandas, numpy, scikit-learn, matplotlib, seaborn
- Marker file `.gyoshu-initialized` prevents reinstalling packages on restart
- Package installation continues even if some packages fail (venv is still usable)
- Uses spawnSync with 5-minute timeout for package installation (async-friendly)
- Windows compatibility: Scripts/python.exe vs bin/python

### PROBLEMS FOR NEXT TASKS
- Task 12 (jogyo agent) should leverage the pythonEnv.created flag to inform user of first-time setup
- The venv creation can take 1-2 minutes on first use due to package installation
- Consider adding progress indication for package installation in future

### VERIFICATION RESULTS
- Ran: bun test (155 pass, 0 fail, 306 expect() calls)
- Created: tests/venv-isolation.test.ts (14 new tests)
- Modified: .opencode/tool/python-repl.ts
- All existing auto-capture tests still pass
- Venv detection order verified: ./venv → ./.venv → ./gyoshu/venv

### LEARNINGS
- [PROMOTE:PAT] Pattern: Async venv creation with sync detection
  - Evidence: python-repl.ts:326-530 (detectExistingPythonEnv is sync, createGyoshuVenv is async)
  - Use case: Fast detection, slow creation only when needed
- [PROMOTE:CONV] Convention: Marker files for one-time initialization
  - Evidence: python-repl.ts:493-497 (.gyoshu-initialized prevents reinstalling)
  - Pattern: Write marker after successful init, check marker before doing work
- [PROMOTE:CONV] Convention: Platform-agnostic paths for venv
  - Evidence: python-repl.ts:341-343 (isWindows check for Scripts vs bin)
  - Windows: Scripts/python.exe, Unix: bin/python
- [PROMOTE:GOTCHA] Problem: Package installation can timeout
  - Symptoms: First-time venv creation hangs
  - Solution: Use 5-minute timeout for pip install, continue even if packages fail

Time taken: ~20 minutes

---

[2026-01-01 21:30] - Task 11.5 Enhancement: Multi-tool Python Environment Support

### DISCOVERED ISSUES
- No pre-existing issues discovered
- The codebase already had detection logic for uv, poetry, conda but was missing creation logic
- Tool availability was not being checked before attempting to use a tool

### IMPLEMENTATION DECISIONS
- Added `detectAvailableTools()` function to check which tools (uv, poetry, conda, python) are installed
- Implemented caching for tool detection to avoid repeated shell calls
- Added creation functions for each environment manager:
  - `createEnvironmentWithUv()`: Uses `uv venv` + `uv pip install`
  - `createEnvironmentWithPoetry()`: Uses `poetry init` + `poetry add`
  - `createEnvironmentWithConda()`: Uses `conda create -n gyoshu-{project}`
- Created `createEnvironmentWithBestTool()` that tries tools in priority order: uv → poetry → conda → venv
- Added fallback behavior: if preferred tool fails, tries next tool in chain
- Extended PythonEnvironment interface with `envName` (for conda) and `tool` fields
- Exported `detectAvailableTools` and `resetToolCache` for testing

### PROBLEMS FOR NEXT TASKS
- Task 12 (jogyo agent) should leverage the `pythonEnv.created` flag to inform user of first-time setup
- If uv or poetry is used for creation, the environment is still at ./gyoshu/venv (consistent location)
- For poetry, the environment is managed in ./gyoshu/ subdirectory (poetry project)
- Conda creates a named environment (gyoshu-{projectname}) which may be unexpected for users

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Added: 8 new tests in tests/venv-isolation.test.ts
- Tool detection shows: uv=true, poetry=true, conda=false, python=true (system-specific)
- All existing tests continue to pass

### LEARNINGS
- [PROMOTE:CMD] Command verified: `uv venv <path>` - creates venv, `uv pip install --python <path> <packages>`
  - Context: uv is 10-100x faster than pip for package installation
  - Output: Creates standard venv structure compatible with direct Python calls
- [PROMOTE:CMD] Command verified: `poetry init -n && poetry add <packages>`
  - Context: Poetry creates both pyproject.toml and installs packages
  - Get env path: `poetry env info -p`
- [PROMOTE:CMD] Command verified: `conda create -n <name> python <packages> -y`
  - Context: Creates named environment in conda's env directory
  - Get python path: `conda run -n <name> which python`
- [PROMOTE:PAT] Pattern: Tool availability caching with reset function for testing
  - Evidence: python-repl.ts:76-113 (cachedAvailableTools + resetToolCache)
  - Use case: Avoid repeated shell calls for tool detection
- [PROMOTE:PAT] Pattern: Fallback chain for environment creation
  - Evidence: python-repl.ts:742-778 (createEnvironmentWithBestTool)
  - If preferred tool fails, try next tool in priority order

Time taken: ~25 minutes

---

[2026-01-01 22:45] - Task 3: Create readme-index.ts library

### DISCOVERED ISSUES
- No pre-existing issues discovered in the codebase
- Existing patterns from notebook-frontmatter.ts were clear and easy to follow
- Project follows consistent section separator convention (`// ===...`)

### IMPLEMENTATION DECISIONS
- Implemented sentinel block parsing using regex with named capture groups
- Sentinel format: `<!-- GYOSHU:{NAME}:BEGIN -->` ... `<!-- GYOSHU:{NAME}:END -->`
- Used Map<string, string> for storing parsed blocks (name → content)
- `updateSentinelBlock()` either replaces existing block or appends at end if not found
- Workspace table includes: link, project count, active count, last updated date
- Research table includes: link, status, updated, tags, description
- Tags sorted alphabetically and formatted with backticks
- Date formatting extracts YYYY-MM-DD from ISO timestamps
- `toDisplayName()` converts folder names (e.g., "customer-analytics" → "Customer Analytics")

### PROBLEMS FOR NEXT TASKS
- Task 4 (notebook-writer.ts update) can use this library for README generation
- Task 7 (research-manager.ts refactor) should call generateWorkspaceReadme() when scanning notebooks
- Task 10 (workspace management) should use generateRootReadme() for workspace listing

### VERIFICATION RESULTS
- Ran: bun test ./.opencode/lib/readme-index.test.ts (44 pass, 0 fail, 111 expect() calls)
- Ran: bun test (163 pass, 0 fail, 327 expect() calls - no regressions)
- Created: .opencode/lib/readme-index.ts (~460 lines)
- Created: .opencode/lib/readme-index.test.ts (~540 lines)
- All functions tested: parseReadmeWithSentinels, hasSentinelBlock, updateSentinelBlock, generateRootReadme, generateWorkspaceReadme, toDisplayName, parseTags

### LEARNINGS
- [PROMOTE:PAT] Pattern: Sentinel blocks for preserving user content in auto-generated files
  - Evidence: readme-index.ts:63-67 (SENTINEL_PATTERN regex)
  - Use case: Update auto-generated tables/lists without overwriting user customizations
- [PROMOTE:CONV] Convention: Map<string, string> for named content extraction from markdown
  - Evidence: readme-index.ts:88-100 (parseReadmeWithSentinels returns Map)
  - Clean API: blocks.get("INDEX"), blocks.has("TAGS")
- [PROMOTE:PAT] Pattern: Regex with `lastIndex = 0` reset before global matching
  - Evidence: readme-index.ts:90 (SENTINEL_PATTERN.lastIndex = 0)
  - Prevents state pollution when same pattern used multiple times
- [PROMOTE:CMD] Command verified: `bun test ./.opencode/lib/readme-index.test.ts`
  - Context: Run from project root to test specific lib file
  - Output: 44 pass, 0 fail

Time taken: ~15 minutes

[2026-01-01 04:30] - Task 16: Create migration tool for existing research

### DISCOVERED ISSUES
- No pre-existing issues discovered
- No research data exists in gyoshu/research/ yet (project uses notebook-centric structure)
- paths.ts already exports getNotebookRootDir() and getOutputsRootDir() from previous tasks

### IMPLEMENTATION DECISIONS
- Added two new actions to migration-tool.ts: `scan-research` and `migrate-to-notebooks`
- Target workspace is `_migrated` (underscore prefix sorts first, indicates migrated content)
- Slug uses researchId directly (maintains ID mapping between old and new structure)
- Uses ensureFrontmatterCell() from notebook-frontmatter.ts for consistent frontmatter handling
- Maps legacy RunStatus to frontmatter RunStatus (IN_PROGRESS/PENDING → "in_progress", COMPLETED → "completed", others → "failed")
- Adds "migrated-from-legacy-research" tag to all migrated notebooks for easy identification
- NEVER deletes source data (consistent with existing migration-tool behavior)
- Supports both --dry-run mode and single-research migration via sessionId parameter

### PROBLEMS FOR NEXT TASKS
- Task 17 (Update documentation) should document the new migration path
- README.md should mention `/gyoshu migrate --to-notebooks` as available option
- If users have both legacy sessions AND research projects, they should run:
  1. `/gyoshu migrate` first (legacy sessions → research)
  2. `/gyoshu migrate --to-notebooks` second (research → notebooks)

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Tool loads correctly: tested with `bun -e "import tool from './.opencode/tool/migration-tool.ts'"`
- scan-research action: Returns correctly formatted empty result when no research exists
- migrate-to-notebooks action: Returns correctly formatted empty result when no research exists
- Modified: .opencode/tool/migration-tool.ts (~400 lines added)
- Modified: .opencode/command/gyoshu.md (added Path B documentation for --to-notebooks)

### LEARNINGS
- [PROMOTE:PAT] Pattern: Dual migration paths for progressive migration
  - Evidence: migration-tool.ts has legacy→research (migrate) and research→notebooks (migrate-to-notebooks)
  - Use case: Users can migrate incrementally, maintaining backups at each step
- [PROMOTE:CONV] Convention: Migration target workspace uses underscore prefix (_migrated)
  - Evidence: migration-tool.ts:531 workspace = "_migrated"
  - Underscore prefix sorts first in directory listings, clearly indicates migrated content
- [PROMOTE:PAT] Pattern: Reuse existing frontmatter helpers for consistent notebook metadata
  - Evidence: migration-tool.ts imports ensureFrontmatterCell from notebook-frontmatter.ts
  - Avoids duplicating frontmatter handling logic

Time taken: ~20 minutes

[2026-01-01 23:45] - Tasks 14 & 15: Update agents for notebook-centric workflow

### DISCOVERED ISSUES
- No pre-existing issues discovered
- Both agent files had clean structure with clear sections to extend
- All tool implementations (python-repl, research-manager, notebook-writer) already supported workspace+slug parameters

### IMPLEMENTATION DECISIONS
- Added "Notebook-Centric Workflow" section to jogyo.md (~120 lines):
  - Research location (notebooks/{workspace}/{slug}.ipynb)
  - Using python-repl with autoCapture, workspace, slug, runId
  - Cell tagging table with all gyoshu-* tags
  - Frontmatter updates documentation
  - Workflow integration example
- Added "Notebook-Centric Architecture" section to gyoshu.md:
  - Directory structure diagram
  - Workspace management commands (workspace-list, workspace-create, workspace-sync)
- Updated "Discovery Before New Research" in gyoshu.md:
  - Now includes workspace listing step
  - Shows workspace context in results display
  - Added workspace suggestions for one-offs vs topical
- Updated "Starting New Research" in gyoshu.md:
  - Uses workspace+slug based creation
  - Shows notebook+outputs directory creation
  - Includes legacy mode for backwards compatibility
- Updated "Continuing Research" in gyoshu.md:
  - Uses notebook frontmatter for state
  - Shows workspace+slug context in @jogyo delegation
- Added workspace subcommands to Commands table
- Updated AUTO mode examples to use workspace+slug approach

### PROBLEMS FOR NEXT TASKS
- Task 16 (migration tool) should migrate legacy research.json to notebook frontmatter
- Task 17 (documentation) should update AGENTS.md with new notebook structure
- Consider adding /gyoshu workspace commands to gyoshu.md command file as well

### VERIFICATION RESULTS
- Ran: bun test (163 pass, 0 fail, 327 expect() calls)
- Modified: .opencode/agent/jogyo.md (238 → ~360 lines)
- Modified: .opencode/agent/gyoshu.md (711 → ~790 lines)
- Both agent files follow existing markdown patterns and section conventions

### LEARNINGS
- [PROMOTE:PAT] Pattern: Agent documentation uses tool API examples matching actual implementation
  - Evidence: jogyo.md shows python-repl with autoCapture, workspace, slug, runId
  - Evidence: gyoshu.md shows research-manager with workspace-list, workspace-create, workspace-sync
- [PROMOTE:CONV] Convention: Agent sections follow clear hierarchy with ### subsections
  - Evidence: jogyo.md "Notebook-Centric Workflow" has "Research Location", "Using python-repl", "Cell Tagging", etc.
- [PROMOTE:PAT] Pattern: Provide both new and legacy examples for backwards compatibility
  - Evidence: gyoshu.md shows "Example AUTO Initialization (Notebook-Centric)" and "(Legacy - still supported)"

Time taken: ~15 minutes

