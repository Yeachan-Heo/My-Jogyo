#!/usr/bin/env python3

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Iterable, List, Sequence, Tuple


@dataclass
class CheckResult:
    name: str
    status: str
    issues: int
    warnings: int


def read_json(path: Path) -> dict:
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}


def should_ignore(path_text: str, patterns: Sequence[str]) -> bool:
    return any(fnmatch.fnmatch(path_text, pat) for pat in patterns)


def discover_skill_files(root: Path, ignore_patterns: Sequence[str]) -> List[Path]:
    out: List[Path] = []
    for fp in sorted(list((root / ".agents" / "skills").glob("*/SKILL.md")) + list((root / ".claude" / "skills").glob("*/SKILL.md"))):
        rel = str(fp.relative_to(root))
        if not should_ignore(rel, ignore_patterns):
            out.append(fp)
    return out


def parse_agent_roles(root: Path) -> set[str]:
    roles: set[str] = set()
    agents_md = root / "AGENTS.md"
    claude_md = root / ".claude" / "CLAUDE.md"
    if agents_md.exists():
        txt = agents_md.read_text(encoding="utf-8", errors="ignore")
        roles.update(re.findall(r"/prompts:([a-z][a-z0-9-]+)", txt))
    if claude_md.exists():
        txt = claude_md.read_text(encoding="utf-8", errors="ignore")
        m = re.search(r"<agent_catalog>(.*?)</agent_catalog>", txt, re.S)
        section = m.group(1) if m else txt
        roles.update(re.findall(r"- `([a-z][a-z0-9-]+)`", section))
    return roles


def run_frontmatter_check(root: Path, files: Sequence[Path]) -> Tuple[CheckResult, List[Tuple[str, str, str, str]]]:
    findings: List[Tuple[str, str, str, str]] = []
    warnings = 0
    grouped: Dict[str, List[Path]] = {}

    for fp in files:
        rel = str(fp.relative_to(root))
        txt = fp.read_text(encoding="utf-8", errors="ignore")
        fm = re.match(r"^---\n(.*?)\n---\n", txt, re.S)
        if not fm:
            findings.append(("verify-skill-frontmatter", rel, "Missing YAML frontmatter block", "Add a valid YAML frontmatter block"))
            continue
        block = fm.group(1)
        m_name = re.search(r"^name:\s*(.+)$", block, re.M)
        m_desc = re.search(r"^description:\s*(.+)$", block, re.M)
        if not m_name:
            findings.append(("verify-skill-frontmatter", rel, "Missing frontmatter key: name", "Add `name:` key"))
            continue
        if not m_desc:
            findings.append(("verify-skill-frontmatter", rel, "Missing frontmatter key: description", "Add `description:` key"))
        declared = m_name.group(1).strip().strip('"').strip("'")
        if declared != fp.parent.name:
            findings.append(("verify-skill-frontmatter", rel, f"name-directory mismatch: name={declared}, dir={fp.parent.name}", "Align frontmatter `name` with directory name"))
        grouped.setdefault(declared, []).append(fp)

    for name, paths in sorted(grouped.items()):
        if len(paths) > 1:
            hashes = {hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
            if len(hashes) > 1:
                warnings += 1
                findings.append(("verify-skill-frontmatter", f"skill:{name}", "WARN: Cross-root drift detected", "Synchronize mirror copies if behavior should match"))

    issues = sum(1 for f in findings if "WARN:" not in f[2])
    result = CheckResult("verify-skill-frontmatter", "PASS" if issues == 0 else "FAIL", issues, warnings)
    return result, findings


def run_mcp_fallback_check(root: Path, files: Sequence[Path], ignored_skills: Sequence[str]) -> Tuple[CheckResult, List[Tuple[str, str, str, str]]]:
    findings: List[Tuple[str, str, str, str]] = []
    warnings = 0
    markers = [
        "ask_codex",
        "ask_gemini",
        "oh-my-claudecode_x_ask_codex",
        "oh-my-claudecode_g_ask_gemini",
        "mcp__x__ask_codex",
        "mcp__g__ask_gemini",
    ]
    fallback_markers = [
        "If MCP tools are unavailable",
        "fall back to",
        "never block on external tools",
        "fallback",
    ]

    for fp in files:
        skill_name = fp.parent.name
        if skill_name in ignored_skills:
            continue
        rel = str(fp.relative_to(root))
        txt = fp.read_text(encoding="utf-8", errors="ignore")
        if any(m in txt for m in markers):
            if "Before first MCP tool use" in txt and "ToolSearch(\"mcp\")" in txt:
                findings.append(("verify-mcp-fallback", rel, "Legacy ToolSearch hard-gating wording remains", "Remove mandatory ToolSearch gate and keep fallback path"))
            if not any(m in txt for m in fallback_markers):
                findings.append(("verify-mcp-fallback", rel, "MCP reference without explicit fallback behavior", "Add explicit fallback behavior to local specialist agents"))

    issues = len(findings)
    result = CheckResult("verify-mcp-fallback", "PASS" if issues == 0 else "FAIL", issues, warnings)
    return result, findings


def run_skill_sync_check(root: Path, required_skills: Sequence[str]) -> Tuple[CheckResult, List[Tuple[str, str, str, str]]]:
    findings: List[Tuple[str, str, str, str]] = []
    warnings = 0
    for name in required_skills:
        a = root / ".agents" / "skills" / name / "SKILL.md"
        c = root / ".claude" / "skills" / name / "SKILL.md"
        if not a.exists():
            findings.append(("verify-skill-sync", str(a.relative_to(root)), "Required source skill missing", "Create source-of-truth skill under .agents/skills"))
            continue
        if not c.exists():
            findings.append(("verify-skill-sync", str(c.relative_to(root)), "Required mirror skill missing", "Run scripts/sync-skills.py --sync"))
            continue
        if hashlib.sha256(a.read_bytes()).hexdigest() != hashlib.sha256(c.read_bytes()).hexdigest():
            findings.append(("verify-skill-sync", f"{a.relative_to(root)} <-> {c.relative_to(root)}", "Mirror drift detected", "Run scripts/sync-skills.py --sync"))

    issues = len(findings)
    result = CheckResult("verify-skill-sync", "PASS" if issues == 0 else "FAIL", issues, warnings)
    return result, findings


def run_agent_reference_check(root: Path, files: Sequence[Path], ignore_roles: Sequence[str]) -> Tuple[CheckResult, List[Tuple[str, str, str, str]]]:
    findings: List[Tuple[str, str, str, str]] = []
    warnings = 0
    valid_roles = parse_agent_roles(root)
    ignore_set = set(ignore_roles)

    patterns = [
        r"subagent_type=\"oh-my-codex:([a-z][a-z0-9-]+)\"",
        r"subagent_type=\"oh-my-claudecode:([a-z][a-z0-9-]+)\"",
    ]

    for fp in files:
        rel = str(fp.relative_to(root))
        txt = fp.read_text(encoding="utf-8", errors="ignore")
        refs: set[str] = set()
        for pat in patterns:
            refs.update(re.findall(pat, txt))
        for role in sorted(refs):
            if role in ignore_set:
                continue
            if role not in valid_roles:
                warnings += 1
                findings.append(("verify-agent-reference", rel, f"WARN: Unknown agent role reference `{role}`", "Confirm role exists in agent catalog or add to ignore list"))

    issues = 0
    result = CheckResult("verify-agent-reference", "PASS", issues, warnings)
    return result, findings


def make_report_path(root: Path, report: str | None) -> Path:
    if report:
        return Path(report)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return root / ".omc" / "reports" / "skills" / f"verify-{stamp}.md"


def main() -> int:
    parser = argparse.ArgumentParser(description="Run local skill verification checks")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    parser.add_argument("--report", type=str, default=None, help="Custom markdown report path")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    exemptions = read_json(root / ".omc" / "skill-verify-exemptions.json")
    manifest = read_json(root / ".omc" / "skill-sync-manifest.json")

    ignore_paths = exemptions.get("ignore_path_globs", [])
    ignore_mcp = exemptions.get("ignore_skills_for_mcp_fallback", [])
    ignore_roles = exemptions.get("ignore_unknown_agent_roles", [])
    required_skills = manifest.get("required_mirror_skills", [])

    files = discover_skill_files(root, ignore_paths)

    checks: List[CheckResult] = []
    findings: List[Tuple[str, str, str, str]] = []

    r, f = run_frontmatter_check(root, files)
    checks.append(r)
    findings.extend(f)

    r, f = run_mcp_fallback_check(root, files, ignore_mcp)
    checks.append(r)
    findings.extend(f)

    r, f = run_skill_sync_check(root, required_skills)
    checks.append(r)
    findings.extend(f)

    r, f = run_agent_reference_check(root, files, ignore_roles)
    checks.append(r)
    findings.extend(f)

    total_fail = sum(c.issues for c in checks)
    total_warn = sum(c.warnings for c in checks)
    overall = "PASS"
    if total_fail > 0:
        overall = "FAIL"
    elif args.strict and total_warn > 0:
        overall = "FAIL"

    report_path = make_report_path(root, args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    lines: List[str] = []
    lines.append("# Skill Verification Report")
    lines.append("")
    lines.append(f"Run date: {datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"Strict mode: {args.strict}")
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append("| Check | Status | Issues | Warnings |")
    lines.append("|---|---|---|---|")
    for c in checks:
        lines.append(f"| `{c.name}` | {c.status} | {c.issues} | {c.warnings} |")

    lines.append("")
    lines.append("## Findings")
    lines.append("")
    if findings:
        lines.append("| # | Check | File | Issue | Suggested Fix |")
        lines.append("|---|---|---|---|---|")
        for i, (check_name, file_name, issue, fix) in enumerate(findings, start=1):
            lines.append(f"| {i} | `{check_name}` | `{file_name}` | {issue} | {fix} |")
    else:
        lines.append("- No active findings.")

    lines.append("")
    lines.append(f"## Overall: {overall}")
    lines.append(f"- Total failures: **{total_fail}**")
    lines.append(f"- Total warnings: **{total_warn}**")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(str(report_path))

    return 0 if overall == "PASS" else 2


if __name__ == "__main__":
    raise SystemExit(main())
