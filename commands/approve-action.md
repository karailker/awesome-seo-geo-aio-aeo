---
description: Review pending write proposals and approve one, or reject it. Only the user approves. Write tools run only after an approved proposal for the exact payload exists.
argument-hint: "[proposal-id] | list | reject <proposal-id>"
---

Manage write proposals (sitemap submit, Bing URL submit). Rules: `docs/SECURITY-AND-APPROVAL.md`.

1. `list` (or no argument): run `pnpm approval list` and show each pending proposal: id, action, target, risk, expiry, description. Do not approve anything from this step.
2. For an id: show the proposal's action, target, and payload exactly as stored. Ask the user to confirm in their own words. Do not treat an earlier message as approval.
3. Only after the user confirms: run `pnpm approval approve <id>`. Approval is per proposal, per target, per payload. If the payload changes, a new proposal is needed.
4. Rejected: run `pnpm approval reject <id>`.
5. Execution (after approval): call the write tool with exactly the approved payload. The PreToolUse hook (`hooks/scripts/validate-approval.sh`) checks the proposal again and blocks the call if it is missing, changed, expired, or not approved. If the hook blocks, report its reason and stop.
6. Verify: read the remote state with the matching read tool (`google_gsc_list_sitemaps`, `yandex_webmaster_indexing`, or `bing_url_info`). Compare with the intended change.
7. Record: `pnpm approval record <id> --outcome success|failure --started-at <ISO> --finished-at <ISO>`. Use the start and finish times from the write tool's result (`startedAt`, `finishedAt`), not the time you type the command. Add the verification result (`--verification-file`) or the error (`--error-file`). Show the user the outcome. A write is not complete until it is verified and recorded.
8. Never retry a failed write automatically. Report the error and let the user decide.
