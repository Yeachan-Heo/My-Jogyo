#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
mkdir -p "$ROOT/.git/hooks"
cp "$ROOT/.githooks/pre-commit" "$ROOT/.git/hooks/pre-commit"
cp "$ROOT/.githooks/pre-push" "$ROOT/.git/hooks/pre-push"
chmod +x "$ROOT/.git/hooks/pre-commit" "$ROOT/.git/hooks/pre-push"
printf "Installed local hooks to %s/.git/hooks\n" "$ROOT"
