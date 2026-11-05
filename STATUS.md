# STATUS

Date: 2026-11-05. Phase: P6 complete (two skills deferred), P7 next.

## Done

| Phase | Contents |
|---|---|
| P0 | Docs, workspace, plugin manifests, stub MCP servers (`*_health`, `*_capabilities`) |
| P1 | `packages/core`: Drizzle schema, migration `0000`, store (WAL, foreign keys, busy_timeout, `schema_migrations`), Zod schemas, `normalizeUrl`. Scripts: `db:migrate`, `db:seed` |
| P2 | Crawl MCP `crawl_discover_sitemap`: plain, index, and gzip sitemaps; robots.txt (fail closed); 1 req/s per host; identifiable UA; URL cap; DTD/ENTITY refused. Core `ingestSitemapJsonl`. Script `sitemap:ingest`. Command `/sitemap-sync` |
| P3 | google MCP: `google_gsc_list_properties`, `google_gsc_search_analytics`, `google_gsc_inspect_url`, `google_gsc_list_sitemaps`; read-only scope; service account JWT via `node:crypto`. Core: GSC ingest, sitemap–GSC reconciliation, evidence gate, SEO audit report. Script `seo:audit`. Command `/seo-audit`. Agents `search-analyst`, `evidence-auditor`. Skills: query-analysis, sitemap-reconciliation, indexation-analysis, evidence-validation, report-generation |
| P4 | Crawl MCP: `crawl_fetch_pages` (redirect chain with robots check per hop, retry on 5xx and timeouts, 1 req/s per host, JSONL, optional gzipped raw HTML off by default), `crawl_extract_structured_data` (on-page fields, heading outline, content hash, JSON-LD, microdata, RDFa via extruct), `crawl_check_access` (AI user agents, llms.txt). Core: migration `0001` (`crawl_runs`, `crawl_results`), `ingestCrawlJsonl` (skips a stored run). Script `crawl:ingest`. Command `/crawl-run`. Skill `seo/technical-audit` |
| P5 | performance MCP: `performance_psi_run` (lab_* from Lighthouse, field_* from CrUX p75, kept separate; opportunities; falls back to local Lighthouse when PSI fails, tagged `lighthouse-local`), `performance_crux_query` (field_* only), `performance_lighthouse_local_run` (system Chrome, sandbox on, lab only). Packages approved by user: `lighthouse` 13.6.0, `chrome-launcher` 1.2.2. Command `/perf-audit`. Agent `performance-analyst`. Skill `performance/cwv-diagnosis` |
| P6 | Core: `deriveCrawlObservations` (page metrics from crawl results, source `crawl`, deterministic ids), `ingestAccessReport` (crawl_check_access JSON as observations, unknown robots not recorded), `buildGeoReport` (Measured, Findings labeled measured or inferred, structured data validation with syntax errors and missing recommended properties kept separate, crawler access table, answer coverage counts, evidence gate). Migration `0002` adds `crawl_results.jsonld_syntax_errors`. Script `geo:audit`. Commands `/geo-audit`, `/aio-audit`, `/aeo-audit`. Agent `visibility-analyst`. Skills: geo/citation-readiness, aio/crawler-access, aio/machine-readable-content, aio/source-attribution, aeo/structured-data-validation, aeo/answer-coverage. Deferred: geo/entity-consistency, aeo/faq-quality |

## Verified (2026-11-05)

- P5 (performance): `/perf-audit` run end to end through the MCP server on 5 sampled URLs. Result in `data/reports/perf-audit-www.bulmacalig.com-20261105.md`. PSI works live for all 5. CrUX works live: the key's API restriction was fixed by the user. Field data is "not in dataset" for bulmacalig.com (low traffic). A high-traffic origin (`https://web.dev`) returned real field metrics, and the CrUX fixture is now that recorded response.
- P6 (GEO/AIO/AEO): `pnpm geo:audit` on the live 5-URL crawl and a live `crawl_check_access` result (10 AI user agents allowed, llms.txt valid). Core 35 tests, crawler 37, performance 19, google 11. Build, typecheck, and `claude plugin validate .` pass.
- Bugs found and fixed in this pass:
  - CrUX fallback test was reached through a real Chrome launch. Fixed by disabling fallback in PSI error-envelope tests.
  - PSI returns 400 for an invalid key, so fallback was skipped. The fallback now depends on the URL only.
  - JSON-LD syntax count was read after the script nodes were removed, so it was always 0. Fixed by counting first.
  - `robots_blocked` was 0 for robots-unknown pages. Fixed: stays null.

Not verified:
- `/perf-audit`, `/geo-audit`, `/aio-audit`, `/aeo-audit` run inside a live Claude Code session. The steps were run through the MCP server and the scripts directly.
- Vendor user-agent tokens, the llms.txt rule, the recommended-property lists, and the PSI and CrUX quotas are `VERIFY:` in code.

## Known gaps

- The `seo-audit` report does not use crawl data yet. The `technical-audit` skill describes the report sections, but they are not implemented.
- GEO: entity consistency and FAQ quality are not implemented. The answer-coverage join with Search Console queries is not done.
- P6 checks read author and date from JSON-LD only, not microdata or visible bylines.
- Crawl is sequential: about 1 page per second. No paging for Search Console beyond 25000 rows.
- Pages removed from a sitemap are not marked stale. Ingest only adds and updates.
- Sitemap entries on other hosts are skipped, not stored.
- Search Console site and origin: the seed uses `https://www.bulmacalig.com`, but the Search Console property is the domain property `sc-domain:bulmacalig.com`. No `site_properties` mapping exists yet.
- The crawler's `AWESOME_SEO_CONTACT_URL` is unset in this environment, so the User-Agent contains the placeholder. Set it before a real run.
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- The OAuth client file the user supplied is not used. It stays in place as the user asked.
- Git: old commits `c3d92bd`, `489679a`, `ddbbb52`, `05374db` (pre-rewrite) still appear on GitHub with `Co-Authored-By: Claude Code` trailers. They are not reachable from `main` on the remote. GitHub's contributor API currently lists only `karailker`.

## P7 (2026-11-05): complete

- Yandex Metrica: `yandex_metrica_report` (optional JSONL output), core `ingestMetricaJsonl`, traffic-source visits in the "Traffic (GA4)" section of `seo:audit --metrica`. Live: 396 visits in 6 sources, October 2026.
- GA4: `google_ga4_get_metadata`, `google_ga4_run_report`, core `ingestGa4Jsonl`, AI referral finding. Live: 619 sessions, 14 from chatgpt.com.
- Agent `traffic-analyst`, skills `analytics/organic-attribution` and `analytics/ai-referral-traffic`, `knowledge/ai-referrers.md`.

## P8 (2026-11-05): partial

- Yandex Webmaster (`yandex_webmaster_hosts`, `_host_summary`, `_search_queries`, `_indexing`): verified live against `https:www.bulmacalig.com:443`. The host is NOT ownership-verified in Yandex Webmaster, so summary counts (461 excluded, 29 searchable) and query data may be partial. Indexing history path confirmed; per-URL indexing samples endpoint returns 404 for this host, so per-URL reconciliation with Yandex is not possible yet.
- Bing: not started. Needs a Bing Webmaster API key (`BING_WEBMASTER_API_KEY`, `.env.example`).
- Reconciliation across three sources is not done (depends on Bing and on per-URL Yandex data).

## Next: P8 (Bing Webmaster, reconciliation across three sources)

Scope from ROADMAP: `google_ga4_run_report`, `google_ga4_get_metadata` (google MCP), `yandex_metrica_report` (yandex MCP, which is still a stub), `traffic-analyst` agent, skills `analytics/organic-attribution` and `analytics/ai-referral-traffic` (AI referral source list in `knowledge/`), and inclusion in `/seo-audit` when connections exist. Needs a GA4 property ID and service account access to the property, and a Metrica counter and OAuth token. Confirm both before starting.

## Toolchain

pnpm 12.16.1 (via corepack), uv (Python 3.12.14 pinned for the crawler), Node 24.22.0, Claude Code 2.1.308, Google Chrome 155 at /usr/bin/google-chrome. SQLite 3.53.4 (via better-sqlite3 13.0.3). Crawler: selectolax 1.0.2 (lexbor backend), extruct 0.18.0. Performance: lighthouse 13.6.0, chrome-launcher 1.2.2.
