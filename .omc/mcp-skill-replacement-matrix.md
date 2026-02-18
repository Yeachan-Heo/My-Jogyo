# MCP vs Skill Replacement Matrix

Generated: 2026-02-18

## Goal

Define where local skills can replace MCP-dependent flows, and where MCP remains preferred.

## Summary

- High replacement: plan/review/security/code-quality workflows
- Partial replacement: external docs freshness, large-context visual critique
- Low replacement: provider-specific remote API operations where MCP gives stronger contracts

## Operating Policy

- Default: **skill-first**
- Escalate to MCP only when:
  1. Independent high-severity second opinion is required
  2. External-source authority/currentness is required
  3. Large multimodal context is required

## Quick Matrix

| Capability | Skill-First Path | MCP Escalation Trigger |
|---|---|---|
| Architecture/plan validation | `plan`, `review`, `analyze` | Cross-check for high-risk design changes |
| Code/security review | `code-review`, `security-review` | CRITICAL/HIGH risk uncertainty |
| UI/UX critique | `frontend-ui-ux` | Large-context visual sweep needed |
| External docs lookup | `dependency-expert`, `research` | Fast-moving API behavior ambiguity |
| Web/current events | `research` | Time-sensitive source validation |
