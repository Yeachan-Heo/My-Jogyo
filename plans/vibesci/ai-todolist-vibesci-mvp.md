# VibeSci MVP Implementation Plan

**Goal**: Build VibeSci - a generic scientific research agent platform extracted from VibeQuant

**Source Reference**: `../VibeQuant/vibequant/pydantic_ai/agents/`

**Session Storage**: `~/.vibesci/sessions/{session-id}/`

---

## Phase 1: Core Foundation (MVP)

### 1. Project Scaffolding
- [ ] 1.1 Create project structure with pyproject.toml
  - **Parallelizable**: NO (foundation for all other tasks)
  - **Files**: `pyproject.toml`, `README.md`, `vibesci/__init__.py`, `vibesci/py.typed`
  - **Details**: Poetry config with dependencies (pydantic>=2.0, pydantic-ai>=1.33, psutil, matplotlib, numpy, pandas)
  - **Reference**: Check VibeQuant's pyproject.toml for dependency patterns

### 2. Marker Taxonomy Module
- [ ] 2.1 Create marker taxonomy with universal scientific markers
  - **Parallelizable**: YES (with 2.2)
  - **Files**: `vibesci/markers/__init__.py`, `vibesci/markers/taxonomy.py`
  - **Details**: MarkerCategory enum (RESEARCH_PROCESS, DATA_OPERATIONS, CALCULATIONS, ARTIFACTS, INSIGHTS, WORKFLOW, SCIENTIFIC), Marker dataclass, MarkerTaxonomy class with get_markers() and classify_line()
  - **Markers**: OBJECTIVE, HYPOTHESIS, EXPERIMENT, OBSERVATION, ANALYSIS, CONCLUSION, DATA, SHAPE, DTYPE, RANGE, MISSING, MEMORY, CALC, METRIC, STAT, CORR, PLOT, ARTIFACT, TABLE, FINDING, INSIGHT, PATTERN, STEP, CHECK, INFO, WARNING, ERROR, CITATION, LIMITATION, NEXT_STEP, DECISION

- [ ] 2.2 Create marker parser for extracting markers from text
  - **Parallelizable**: YES (with 2.1)
  - **Files**: `vibesci/markers/parser.py`
  - **Details**: MarkerParser class with extract_markers(text) -> List[ParsedMarker], get_summary() -> Dict, ParsedMarker dataclass with (marker, category, content, line_number)
  - **Reference**: VibeQuant's output classification patterns

### 3. Structured Output Capture
- [ ] 3.1 Create StructuredOutputCapture class
  - **Parallelizable**: NO (depends on 2.1 taxonomy)
  - **Files**: `vibesci/tools/__init__.py`, `vibesci/tools/output_capture.py`
  - **Details**: StringIO subclass that enforces marker prefixes, max_length truncation, auto-classification of unmarked lines, get_summary() for marker counts
  - **Reference**: VibeQuant's `StructuredOutputCapture` in research.py

### 4. Python REPL Tool
- [ ] 4.1 Create safe Python REPL execution environment
  - **Parallelizable**: NO (depends on 3.1 output capture)
  - **Files**: `vibesci/tools/python_repl.py`
  - **Details**: PythonREPL class with initialize_scope(), execute(code, scope) -> ExecutionResult, timeout handling, memory management utilities (check_memory, clean_memory), structured output helpers (print_metric, print_finding, print_insight, print_conclusion)
  - **Reference**: VibeQuant's research.py execute_code patterns

### 5. Completion Tool
- [ ] 5.1 Create completion tool for signaling task completion
  - **Parallelizable**: YES (with 4.1)
  - **Files**: `vibesci/tools/completion.py`
  - **Details**: CompletionStatus enum (SUCCESS, PARTIAL, BLOCKED, FAILED), TaskCompletionResult dataclass with to_markdown() and is_terminal(), get_completion_tool_definition() for LLM tool schema, parse_completion_result()
  - **Reference**: VibeQuant's completion.py

### 6. Session Storage
- [ ] 6.1 Create session context and store classes
  - **Parallelizable**: YES (with 5.1, 4.1)
  - **Files**: `vibesci/context/__init__.py`, `vibesci/context/store.py`
  - **Details**: MessageRole enum, Message model, SessionContext model with add_message(), SessionStore class with create_session(), get_session(), save_session(), list_sessions(), file-based JSON storage
  - **Reference**: VibeQuant's context/store.py

- [ ] 6.2 Create markdown context file manager
  - **Parallelizable**: NO (depends on 6.1)
  - **Files**: `vibesci/context/markdown_files.py`
  - **Details**: MarkdownContextManager class with methods for research_request.md, notepad.md, todolist.md, findings.md, decisions.md, Task/Finding/Decision dataclasses
  - **Markdown Files**:
    - `research_request.md` - Original goal/objective
    - `notepad.md` - Planner's scratch space
    - `todolist.md` - Task breakdown and status
    - `findings.md` - Accumulated research findings
    - `decisions.md` - Key decisions with rationale

### 7. Base Agent Class
- [ ] 7.1 Create agent dependencies and base class
  - **Parallelizable**: NO (depends on 5.1 completion tool)
  - **Files**: `vibesci/agents/__init__.py`, `vibesci/agents/deps.py`, `vibesci/agents/base.py`
  - **Details**: AgentDeps dataclass, AgentConfig dataclass, AgentResult dataclass with tool_calls and usage, BaseVibeSciAgent[ResultT] generic class with register_tool(), _invoke_callback(), run()
  - **Reference**: VibeQuant's base.py agent patterns

### 8. Prompt Builder and Templates
- [ ] 8.1 Create prompt builder utility
  - **Parallelizable**: YES (with 7.1)
  - **Files**: `vibesci/prompts/__init__.py`, `vibesci/prompts/builder.py`
  - **Details**: PromptBuilder class with build_research_prompt(), convert_bracket_tags_to_xml(), append_utc_date_suffix()
  - **Reference**: VibeQuant's prompts/builder.py

- [ ] 8.2 Create research agent prompt template
  - **Parallelizable**: YES (with 8.1)
  - **Files**: `vibesci/prompts/templates/research.txt`
  - **Details**: Universal scientific research prompt (not quant-specific), role definition, operating rules, memory protocol, code execution mechanism, output structure with markers, completion signaling instructions
  - **Reference**: VibeQuant's prompts/research.txt (adapt for generic science)

### 9. Scientific Research Agent
- [ ] 9.1 Create ScientificResearchAgent implementation
  - **Parallelizable**: NO (depends on 7.1, 4.1, 5.1, 8.1, 8.2)
  - **Files**: `vibesci/agents/research.py`
  - **Details**: ScientificResearchAgent(BaseVibeSciAgent[str]) with generate_message(), _initialize_execution_scope(), _execute_code(), code generation loop, completion tool integration, anti-hallucination checks
  - **Reference**: VibeQuant's research.py ResearchAgentPydantic

### 10. Session Manager
- [ ] 10.1 Create session lifecycle manager
  - **Parallelizable**: NO (depends on 6.1, 6.2, 9.1)
  - **Files**: `vibesci/session/__init__.py`, `vibesci/session/manager.py`
  - **Details**: SessionManager class with create_session(), get_session(), list_sessions(), delete_session(), run_research(), Session dataclass, ResearchResult dataclass
  - **Integration**: Combines SessionStore, MarkdownContextManager, ScientificResearchAgent

### 11. CLI Interface
- [ ] 11.1 Create CLI commands with typer
  - **Parallelizable**: NO (depends on 10.1)
  - **Files**: `vibesci/cli/__init__.py`, `vibesci/cli/commands.py`
  - **Commands**: 
    - `vibesci research "goal"` - Run a research session
    - `vibesci sessions` - List all sessions
    - `vibesci session <id>` - View session details
    - `vibesci report <id>` - Generate report from session

### 12. Unit Tests
- [ ] 12.1 Create test configuration and fixtures
  - **Parallelizable**: YES (with 11.1)
  - **Files**: `tests/__init__.py`, `tests/conftest.py`
  - **Details**: Pytest fixtures for temporary directories, mock sessions, sample code snippets

- [ ] 12.2 Create marker module tests
  - **Parallelizable**: YES (with 12.1)
  - **Files**: `tests/test_markers.py`
  - **Coverage**: Taxonomy classification, parser extraction, summary generation

- [ ] 12.3 Create Python REPL tests
  - **Parallelizable**: YES (with 12.1)
  - **Files**: `tests/test_python_repl.py`
  - **Coverage**: Code execution, timeout handling, output capture, memory utilities

- [ ] 12.4 Create session store tests
  - **Parallelizable**: YES (with 12.1)
  - **Files**: `tests/test_session_store.py`
  - **Coverage**: Session CRUD, markdown file operations, persistence

- [ ] 12.5 Create completion tool tests
  - **Parallelizable**: YES (with 12.1)
  - **Files**: `tests/test_completion.py`
  - **Coverage**: Tool definition, result parsing, status handling

- [ ] 12.6 Create research agent integration tests
  - **Parallelizable**: NO (depends on all previous tests passing)
  - **Files**: `tests/test_research_agent.py`
  - **Coverage**: Basic research flow, code execution, completion, report generation

### 13. End-to-End Validation
- [ ] 13.1 Run full end-to-end test
  - **Parallelizable**: NO (final validation)
  - **Details**: Install package via poetry, run `vibesci research "analyze sample data"`, verify session created, verify report generated, verify artifacts saved
  - **Success Criteria**: 
    - Package installs cleanly
    - CLI runs without errors
    - Research agent executes Python code
    - Markers appear in output
    - Session persists to ~/.vibesci/sessions/
    - Completion tool triggers report

---

## Definition of Done

- [ ] All 13 task groups completed and functional
- [ ] `vibesci` package installs cleanly via poetry
- [ ] CLI `vibesci research "analyze X"` runs successfully
- [ ] Research agent executes Python code with markers
- [ ] Sessions persist to `~/.vibesci/sessions/`
- [ ] Completion tool triggers final report generation
- [ ] All unit tests pass (>80% coverage on core modules)
- [ ] No VibeQuant-specific code or imports
- [ ] No database dependencies (file-based only)

---

## Must NOT Include

- **NO** vibequant imports or trading-specific code
- **NO** database dependencies (MongoDB, Redis, PostgreSQL)
- **NO** web framework dependencies (Flask, FastAPI)
- **NO** quant-specific markers (SHARPE, STRATEGY, BACKTEST)
- **NO** alphapool, manifest, or strategy directories

---

## File Summary (22 files)

### Source Files (16):
1. `pyproject.toml`
2. `vibesci/__init__.py`
3. `vibesci/markers/__init__.py`
4. `vibesci/markers/taxonomy.py`
5. `vibesci/markers/parser.py`
6. `vibesci/tools/__init__.py`
7. `vibesci/tools/output_capture.py`
8. `vibesci/tools/python_repl.py`
9. `vibesci/tools/completion.py`
10. `vibesci/agents/__init__.py`
11. `vibesci/agents/deps.py`
12. `vibesci/agents/base.py`
13. `vibesci/agents/research.py`
14. `vibesci/context/__init__.py`
15. `vibesci/context/store.py`
16. `vibesci/context/markdown_files.py`
17. `vibesci/prompts/__init__.py`
18. `vibesci/prompts/builder.py`
19. `vibesci/prompts/templates/research.txt`
20. `vibesci/session/__init__.py`
21. `vibesci/session/manager.py`
22. `vibesci/cli/__init__.py`
23. `vibesci/cli/commands.py`

### Test Files (6):
24. `tests/__init__.py`
25. `tests/conftest.py`
26. `tests/test_markers.py`
27. `tests/test_python_repl.py`
28. `tests/test_session_store.py`
29. `tests/test_completion.py`
30. `tests/test_research_agent.py`

---

## Parallelization Summary

| Parallel Group | Tasks |
|----------------|-------|
| Group A | 2.1, 2.2 (marker taxonomy and parser) |
| Group B | 4.1, 5.1, 6.1 (REPL, completion, store) |
| Group C | 7.1, 8.1, 8.2 (base agent, prompts) |
| Group D | 12.1, 12.2, 12.3, 12.4, 12.5 (most tests) |
| Sequential | 1.1 -> 3.1 -> 9.1 -> 10.1 -> 11.1 -> 12.6 -> 13.1 |
