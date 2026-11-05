# STATUS

Date: 2026-11-05. Phase: P3 complete, P4 next.

## Done

| Phase | Contents |
|---|---|
| P0 | Docs, workspace, plugin manifests, stub MCP servers (`*_health`, `*_capabilities`) |
| P1 | `packages/core`: Drizzle schema (sites, site_properties, connections, pages, observations, api_cache), migration `0000`, store (WAL, foreign keys, busy_timeout, `schema_migrations`), Zod schemas, `normalizeUrl`. Scripts: `db:migrate`, `db:seed` |
| P2 | Crawl MCP `crawl_discover_sitemap`: plain, index, and gzip sitemaps; robots.txt check (fail closed when unreadable); 1 req/s per host; identifiable UA; URL cap (default 500); DTD/ENTITY refused; per-child error tolerance. Core `ingestSitemapJsonl` upserts `pages` with `source='sitemap'`. Scripts: `sitemap:ingest`. Command: `/sitemap-sync` |
| P3 | google MCP: `google_gsc_list_properties`, `google_gsc_search_analytics` (writes JSONL), `google_gsc_inspect_url`, `google_gsc_list_sitemaps`; read-only scope; service account JWT via `node:crypto` (no new dependency). Core: `ingestGscJsonl` (observations, source `gsc`, deterministic ids), `reconcileSitemapWithGsc`, `validateFindings` (evidence gate), `buildSeoAuditReport`. Script: `seo:audit`. Command `/seo-audit`. Agents `search-analyst`, `evidence-auditor`. Skills: query-analysis, sitemap-reconciliation, indexation-analysis, evidence-validation, report-generation |

Git: history rewritten on 2026-11-05 to remove `Co-Authored-By` lines from all commit messages. Backup of the pre-rewrite head: local branch `backup/pre-attribution-rewrite`.

## Verified (2026-11-05)

- `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` (core: 20 tests; google: 11 tests)
- `cd mcp-servers/crawl && uv run pytest` (12 tests)
- `claude plugin validate .`
- google MCP over stdio: all 6 tools register.
- Live, read-only, service account, property `sc-domain:bulmacalig.com`: `sites.list` returns `siteFullUser`; `sitemaps` returns OK; `searchAnalytics` returns 29 page rows and 139 query rows for 2026-09-01 to 2026-10-31. Ingested into a scratch DB, then the report was built end to end. Not stored in the repo.
- Live report found real host mismatch: GSC pages are on `www.bulmacalig.com`, the seeded origin was `https://bulmacalig.com`. Sitemap reconciliation depends on the origin choice.

Not verified:
- `/seo-audit` and `/sitemap-sync` run inside a live Claude Code session. The commands are written; the scripts they call are tested.
- URL Inspection call (`google_gsc_inspect_url`): not called live.
- Quotas and endpoint details: marked `VERIFY:` in code and ROADMAP.

## Known gaps

- Pages removed from a sitemap are not marked stale. Ingest only adds and updates.
- Sitemap entries on other hosts are skipped, not stored.
- Search Console: one page of results per call (25000 rows max, no paging). Add paging when a property exceeds that.
- Search Console has no `technical-audit` skill yet: it depends on the crawl (P4).
- Indexation results are not stored or reported; the skill only uses the tool.
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- The Search Console `site` used by `/seo-audit` is `sc-domain:<host>` by default. There is no `site_properties` seeding yet.
- The OAuth client file the user supplied (`client_secret_2_692837526113-...json`, project_id `bulmacalig`) is not used. It stays in place as the user asked.

## Next: P4 (Full crawler)

Scope from ROADMAP: `crawl_fetch_pages` (robots, rate limit, JSONL), `crawl_extract_structured_data`, `crawl_check_access` (AI user agents, llms.txt), core ingest into `crawl_runs` and `crawl_results`, `/crawl-run`. Needs new Python dependencies (selectolax, extruct). CLAUDE.md requires approval before adding dependencies. The stack list already names them, so confirm before adding.

## Toolchain

pnpm 12.16.1 (via corepack), uv 0.11.8, Node 24.22.0, Python 3.12, Claude Code 2.1.308. SQLite 3.53.4 (via better-sqlite3 13.0.3).
