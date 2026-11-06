# MCP servers and tools

Status: implemented as of 2026-11-05. Tool names are `<prefix>_<action>`. In Claude Code they appear as `mcp__plugin_awesome-seo_<server>__<tool>`.

## Servers

| Server | Language | Sources | Write tools |
|---|---|---|---|
| `google` | TypeScript | Search Console, GA4 Data API, Merchant API (code only, deferred) | `google_gsc_submit_sitemap` |
| `yandex` | TypeScript | Yandex Metrica Stat API, Yandex Webmaster API v4 | `yandex_webmaster_add_sitemap` |
| `bing` | TypeScript | Bing Webmaster API | `bing_submit_url` |
| `performance` | TypeScript | PageSpeed Insights, CrUX API, local Lighthouse | none |
| `crawl` | Python (FastMCP) | Sitemap discovery, page fetching, extraction, AI access check | none |

Every server exposes `<prefix>_health` (credential presence only, never values) and `<prefix>_capabilities` (tools, read or write, and the credentials each needs).

Write tools are blocked unless an approved proposal exists for the exact payload. The PreToolUse hook (`hooks/scripts/validate-approval.sh`) checks this before each call. See `docs/SECURITY-AND-APPROVAL.md`.

## Response envelope

All data tools return:

```ts
type ToolResult<T> = {
  ok: boolean;
  data?: T;
  source: string;            // "gsc", "ga4", "bing", "psi", "crux", "lighthouse-local", "crawl", "yandex_metrica", "yandex_webmaster", ...
  collectedAt: string;       // ISO 8601, UTC
  period?: { start: string; end: string };
  warnings: string[];
  errors: { code: string; message: string; retryable: boolean }[];
};
```

Write tools also return `startedAt` and `finishedAt` (the API call's own times). The approval record uses them.

Error codes: `AUTH_MISSING`, `AUTH_EXPIRED`, `PERMISSION_DENIED`, `QUOTA_EXCEEDED`, `NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `INVALID_INPUT`, `TIMEOUT`.

Data tools that write files take `output_path`, relative to the data directory (`AWESOME_SEO_DATA_DIR`, default `./data`). The path must stay inside that directory and end in `.jsonl`.

## Google server

| Tool | Input (summary) | Notes |
|---|---|---|
| `google_gsc_list_properties` | none | Search Console properties and permission level. |
| `google_gsc_search_analytics` | `site`, `start_date`, `end_date`, `dimensions` (page, query, country, device), `row_limit` ≤ 25000, `output_path` | JSONL. Delay warning. VERIFY: row limit. |
| `google_gsc_inspect_url` | `site`, `url` | URL Inspection. VERIFY: 2000 per property per day, 600 per minute. Not called live yet. |
| `google_gsc_list_sitemaps` | `site` | Sitemaps with status. |
| `google_gsc_submit_sitemap` *(write)* | `site`, `feedpath` | Webmasters scope. Verified live (2026-11-05). |
| `google_ga4_get_metadata` | `property_id` | Dimension and metric names. |
| `google_ga4_run_report` | `property_id`, `start_date`, `end_date`, `dimensions`, `metrics`, `limit` ≤ 100000, `output_path` | JSONL. User and session identifiers are refused. |
| `google_merchant_list_products` | `account?`, `page_size` ≤ 250 | Deferred (P9): the site sells no products. Code only. |
| `google_merchant_list_product_issues` | `account?`, `page_size` ≤ 250 | Deferred (P9). Issues grouped by code. |

## Yandex server

| Tool | Input (summary) | Notes |
|---|---|---|
| `yandex_metrica_report` | `counter_id?`, `date1`, `date2`, `metrics`, `dimensions`, `limit`, `output_path?` | Aggregated only; visitor dimensions refused. Sampling and row-limit warnings. Verified live. |
| `yandex_webmaster_hosts` | none | Hosts and verification state. |
| `yandex_webmaster_host_summary` | `host_id` | SQI, searchable and excluded page counts. |
| `yandex_webmaster_search_queries` | `host_id`, `limit` | Popular queries by shows. |
| `yandex_webmaster_indexing` | `host_id` | In-search history, sitemaps with error counts, recrawl quota. |
| `yandex_webmaster_in_search_urls` | `host_id`, `output_path?` | Per-URL in-search samples (snapshot). JSONL for core ingest. |
| `yandex_webmaster_add_sitemap` *(write)* | `host_id`, `sitemap_url` | POST to the host's sitemaps path. Live attempt on 2026-11-05 returned 405 (host write route closed); Yandex Webmaster was read-only during an incident. Retry later. |

## Bing server

| Tool | Input (summary) | Notes |
|---|---|---|
| `bing_search_stats` | `site`, `start_date?`, `end_date?`, `output_path?` | Daily impressions and clicks (Rank and Traffic). |
| `bing_page_stats` | `site`, `output_path?` | Per-page, per-day stats. Page URLs are `www`, as in the sitemap. |
| `bing_url_info` | `site`, `url` | Crawl and discovery dates, HTTP status. |
| `bing_submit_url` *(write)* | `site`, `url` | POST SubmitUrl with a JSON body. Daily quota (VERIFY). Acceptance is only confirmed when the response is an explicit `true` or a later check shows it. |

## Performance server

| Tool | Input (summary) | Notes |
|---|---|---|
| `performance_psi_run` | `url`, `strategy` (mobile, desktop), `fallback_local` (default true) | Lab values (`lab_*`) and field values (`field_*`) in separate fields, plus opportunities. If PSI fails, the local Lighthouse run is used (`source: lighthouse-local`) and the PSI error goes into `warnings`. VERIFY: PSI quota. |
| `performance_lighthouse_local_run` | `url`, `strategy` | Local Chrome run. Lab values only. |
| `performance_crux_query` | `origin` or `url`, `form_factor?` | `field_*` p75 values only. 404 means "not in dataset", reported as null, not zero. |

## Crawl server (Python)

| Tool | Input (summary) | Notes |
|---|---|---|
| `crawl_discover_sitemap` | `sitemap_url`, `output_path`, `url_cap` (default 500) | Index and gzip sitemaps. robots.txt checked; unreadable robots fails closed. |
| `crawl_fetch_pages` | `input_path` (discovery JSONL), `output_path`, `url_cap`, `store_raw_html` (default false), `render` (default false) | Redirect chain, robots check on each hop, 1 request per second per host, retries on 5xx and timeouts. `render=true` loads each page in headless Chrome (system binary, `CHROME_PATH`) and extracts the DOM after scripts ran. Images are not loaded. Chrome still requests the page's scripts, styles and fonts; the per-host limit does not cover those, and the result carries a warning saying so. |
| `crawl_extract_structured_data` | `url`, `render` (default false) | One page: on-page fields, headings, content hash, JSON-LD, microdata, RDFa, invalid JSON-LD count. `render=true` extracts the rendered DOM. Nothing written. |
| `crawl_check_access` | `site_root`, `sample_urls` (up to 200) | Robots rules for AI user agents on the samples, and llms.txt. Unknown when robots is unreadable. VERIFY: agent tokens. |

Crawl record fields (one JSON line per URL): `run_id`, `url`, `fetched_at`, `status`, `final_url`, `redirect_chain`, `content_type`, `title`, `meta_description`, `canonical`, `lang`, `hreflang`, `headings`, `word_count`, `content_hash`, `structured_data`, `jsonld_syntax_errors`, `robots_allowed` (true, false, or null for unknown), `rendered` (true when the DOM came from headless Chrome, which `render=true` requests; false otherwise), `raw_html_path`, `errors` (a failed render adds `RENDER_FAILED` and keeps the static HTML).

## Adding a new tool

1. Confirm it fits an existing server and has one responsibility.
2. Add input and output schemas (Zod in TypeScript, Pydantic or typed dicts in Python).
3. Classify it as read or write. Write tools must go through the approval gate: add the action to `ACTION_RISK` in `packages/core/src/approval/engine.ts`, the tool-name mapping `TOOL_ACTIONS` in `packages/core/src/cli.ts`, and the matcher in `hooks/hooks.json`. The matcher uses the plugin tool names (`mcp__plugin_awesome-seo_<server>__<tool>`); a server declared outside the plugin gets a different name and is not gated.
4. Add fixture-based tests. Live checks are fine when they are read-only.
5. Add it to this file.
