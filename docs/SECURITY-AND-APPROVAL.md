# Security and approval

Status: the approval gate, hook, and write tools are implemented and live-tested (2026-11-05). Evaluation gates (P11) are not implemented yet.

## Credentials

| Source | Auth | Where the secret lives | Notes |
|---|---|---|---|
| Search Console, GA4 | Service account JSON key | Key file outside the repo, path in `GOOGLE_SERVICE_ACCOUNT_KEY_FILE`. Used for GSC (webmasters.readonly; webmasters for submit) and GA4 (analytics.readonly). | Property access must be granted to the service account email. |
| Merchant Center | Service account (planned) | Same key file. | Deferred (P9). The project must be linked to the Merchant Center account. |
| Yandex Metrica, Yandex Webmaster | OAuth token from a registered Yandex app | `~/.config/awesome-seo/yandex.env` (mode 600): `YANDEX_METRICA_TOKEN`, `YANDEX_WEBMASTER_TOKEN`, `YANDEX_METRICA_COUNTER_ID`. Client ID and secret are kept there too. | The token needs the metrika:read and webmaster permissions granted in the app. |
| Bing Webmaster | API key | `~/.config/awesome-seo/bing.env` (mode 600): `BING_WEBMASTER_API_KEY`. | Sent as a query parameter (the API's only method). Never in errors or files. |
| PageSpeed Insights, CrUX | API keys | `~/.config/awesome-seo/performance.env` (mode 600): `PAGESPEED_API_KEY`, `CRUX_API_KEY`. | The key's project must have the API enabled and the key's restrictions must allow it. |

Rules:
- Priority: a file outside the repo, mode 600, loaded into the environment. A plain `.env` is allowed for development only and is git-ignored.
- SQLite stores only the name of a credential, never the value.
- Logs, tool outputs, errors, and written files never contain keys, tokens, or secrets. Errors carry stable codes, not upstream response bodies.
- `.env.example` lists variable names only.
- `*_health` tools report presence, never values.

## Approval model

Write actions are never executed without an approved proposal. Flow:

```
Agent (or user) proposes ──► action_proposals (pending, payload hash stored)
                                     │
User runs /approve-action ───────────┤
                                     ├── rejected ──► end
                                     └── approved (approvals row with the hash)
                                             │
PreToolUse hook: proposal approved, not expired, approval hash == payload hash, target matches
                                             │
                                     write tool runs (returns its own startedAt and finishedAt)
                                             │
                     read tool verifies the remote state (verification JSON)
                                             │
                     execution_logs row (outcome, times, verification or error); proposal → executed or failed
```

Rules:
1. Approval is per proposal, per target, per payload. It does not carry over.
2. If the payload changes, the hash no longer matches. A new proposal and approval are needed.
3. Expired proposals cannot run (default lifetime 24 hours).
4. After a run, the remote state is read back and the result is recorded. A write is complete only when verified and recorded.
5. Failed writes are never retried automatically. The user decides.
6. Reads, analysis, and recommendations need no approval. Preparing a write creates a proposal only.
7. The record command needs the call's real start and finish times. It never uses the time the record was written.

Risk levels: `gsc_submit_sitemap`, `yandex_webmaster_add_sitemap`, `bing_submit_url` are low. `merchant_update_product` (deferred) is medium.

## Hooks

- `hooks/hooks.json` registers a PreToolUse hook on the three write tool names.
- `hooks/hooks.json` runs the script through `bash`, so the hook does not depend on the file's execute bit (it is also committed as executable).
- `hooks/scripts/validate-approval.sh` runs `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo approval check-hook` (or `AWESOME_SEO_CLI` in tests). The check reads the tool name and input from stdin, finds the matching proposal in SQLite, and exits 0 (allow) or 2 (block, with the reason on stderr).
- Fail closed: an unknown tool, malformed input, a missing node, or a database error blocks the call.
- Tested: hook-level tests run the real script (7 cases in `packages/core/src/approval/hook.test.ts`). A headless Claude Code session confirmed a blocked call and an allowed call.

## Crawler and fetch policy

- robots.txt is checked for every host and every redirect hop. If it cannot be read, access is unknown, and the crawler does not treat the URL as allowed.
- Per-host rate limit: 1 request per second. Faster needs confirmation.
- Identifiable User-Agent. The contact URL comes from `AWESOME_SEO_CONTACT_URL`.
- No authentication bypass, no form submission, no CAPTCHA handling.
- Raw HTML storage is off by default (`store_raw_html`).

## Data retention

- Observations: kept by default. A retention setting can prune by age later.
- Raw HTML (when enabled): pruned after 30 days. Not pruned automatically yet.
- Credentials: removed by hand. A `scripts/` command is planned.

## Output and privacy

- Reports must not include secrets, raw tokens, or service account details.
- Analytics: aggregates only. Individual-user and session dimensions are refused by the GA4 and Metrica tools.
- Search queries and URLs appear in reports because they are part of the site's own data.

## Evaluation gates (P11, not implemented)

Before a report is written:
- Every finding has at least one evidence row (enforced in code by `validateFindings`).
- Confidence labels match the evidence (planned).
- Missing sources are listed in the report (implemented).
- Lab and field performance data are not mixed (implemented; separate names).
