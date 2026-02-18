#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import shutil
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, List


@dataclass
class SkillStatus:
    name: str
    source_exists: bool
    mirror_exists: bool
    source_hash: str
    mirror_hash: str
    in_sync: bool
    action: str


def sha256_dir(path: Path) -> str:
    if not path.exists():
        return "-"
    digest = hashlib.sha256()
    for file_path in sorted([p for p in path.rglob("*") if p.is_file()]):
        digest.update(str(file_path.relative_to(path)).encode("utf-8"))
        digest.update(file_path.read_bytes())
    return digest.hexdigest()


def discover_skills(root: Path) -> Dict[str, Path]:
    out: Dict[str, Path] = {}
    if not root.exists():
        return out
    for p in sorted(root.iterdir()):
        if p.is_dir() and (p / "SKILL.md").exists():
            out[p.name] = p
    return out


def load_manifest(root: Path) -> List[str]:
    manifest = root / ".omc" / "skill-sync-manifest.json"
    if not manifest.exists():
        return []
    try:
        data = json.loads(manifest.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return []
    skills = data.get("required_mirror_skills", [])
    if isinstance(skills, list):
        return [str(x) for x in skills]
    return []


def make_report_path(root: Path, report: str | None) -> Path:
    if report:
        return Path(report)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    return root / ".omc" / "reports" / "skills" / f"sync-{stamp}.md"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Sync .agents/skills to .claude/skills"
    )
    parser.add_argument("--sync", action="store_true", help="Apply synchronization")
    parser.add_argument(
        "--check", action="store_true", help="Check-only mode (default)"
    )
    parser.add_argument(
        "--fail-on-drift",
        action="store_true",
        help="Return non-zero when drift exists in check mode",
    )
    parser.add_argument(
        "--delete-extra",
        action="store_true",
        help="Delete mirror skills that do not exist in source (sync mode only)",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process all source skills, ignoring manifest scope",
    )
    parser.add_argument(
        "--report", type=str, default=None, help="Custom markdown report path"
    )
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[1]
    src_root = root / ".agents" / "skills"
    dst_root = root / ".claude" / "skills"
    dst_root.mkdir(parents=True, exist_ok=True)

    check_mode = not args.sync
    src_skills = discover_skills(src_root)
    dst_skills = discover_skills(dst_root)
    manifest_scope = [] if args.all else load_manifest(root)

    if manifest_scope:
        scoped_src: Dict[str, Path] = {}
        for name in manifest_scope:
            src = src_skills.get(name)
            if src is not None:
                scoped_src[name] = src
            else:
                pass
        src_skills = scoped_src

    statuses: List[SkillStatus] = []
    drift_count = 0

    for name, src in sorted(src_skills.items()):
        dst = dst_skills.get(name, dst_root / name)
        src_hash = sha256_dir(src)
        dst_hash = sha256_dir(dst)
        mirror_exists = dst.exists()
        in_sync = mirror_exists and src_hash == dst_hash
        action = "NONE"

        if not mirror_exists:
            drift_count += 1
            action = "CREATE_MIRROR" if args.sync else "WOULD_CREATE_MIRROR"
            if args.sync:
                shutil.copytree(src, dst)
        elif not in_sync:
            drift_count += 1
            action = "SYNC_MIRROR" if args.sync else "WOULD_SYNC_MIRROR"
            if args.sync:
                shutil.rmtree(dst)
                shutil.copytree(src, dst)

        statuses.append(
            SkillStatus(
                name=name,
                source_exists=True,
                mirror_exists=mirror_exists,
                source_hash=src_hash[:12],
                mirror_hash=dst_hash[:12],
                in_sync=in_sync,
                action=action,
            )
        )

    if manifest_scope:
        missing_from_source = [
            name for name in manifest_scope if name not in src_skills
        ]
        for name in missing_from_source:
            statuses.append(
                SkillStatus(
                    name=name,
                    source_exists=False,
                    mirror_exists=(dst_root / name).exists(),
                    source_hash="-",
                    mirror_hash=sha256_dir(dst_root / name)[:12],
                    in_sync=False,
                    action="MISSING_SOURCE_SKILL",
                )
            )
            drift_count += 1

    extra_deleted = []
    if args.sync and args.delete_extra:
        for name, dst in sorted(dst_skills.items()):
            if name not in src_skills:
                shutil.rmtree(dst)
                extra_deleted.append(name)

    report_path = make_report_path(root, args.report)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    lines = []
    lines.append("# Skill Sync Report")
    lines.append("")
    lines.append(f"Run date: {datetime.now().isoformat(timespec='seconds')}")
    lines.append(f"Mode: {'SYNC' if args.sync else 'CHECK'}")
    lines.append(f"Source of truth: `{src_root}`")
    lines.append(f"Mirror: `{dst_root}`")
    lines.append(
        f"Scope: {'ALL source skills' if args.all or not manifest_scope else 'Manifest-defined skills only'}"
    )
    lines.append("")
    lines.append("## Summary")
    lines.append("")
    lines.append(f"- Source skills: **{len(src_skills)}**")
    lines.append(f"- Mirror skills: **{len(dst_skills)}**")
    lines.append(f"- Drift detected: **{drift_count}**")
    if extra_deleted:
        lines.append(f"- Deleted extra mirror skills: **{len(extra_deleted)}**")
    lines.append("")
    lines.append("## Per-Skill Status")
    lines.append("")
    lines.append("| Skill | In Sync | Source Hash | Mirror Hash | Action |")
    lines.append("|---|---|---|---|---|")
    for s in statuses:
        lines.append(
            f"| `{s.name}` | {'YES' if s.in_sync else 'NO'} | `{s.source_hash}` | `{s.mirror_hash}` | {s.action} |"
        )

    if extra_deleted:
        lines.append("")
        lines.append("## Deleted Extra Mirror Skills")
        lines.append("")
        for name in extra_deleted:
            lines.append(f"- `{name}`")

    report_path.write_text("\n".join(lines), encoding="utf-8")
    print(str(report_path))

    if check_mode and args.fail_on_drift and drift_count > 0:
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
