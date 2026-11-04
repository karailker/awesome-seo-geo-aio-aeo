# MCP servers and tools

## Servers

| Server | Language | Sources | Write tools |
|---|---|---|---|
| `google` | TypeScript | Search Console, GA4, Merchant Center | `gsc_submit_sitemap`, `merchant_update_product` |
| `yandex` | TypeScript | Yandex Webmaster, Yandex Metrica | `yandex_webmaster_add_sitemap` |
| `bing` | TypeScript | Bing Webmaster Tools | `bing_submit_url` |
| `performance` | TypeScript | PageSpeed Insights, local Lighthouse, CrUX | none |
| `crawl` | Python (FastMCP) | Sitemap, live HTTP fetch, HTML analysis | none |

Every server exposes:
- `<prefix>_health`: process status and configuration presence (never returns secret values)
- `<prefix>_capabilities`: list of tools, which are read or write, and which credentials each tool needs

Prefixes: `google`, `yandex`, `bing`, `performance`, `crawl`. Tool names use `<source>_<action>` in snake_case.

## Response envelope

All data tools return this shape (TypeScript type in `packages/core`, mirrored in Python as a Pydantic model):

```ts
type ToolResult<T> = {
  ok: boolean;
  data?: T;
  source: string;            // e.g. "gsc", "ga4", "psi", "lighthouse-local", "crawl"
  collectedAt: string;       // ISO 8601, UTC
  period?: { start: string; end: string }; // ISO dates, when applicable
  warnings: string[];        // e.g. "data delayed by 2 days", "row limit reached"
  errors: { code: string; message: string; retryable: boolean }[];
};
```

Errors use stable codes: `AUTH_MISSING`, `AUTH_EXPIRED`, `PERMISSION_DENIED`, `QUOTA_EXCEEDED`, `NOT_FOUND`, `RATE_LIMITED`, `UPSTREAM_ERROR`, `INVALID_INPUT`, `TIMEOUT`.

## Google server

| Tool | Input (summary) | Output (summary) | VERIFY |
|---|---|---|---|
| `google_gsc_list_properties` | none | properties and permission level | service account access |
| `google_gsc_search_analytics` | property, date range, dimensions (query, page, country, device, searchAppearance), filters, row limit | rows with clicks, impressions, CTR, position | data retention, row limits |
| `google_gsc_inspect_url` | property, URL | index status, canonical, crawl info | daily and per-minute quotas |
| `google_gsc_list_sitemaps` | property | sitemaps and status | |
| `google_ga4_run_report` | property ID, date range, dimensions, metrics, filters | rows | |
| `google_ga4_get_metadata` | property ID | available dimensions and metrics | |
| `google_merchant_list_products` | account, page size | products | Merchant API version |
| `google_merchant_list_product_issues` | account, product filter | issues grouped by type | Merchant API version |
| `google_gsc_submit_sitemap` *(write)* | property, sitemap URL | status | requires approval |
| `google_merchant_update_product` *(write)* | account, product ID, fields | updated product | requires approval |

Note: tool names above use the `google_` prefix for all Google tools. Use this naming consistently.

## Yandex server

| Tool | Input (summary) | Output (summary) | VERIFY |
|---|---|---|---|
| `yandex_webmaster_host_summary` | host ID | indexing summary, SQI, errors | endpoint version |
| `yandex_webmaster_search_queries` | host ID, date range, order, paging | queries with impressions, clicks, positions | |
| `yandex_webmaster_indexing` | host ID, paging | indexing samples and status | |
| `yandex_metrica_report` | counter ID, date range, metrics, dimensions, filters | rows | |
| `yandex_webmaster_add_sitemap` *(write)* | host ID, sitemap URL | status | requires approval |

## Bing server

| Tool | Input (summary) | Output (summary) | VERIFY |
|---|---|---|---|
| `bing_search_stats` | site URL, date range | impressions, clicks, CTR, position over time | API key scope |
| `bing_page_stats` | site URL, page URL or list | per-page stats | |
| `bing_url_info` | site URL, page URL | crawl and index info | |
| `bing_submit_url` *(write)* | site URL, page URL | submission status | daily quota; requires approval |

## Performance server

| Tool | Input (summary) | Output (summary) | VERIFY |
|---|---|---|---|
| `performance_psi_run` | URL, strategy (mobile/desktop), categories | `lab_*` metrics, `field_*` metrics, opportunities | PSI daily quota |
| `performance_lighthouse_local_run` | URL, strategy, throttling preset | `lab_*` metrics, opportunities; `source: "lighthouse-local"` | requires local Chrome |
| `performance_crux_query` | origin or URL, form factor, metrics | `field_*` metrics with percentiles | endpoint and rate limits |

Lab and field fields are always separate. Example field names: `lab_lcp_ms`, `field_lcp_p75_ms`.

## Crawl server (Python)

| Tool | Input (summary) | Output (summary) |
|---|---|---|
| `crawl_discover_sitemap` | sitemap URL, URL cap | URLs with `lastmod`, child sitemap errors |
| `crawl_fetch_pages` | URL list, concurrency per host, timeout, output path | JSONL path, counts, errors |
| `crawl_extract_structured_data` | JSONL path or URL | structured data per URL |
| `crawl_check_access` | site root, sample URLs | robots rules per AI user agent, `llms.txt` status |

Crawl JSONL record (one line per URL):

```json
{
  "run_id": "2026-11-04T18:00:00Z-a1b2",
  "url": "https://example.com/page",
  "fetched_at": "2026-11-04T18:00:02Z",
  "status": 200,
  "final_url": "https://example.com/page/",
  "redirect_chain": [],
  "content_type": "text/html",
  "title": "...",
  "meta_description": "...",
  "canonical": "...",
  "lang": "en",
  "hreflang": [],
  "headings": [{"level": 1, "text": "..."}],
  "word_count": 812,
  "content_hash": "sha256:...",
  "structured_data": [],
  "robots_allowed": true,
  "errors": []
}
```

## Adding a new tool

1. Confirm it fits an existing server and has one responsibility.
2. Add input and output Zod schemas (TypeScript) or Pydantic models (Python).
3. Classify it as read or write. Write tools must be listed in `docs/SECURITY-AND-APPROVAL.md` and go through the approval engine.
4. Add fixture tests.
5. Add it to this file.