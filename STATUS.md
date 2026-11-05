# STATUS

Date: 2026-11-05. Phase: P4 complete, P5 next.

## Done

| Phase | Contents |
|---|---|
| P0 | Docs, workspace, plugin manifests, stub MCP servers (`*_health`, `*_capabilities`) |
| P1 | `packages/core`: Drizzle schema, migration `0000`, store (WAL, foreign keys, busy_timeout, `schema_migrations`), Zod schemas, `normalizeUrl`. Scripts: `db:migrate`, `db:seed` |
| P2 | Crawl MCP `crawl_discover_sitemap`: plain, index, and gzip sitemaps; robots.txt (fail closed); 1 req/s per host; identifiable UA; URL cap; DTD/ENTITY refused. Core `ingestSitemapJsonl`. Script `sitemap:ingest`. Command `/sitemap-sync` |
| P3 | google MCP: `google_gsc_list_properties`, `google_gsc_search_analytics`, `google_gsc_inspect_url`, `google_gsc_list_sitemaps`; read-only scope; service account JWT via `node:crypto`. Core: GSC ingest, sitemap–GSC reconciliation, evidence gate, SEO audit report. Script `seo:audit`. Command `/seo-audit`. Agents `search-analyst`, `evidence-auditor`. Skills: query-analysis, sitemap-reconciliation, indexation-analysis, evidence-validation, report-generation |
| P4 | Crawl MCP: `crawl_fetch_pages` (redirect chain with robots check per hop, retry on 5xx and timeouts, 1 req/s per host, JSONL, optional gzipped raw HTML off by default), `crawl_extract_structured_data` (on-page fields, heading outline, content hash, JSON-LD, microdata, RDFa via extruct), `crawl_check_access` (AI user agents, llms.txt). Core: migration `0001` (`crawl_runs`, `crawl_results`), `ingestCrawlJsonl` (skips a stored run). Script `crawl:ingest`. Command `/crawl-run`. Skill `seo/technical-audit` |

## Verified (2026-11-05)

Re-tested everything from P0 to P4 on the current HEAD:
- `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test`: core 27, google 11.
- `cd mcp-servers/crawl && uv run pytest`: 36.
- `claude plugin validate .`: passes with warnings (marketplace install advice only).
- MCP over stdio: crawl exposes 6 tools, google exposes 6 tools.
- CLI chain on a scratch DB: `db:migrate`, `db:seed`, `sitemap:ingest`, `seo:audit` (with live GSC files), `crawl:ingest`.
- Live, read-only: GSC `sites.list`, `sitemaps`, and `searchAnalytics` (page and query) on `sc-domain:bulmacalig.com`.
- Live sitemap discovery on `www.bulmacalig.com`: 3 sitemaps, 500 URLs, cap reached (warning produced).
- Live crawl of 5 URLs on `www.bulmacalig.com`: 5 of 5 status 200, robots allowed, records ingested.

Bugs found and fixed during this pass:
- `Fetcher.allowed` refactor left `origin` undefined, so an unreadable robots.txt raised `NameError`. The tests caught it. Fixed.
- `google_gsc_search_analytics` path errors came back as `UPSTREAM_ERROR`. Fixed to `INVALID_INPUT`.
- Report did not flag a sitemap that hit the URL cap. Fixed; covered by a test.
- Crawl ingest wiped the sitemap `lastmod` when it re-saw a page. Fixed: existing pages keep source and lastmod.

Not verified:
- `/seo-audit`, `/sitemap-sync`, `/crawl-run` run inside a live Claude Code session. The scripts they call are tested.
- URL Inspection (`google_gsc_inspect_url`) was not called live.
- Vendor user-agent tokens (`AI_USER_AGENTS`) and the llms.txt spec are marked `VERIFY:` in code.

## Known gaps

- The `seo-audit` report does not use crawl data yet. The `technical-audit` skill describes the report sections, but they are not implemented.
- Crawl is sequential: about 1 page per second. No paging for Search Console beyond 25000 rows.
- Pages removed from a sitemap are not marked stale. Ingest only adds and updates.
- Sitemap entries on other hosts are skipped, not stored.
- Search Console site and origin: the seed uses `https://www.bulmacalig.com`, but the Search Console property is the domain property `sc-domain:bulmacalig.com`. No `site_properties` mapping exists yet.
- The crawler's `AWESOME_SEO_CONTACT_URL` is unset in this environment, so the User-Agent contains the placeholder. Set it before a real run.
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- The OAuth client file the user supplied is not used. It stays in place as the user asked.
- Git: old commits `c3d92bd`, `489679a`, `ddbbb52`, `05374db` (pre-rewrite) still appear on GitHub with `Co-Authored-By: Claude Code` trailers. They are not reachable from `main` on the remote. GitHub's contributor API currently lists only `karailker`.

## Next: P5 (Performance)

Scope from ROADMAP: `performance_psi_run` (PageSpeed Insights API; lab and field returned separately), `performance_lighthouse_local_run` (fallback, tagged `lighthouse-local`), `performance_crux_query` (origin-level field data), `performance-analyst` agent, `performance/cwv-diagnosis` skill, `/perf-audit`. Needs API keys: `PAGESPEED_API_KEY` and `CRUX_API_KEY`, which are variable names in `.env.example`. Local Lighthouse needs Chrome. Confirm the keys and whether local Chrome is available before starting.

## Toolchain

pnpm 12.16.1 (via corepack), uv (Python 3.12.14 pinned for the crawler), Node 24.22.0, Claude Code 2.1.308. SQLite 3.53.4 (via better-sqlite3 13.0.3). Crawler: selectolax 1.0.2 (lexbor backend), extruct 0.18.0.
