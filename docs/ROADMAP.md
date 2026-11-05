# Roadmap

Status: **Current phase: P9 (in progress)** (P0 complete 2026-11-04; P1 complete 2026-11-05; P2 complete 2026-11-05; P3 complete 2026-11-05; P4 complete 2026-11-05; P5 complete 2026-11-05 with CrUX live; P6 complete 2026-11-05 with two skills deferred; P7 complete 2026-11-05: Metrica and GA4 live, AI referral traffic; P8 complete 2026-11-05 (P9 started: Merchant API code written, live check blocked): Bing and Yandex Webmaster live; reconciliation across Search Console, Bing, and Yandex (Yandex as a snapshot from the in-search samples); Yandex host not ownership-verified, so its data may be partial)

Update the status line when a phase is complete. Phases are sequential unless noted.

## P0: Scaffold ✅

Deliverables:
- Root `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.workspace.ts`
- `.claude-plugin/plugin.json`, `.mcp.json` (entries for all MCP servers, even if stubs)
- `mcp-servers/crawl/pyproject.toml` (uv) with FastMCP
- Stub MCP servers for google, yandex, bing, performance, crawl, each exposing `*_health` and `*_capabilities`
- `packages/core` with an empty exported module and one test
- `.gitignore`, `.env.example` (variable names only), `README.md`
- `CLAUDE.md` commands section filled in with real commands

Done when:
- `pnpm install`, `pnpm -r build`, `pnpm -r test` succeed
- `cd mcp-servers/crawl && uv run pytest` succeeds
- The plugin loads in Claude Code and all MCP servers start
- Calling `*_health` on each server returns OK

## P1: Core and SQLite ✅

Deliverables:
- Drizzle schema and versioned migrations for: `sites`, `site_properties`, `connections`, `pages`, `observations`, `api_cache`, `schema_migrations`
- Store service with WAL mode, foreign keys on, transaction helpers
- Zod schemas for `Observation`, `Page`, `Site`
- Observation normalization helpers
- `scripts/migrate.ts`
- Seed script that creates the single site from config

Done when:
- Migrations apply to an empty DB and are idempotent
- Store tests cover insert, upsert, foreign key enforcement, and transaction rollback

## P2: Sitemap discovery ✅

Deliverables:
- `crawl_discover_sitemap` tool: resolves sitemap index recursively, returns URLs with `lastmod`, enforces the URL cap, records errors
- `core` ingest of discovered URLs into `pages` with `source='sitemap'`
- `/sitemap-sync` command

Done when:
- Fixture-based tests cover: plain sitemap, sitemap index, gzip sitemap, malformed XML, unreachable child sitemap
- `/sitemap-sync` on fixtures updates `pages` correctly and is idempotent

## P3: Search Console vertical slice ✅

Verification notes (2026-11-05): fixtures cover auth, client, tools, ingest, reconciliation, report, and the evidence gate. Live: `sites.list`, `sitemaps`, and `searchAnalytics` (page and query dimensions) run against `sc-domain:bulmacalig.com` with read-only scope. Not verified: URL Inspection (not called live). VERIFY: URL Inspection quota is 2000 requests per property per day and 600 per minute; the searchAnalytics row limit is 25000 per request; the data delay is typically 2-3 days. All three come from the public docs and need re-checking before reliance.

Deliverables:
- `google` MCP: `google_gsc_list_properties`, `google_gsc_search_analytics`, `google_gsc_inspect_url`, `google_gsc_list_sitemaps`
- Auth via service account (credential reference in SQLite, key file outside the repo)
- `search-analyst` agent
- Skills: `seo/technical-audit`, `seo/indexation-analysis`, `seo/query-analysis`, `seo/sitemap-reconciliation`
- `intelligence/evidence-validation`, `intelligence/report-generation`
- `evidence-auditor` agent
- `/seo-audit` command (search-only scope for now)

Done when:
- `/seo-audit` on recorded GSC fixtures produces a report where every finding cites observations
- Sitemap vs. GSC reconciliation identifies URLs present in one and not the other
- Missing GSC access produces an explicit "not available" section, not an error or a guess
- `VERIFY:` notes exist for URL Inspection quotas

## P4: Full crawler ✅

Verification notes (2026-11-05): crawler tests (36) run against a local HTTP server in `tests/conftest.py`, with no external network. Live: five sitemap URLs of `www.bulmacalig.com` were crawled (5 of 5 status 200, robots allowed) and ingested. Not done in P4: the `seo-audit` report does not yet use crawl data. The `technical-audit` skill is written, but its report section is not implemented.

Deliverables:
- `crawl_fetch_pages`: robots.txt compliance, per-host rate limit, identifiable UA, timeout and retry policy, JSONL output, optional gzipped raw HTML (off by default)
- `crawl_extract_structured_data`: JSON-LD, microdata, RDFa via extruct; title, meta description, canonical, hreflang, `lang`, heading outline, word count, content hash
- `crawl_check_access`: robots rules for GPTBot, ClaudeBot, PerplexityBot, Google-Extended, CCBot, and other known AI user agents; `llms.txt` presence and basic validity
- `core` ingest of crawl JSONL into `crawl_runs` and `crawl_results`
- `/crawl-run` command

Done when:
- Local test HTTP server fixtures cover: robots disallow, redirect chains, 404/500, JSON-LD and microdata, missing canonical, duplicate titles
- Crawler never exceeds the per-host rate limit in tests
- Two runs of the same fixture produce identical content hashes

## P5: Performance ✅

Verification notes (2026-11-05): PSI, local Lighthouse, and the PSI-to-local fallback are verified live. CrUX is verified live: the key's API restriction was fixed by the user, and a real high-traffic origin (`https://web.dev`) returned field metrics that match the mapper; the fixture is a recorded response. `/perf-audit` was run end to end on 5 sampled URLs and produced a report in `data/reports/` (CrUX: no data for bulmacalig.com, low traffic).

Deliverables:
- `performance_psi_run`: PageSpeed Insights API, returns lab and field data separately
- `performance_lighthouse_local_run`: local fallback, triggered when PSI fails, quota is exhausted, or the user requests it; output tagged `source: "lighthouse-local"`
- `performance_crux_query`: origin-level field data
- `performance-analyst` agent and `performance/cwv-diagnosis` skill
- `/perf-audit` command

Done when:
- Fallback test: simulated PSI failure triggers local path and correct `source` tagging
- Lab and field fields never share a name
- `VERIFY:` notes for PSI quota and CrUX endpoints

## P6: GEO, AIO, AEO ✅ (two deliverable skills deferred)

Verification notes (2026-11-05): `pnpm geo:audit` run end to end on the live crawl of `www.bulmacalig.com` (5 URLs) with a live `crawl_check_access` result (10 AI user agents, all allowed; llms.txt valid). Core tests (8) cover measured derivation, idempotency, robots-unknown handling, access ingest, and the report sections. Deferred: `geo/entity-consistency` and `aeo/faq-quality` skills and their checks (not implemented in this version; the report says so).

Deliverables:
- `visibility-analyst` agent
- Skills: `geo/citation-readiness`, `geo/entity-consistency`, `aio/crawler-access`, `aio/machine-readable-content`, `aio/source-attribution`, `aeo/answer-coverage`, `aeo/structured-data-validation`, `aeo/faq-quality`
- Commands: `/geo-audit`, `/aio-audit`, `/aeo-audit`

Done when:
- Each command's report separates what is measured from what is inferred
- Crawler access findings cite the robots rules and the sampled URLs
- Structured data validation distinguishes syntax errors from missing recommended properties

## P7: Analytics ✅

Deliverables:
- `google_ga4_run_report`, `google_ga4_get_metadata` in the google MCP
- `yandex_metrica_report` in the yandex MCP
- `traffic-analyst` agent
- Skills: `analytics/organic-attribution`, `analytics/ai-referral-traffic`
- Included in `/seo-audit` when connections exist

Done when:
- AI referral sources are classified by a documented source list in `knowledge/`
- Traffic findings cite GA4 or Metrica observations with the date range stated

## P8: Bing and Yandex Webmaster ✅

Deliverables:
- `bing_search_stats`, `bing_page_stats`, `bing_url_info`
- `yandex_webmaster_host_summary`, `yandex_webmaster_search_queries`, `yandex_webmaster_indexing`
- Integrated into `search-analyst` and `sitemap-reconciliation`

Done when:
- Reconciliation works across all three search sources
- Each source's quota and endpoint version is marked `VERIFY:`

## P9: Merchant Center (in progress: blocked on Merchant Center account link)

Deliverables:
- `google_merchant_list_products`, `google_merchant_list_product_issues`
- Skill: `ecommerce/merchant-feed-health`
- Included in `/ecommerce-audit` (add this command in this phase)

Done when:
- Product issues are grouped by type and linked to product IDs and affected URLs when available
- `VERIFY:` the current Merchant API version and migration status

## P10: Approval engine and write tools

Deliverables:
- `action_proposals`, `approvals`, `execution_logs` tables
- `core` approval engine: create proposal, compute payload hash, approve, verify hash before execution, expire
- `hooks/hooks.json` and `hooks/scripts/validate-approval.sh` for pre-tool-use checks on write tools
- Write tools: `google_gsc_submit_sitemap`, `yandex_webmaster_add_sitemap`, `bing_submit_url`, `google_merchant_update_product`
- `/approve-action` command

Done when:
- A write tool called without an approved proposal is blocked (tested)
- Changing the payload after approval blocks execution (tested)
- Expired proposals cannot execute (tested)
- Execution result is verified and logged

## P11: Evaluation

Deliverables:
- Golden dataset: a test site with known issues and expected findings, stored under `tests/evaluation/`
- Evaluation runner that compares findings to expected results and reports precision and recall per category
- Reproducibility check: same fixtures, same findings
- Evidence coverage check: fails if any finding lacks evidence

Done when:
- Evaluation runs in CI-less local mode with one command
- Thresholds are documented in `docs/SECURITY-AND-APPROVAL.md` or a new `docs/EVALUATION.md`

## P12: Reporting and polish

Deliverables:
- `intelligence/opportunity-scoring` and a documented scoring method in `docs/SCORING.md`
- `/connections-check` command
- Report templates in English with sections: scope, data sources and date ranges, missing data, findings with evidence, opportunities, limitations
- README with setup instructions for each credential type

Done when:
- A full run (`/seo-audit`, `/geo-audit`, `/aio-audit`, `/aeo-audit`, `/perf-audit`) on the test site produces reports without manual fixes
- README setup can be followed by a new user without help