#!/usr/bin/env bash
# Commit and push only when the full check is green. Usage: scripts/commit-phase.sh "message"
set -euo pipefail
cd "$(dirname "$0")/.."
bun x biome check --write . >/dev/null || true
if ! bun run check > out/check.log 2>&1; then
  tail -40 out/check.log
  echo "check is RED; not committing" >&2
  exit 1
fi
tail -8 out/check.log
git add -A
git commit -q -F - <<MSG
$1

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01JVUomah1rYF18yP91pkyW5
MSG
git push -q -u origin "$(git rev-parse --abbrev-ref HEAD)"
git log --oneline -1
