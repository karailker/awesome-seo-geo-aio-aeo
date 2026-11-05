# Security and approval

## Credentials

| Source | Auth | Where the secret lives | Notes |
|---|---|---|---|
| Search Console | service account | key file outside the repo, path in env var; or OS keychain | property must grant the service account access |
| GA4 | service account | same as above | property access required |
| Merchant Center | OAuth | token in OS keychain or encrypted file | `VERIFY:` API version |
| Yandex Webmaster | OAuth token | OS keychain or encrypted file | token expiry must be checked |
| Yandex Metrica | OAuth token | OS keychain or encrypted file | |
| Bing Webmaster | API key | OS keychain or encrypted file | |
| PageSpeed Insights | API key | OS keychain or encrypted file | |
| CrUX | API key | OS keychain or encrypted file | |

Rules:
- Priority: OS keychain. Fallback: encrypted local file with a key derived from a user passphrase or OS-provided key. Plain-text `.env` is allowed only for development and must be git-ignored.
- SQLite stores `connections.credential_ref` (a name), provider, scopes, and status. Never the secret.
- Logs and tool outputs redact anything that looks like a token or key.
- `.env.example` lists variable names only.
- `*_health` tools report whether a credential is present, never its value.

## Approval model

Write actions are never executed directly. They go through this flow:

```
Agent proposes ──► action_proposals (pending, payload hash stored)
                           │
User runs /approve-action ─┤
                           ├── rejected ──► end
                           └── approved (approval row with hash)
                                   │
Hook checks: proposal approved, not expired, current payload hash == approved hash
                                   │
                           Execute write tool
                                   │
                  Verify result (re-read the resource)
                                   │
                  execution_logs (outcome, verification)
```

### ActionProposal

```ts
type ActionProposal = {
  id: string;
  siteId: string;
  actionType: "google_gsc_submit_sitemap" | "yandex_webmaster_add_sitemap"
            | "bing_submit_url" | "google_merchant_update_product";
  target: string;
  description: string;
  proposedPayload: Record<string, unknown>;
  payloadHash: string;          // sha256 of canonical JSON of proposedPayload
  expectedImpact?: string;
  riskLevel: "low" | "medium" | "high";
  status: "pending" | "approved" | "rejected" | "executed" | "failed" | "expired";
  createdAt: string;
  expiresAt: string;            // default: 24 hours after creation
  approvedAt?: string;
  executedAt?: string;
};
```

### Rules

1. Approval is per proposal, per target, per payload. Approval does not carry over to other proposals.
2. If the payload changes after approval, the hash no longer matches and a new proposal and approval are required.
3. Expired proposals cannot be executed.
4. Execution must be idempotent where the API allows it. If not, check the current remote state before executing, and record the check in `execution_logs`.
5. After execution, re-read the remote state and store the verification result. A write is not complete until verified.
6. On failure, do not retry automatically for writes. Record the error and mark the proposal `failed`.
7. Read, analyze, and recommend operations need no approval. Prepare operations create proposals only.

### Risk levels

| Action | Default risk | Notes |
|---|---|---|
| `google_gsc_submit_sitemap` | low | Reversible by resubmitting or removing the sitemap in the console |
| `yandex_webmaster_add_sitemap` | low | Same |
| `bing_submit_url` | low | Quota-limited; check quota before proposing |
| `google_merchant_update_product` | medium | Affects live shopping listings; show a before/after diff in the proposal |

## Hooks

`hooks/hooks.json` registers a pre-tool-use hook on write tool names. `hooks/scripts/validate-approval.sh` receives the tool name and arguments, asks `core` (via a small CLI) whether an approved, unexpired proposal exists with a matching payload hash, and blocks the call if not.

The hook must fail closed: if the check cannot run, the write is blocked.

## Crawler and fetch policy

- Respect robots.txt for every host, including AI user agents used only for checks (the crawler's own UA is separate and identifiable).
- Per-host rate limit: default 1 request per second, configurable downward only without confirmation.
- Identifiable User-Agent with a contact URL placeholder from config.
- No authentication bypass, no form submission, no CAPTCHA handling.
- Raw HTML storage is off by default.

## Data retention

- Observations: kept indefinitely by default; a retention setting can prune by age later.
- Raw crawl HTML: off by default; if enabled, pruned after 30 days.
- API cache: TTL per source, default 24 hours for analytics, 7 days for static resources.
- Credentials: removed from the keychain via `scripts/` command when a connection is deleted.

## Output and privacy

- Reports must not include secrets, raw tokens, or full service account details.
- Reports may include site URLs and aggregated analytics. Do not include individual user data from GA4 or Metrica; query aggregates only.

## Evaluation gates

Before a report is written:
- Every finding has at least one evidence row.
- Confidence labels match evidence strength (`low` when only inferred, `high` only for direct observations with stated date ranges).
- Missing sources are listed in the report.
- Lab and field data are not mixed in any table or output.