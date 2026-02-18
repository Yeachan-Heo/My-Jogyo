#!/usr/bin/env python3

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import re
import shutil
import subprocess
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, List, Sequence


def run_git_changed_files(root: Path) -> List[str]:
    commands = [
        ["git", "diff", "--name-only", "HEAD"],
    ]
    files: List[str] = []
    seen = set()
    for cmd in commands:
        try:
            out = subprocess.check_output(
                cmd, cwd=root, text=True, stderr=subprocess.DEVNULL
            )
        except Exception:
            continue
        for line in out.splitlines():
            line = line.strip()
            if line and line not in seen:
                seen.add(line)
                files.append(line)
    try:
        base = subprocess.check_output(
            ["git", "remote", "show", "origin"],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        branch = "main"
        for line in base.splitlines():
            if "HEAD branch" in line:
                branch = line.split(":", 1)[1].strip()
                break
        out = subprocess.check_output(
            ["git", "diff", "--name-only", f"{branch}...HEAD"],
            cwd=root,
            text=True,
            stderr=subprocess.DEVNULL,
        )
        for line in out.splitlines():
            line = line.strip()
            if line and line not in seen:
                seen.add(line)
                files.append(line)
    except Exception:
        pass
    return files


def fallback_changed_files(root: Path) -> List[str]:
    cutoff = datetime.now() - timedelta(days=2)
    out: List[str] = []
    scan_roots = [
        root / ".agents" / "skills",
        root / ".claude" / "skills",
        root / ".omc",
    ]
    for scan_root in scan_roots:
        if not scan_root.exists():
            continue
        for fp in sorted(scan_root.rglob("*")):
            if fp.is_file():
                if datetime.fromtimestamp(fp.stat().st_mtime) >= cutoff:
                    out.append(str(fp.relative_to(root)))
    return out


def filter_changed_files(paths: Sequence[str]) -> List[str]:
    ignore = [
        ".omc/reports/**",
        ".omc/state/**",
        ".omc/notepad.md",
        ".omc/skill-validation-summary-*.json",
        ".omc/verify-implementation-run-*.md",
        ".omc/skill-maintenance-dry-run.md",
        ".omc/skills-operations.md",
        "**/package-lock.json",
        "**/pnpm-lock.yaml",
        "**/yarn.lock",
        "**/bun.lock",
    ]
    out: List[str] = []
    for p in paths:
        if any(fnmatch.fnmatch(p, pat) for pat in ignore):
            continue
        out.append(p)
    return out


def discover_verify_skills(root: Path) -> Dict[str, Path]:
    paths = sorted(
        list((root / ".agents" / "skills").glob("verify-*/SKILL.md"))
        + list((root / ".claude" / "skills").glob("verify-*/SKILL.md"))
    )
    out: Dict[str, Path] = {}
    for p in paths:
        name = p.parent.name
        if name == "verify-implementation":
            continue
        if name not in out or "/.agents/" in str(p):
            out[name] = p
    return out


def extract_related_patterns(skill_path: Path) -> List[str]:
    txt = skill_path.read_text(encoding="utf-8", errors="ignore")
    start = txt.find("## Related Files")
    if start == -1:
        return []
    tail = txt[start:]
    next_section = tail.find("\n## ", len("## Related Files"))
    section = tail if next_section == -1 else tail[:next_section]
    patterns: List[str] = []
    for line in section.splitlines():
        m = re.match(r"^\|\s*`([^`]+)`\s*\|", line.strip())
        if m:
            pat = m.group(1)
            if "/" in pat or pat.startswith("."):
                patterns.append(pat)
    return list(dict.fromkeys(patterns))


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Analyze verify-skill coverage and optionally apply safe sync updates"
    )
    parser.add_argument(
        "--files",
        nargs="*",
        default=None,
        help="Explicit changed files relative to repo root",
    )
    parser.add_argument("--dry-run", action="store_true", help="Run analysis only")
    parser.add_argument(
        "--apply-safe",
        action="store_true",
        help="Apply safe updates (mirror sync only)",
    )
    parser.add_argument("--report", type=str, default=None, help="Custom report path")
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]

    changed = args.files if args.files else run_git_changed_files(root)
    if not changed:
        changed = fallback_changed_files(root)
    changed = filter_changed_files(changed)

    verify = discover_verify_skills(root)
    mapping: Dict[str, List[str]] = {f: [] for f in changed}
    stale: List[tuple[str, str]] = []
    related: Dict[str, List[str]] = {}

    for name, path in sorted(verify.items()):
        patterns = extract_related_patterns(path)
        related[name] = patterns
        for pat in patterns:
            if "*" not in pat and "?" not in pat and "[" not in pat:
                if not (root / pat).exists():
                    stale.append((name, pat))
        for f in changed:
            for pat in patterns:
                norm = pat[2:] if pat.startswith("./") else pat
                if fnmatch.fnmatch(f, norm):
                    mapping[f].append(name)
                    break

    actions: List[str] = []
    if args.apply_safe:
        for name in sorted(verify):
            src = root / ".agents" / "skills" / name / "SKILL.md"
            dst = root / ".claude" / "skills" / name / "SKILL.md"
            if not src.exists():
                continue
            dst.parent.mkdir(parents=True, exist_ok=True)
            if not dst.exists() or sha(src) != sha(dst):
                shutil.copy2(src, dst)
                actions.append(f"Synced mirror for `{name}`")

    report_path = (
        Path(args.report)
        if args.report
        else root
        / ".omc"
        / "reports"
        / "skills"
        / f"maintenance-{datetime.now().strftime('%Y%m%d-%H%M%S')}.md"
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)

    covered = [f for f, skills in mapping.items() if skills]
    uncovered = [f for f, skills in mapping.items() if not skills]

    lines: List[str] = []
    lines.append("# Skill Maintenance Report")
    lines.append("")
    lines.append(f"Run date: {datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"Mode: {'APPLY_SAFE' if args.apply_safe else 'DRY_RUN'}")
    lines.append("")
    lines.append("## Verify Skills")
    lines.append("")
    lines.append("| Skill | Source | Related Patterns |")
    lines.append("|---|---|---|")
    for name, path in sorted(verify.items()):
        pats = ", ".join(f"`{p}`" for p in related.get(name, [])) or "-"
        lines.append(f"| `{name}` | `{path.relative_to(root)}` | {pats} |")

    lines.append("")
    lines.append("## File Mapping")
    lines.append("")
    lines.append("| File | Status | Skill(s) |")
    lines.append("|---|---|---|")
    for f in changed:
        skills = mapping[f]
        lines.append(
            f"| `{f}` | {'COVERED' if skills else 'UNCOVERED'} | {', '.join(f'`{s}`' for s in skills) if skills else '-'} |"
        )

    lines.append("")
    lines.append("## Gap Summary")
    lines.append("")
    lines.append(f"- Covered files: **{len(covered)}**")
    lines.append(f"- Uncovered files: **{len(uncovered)}**")
    if uncovered:
        for f in uncovered:
            lines.append(f"  - `{f}`")

    lines.append("")
    lines.append("## Stale References")
    lines.append("")
    if stale:
        lines.append("| Skill | Reference |")
        lines.append("|---|---|")
        for s, ref in stale:
            lines.append(f"| `{s}` | `{ref}` |")
    else:
        lines.append("- None detected")

    lines.append("")
    lines.append("## Safe Apply Actions")
    lines.append("")
    if actions:
        for a in actions:
            lines.append(f"- {a}")
    else:
        lines.append("- No mirror sync changes applied")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(str(report_path))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
