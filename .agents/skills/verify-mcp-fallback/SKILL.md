---
name: verify-mcp-fallback
description: Verify MCP-referencing skills include resilient fallback behavior and avoid hard blockers
argument-hint: "[optional: --strict]"
---

# Verify MCP Fallback

## Purpose

Ensure MCP-dependent skill text remains resilient and does not block execution when MCP is unavailable.

Checks:

1. MCP-referencing skills state a fallback path
2. Deprecated hard-gating wording is not present
3. Preferred direct MCP tool naming is consistent

## When to Run

- After editing skills that mention Codex/Gemini MCP tools
- After MCP routing policy updates
- Before publishing skill packs

## Related Files

| File | Purpose |
|------|---------|
| `.agents/skills/*/SKILL.md` | Primary skill definitions |
| `.claude/skills/*/SKILL.md` | Mirror skill definitions |
| `.omc/mcp-skill-replacement-matrix.md` | Policy reference |

## Workflow

### Step 1 - Discover MCP-referencing skills

Find skills containing any of these markers:

- `ask_codex`
- `ask_gemini`
- `oh-my-claudecode_x_ask_codex`
- `oh-my-claudecode_g_ask_gemini`
- `mcp__x__ask_codex`
- `mcp__g__ask_gemini`

### Step 2 - Verify fallback statement exists

For each matched file, require one of these fallback intents:

- `If MCP tools are unavailable`
- `fall back to`
- `never block on external tools`

Fail when MCP usage is described without fallback behavior.

### Step 3 - Detect hard-blocking legacy wording

Fail if text contains mandatory ToolSearch preconditions that block execution.

(Informational references are fine; mandatory blocking phrasing is not.)

### Step 4 - Report

Output pass/fail with file-level findings.

## Output Format

```markdown
## verify-mcp-fallback report

| File | Result | Issue |
|------|--------|-------|
| .agents/skills/plan/SKILL.md | PASS | - |
| .agents/skills/foo/SKILL.md | FAIL | MCP mention without fallback |
```

## Exceptions

1. Historical changelog snippets in examples are informational and non-blocking
2. Non-executable comments are warnings, not failures
3. Files with no MCP references are out of scope
