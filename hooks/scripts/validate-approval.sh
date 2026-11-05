#!/usr/bin/env bash
# PreToolUse hook for the write tools. Asks the awesome-seo CLI (npm package @karailker/awesome-seo-core) whether an
# approved, unexpired proposal exists for this exact payload.
#
# Fails closed. Exit 0 allows the call. Exit 2 blocks it. Any other result of the check (npx missing, no network,
# a crash) is turned into a block, because Claude Code treats other exit codes as non-blocking.
#
# AWESOME_SEO_CLI overrides the command (used by tests and local development).
set -u
CLI="${AWESOME_SEO_CLI:-npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo}"
input="$(cat)"
err="$(printf '%s' "$input" | $CLI approval check-hook 2>&1 >/dev/null)"
rc=$?
case "$rc" in
  0) exit 0 ;;
  2) printf '%s\n' "$err" >&2; exit 2 ;;
  *) printf 'Blocked: approval check could not run (exit %s). %s\n' "$rc" "$err" >&2; exit 2 ;;
esac
