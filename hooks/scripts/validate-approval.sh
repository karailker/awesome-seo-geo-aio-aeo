#!/usr/bin/env bash
# PreToolUse hook for write tools. Reads the event on stdin and asks core whether an approved, unexpired
# proposal exists for this exact payload. Fails closed: any error blocks the call (exit 2).
set -u
ROOT="${CLAUDE_PLUGIN_ROOT:-$(cd "$(dirname "$0")/../.." && pwd)}"
if ! command -v node >/dev/null 2>&1; then
  echo "Blocked: node is not available for the approval check." >&2
  exit 2
fi
exec node "$ROOT/scripts/approval.ts" check-hook
