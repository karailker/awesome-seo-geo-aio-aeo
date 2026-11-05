# STATUS

Date: 2026-11-05. Phase: P2 complete, P3 next.

## Done

| Phase | Contents |
|---|---|
| P0 | Docs, workspace, plugin manifests, stub MCP servers (`*_health`, `*_capabilities`) |
| P1 | `packages/core`: Drizzle schema (sites, site_properties, connections, pages, observations, api_cache), migration `0000`, store (WAL, foreign keys, busy_timeout, `schema_migrations`), Zod schemas, `normalizeUrl`. Scripts: `db:migrate`, `db:seed` |
| P2 | Crawl MCP `crawl_discover_sitemap`: plain, index, and gzip sitemaps; robots.txt check (fail closed when unreadable); 1 req/s per host; identifiable UA; URL cap (default 500); DTD/ENTITY refused; per-child error tolerance. Writes JSONL under `data/`. Core `ingestSitemapJsonl` upserts `pages` with `source='sitemap'`. Scripts: `sitemap:ingest`. Command: `/sitemap-sync` |

Git: history rewritten on 2026-11-05 to remove `Co-Authored-By` lines from all commit messages. Backup of the pre-rewrite head: local branch `backup/pre-attribution-rewrite`.

## Verified (2026-11-05)

- `pnpm -r build`, `pnpm -r typecheck`, `pnpm -r test` (core: 14 tests)
- `cd mcp-servers/crawl && uv run pytest` (12 tests: 2 health, 10 sitemap)
- `claude plugin validate .`
- End to end: `db:migrate`, `db:seed`, `sitemap:ingest` twice on the fixture JSONL. Page count stays at 3 and all rows have `source='sitemap'`.

Not verified: `/sitemap-sync` run inside a live Claude Code session against a real site. The command is written, but only its ingest and crawler steps are tested.

## Known gaps

- Pages removed from a sitemap are not marked stale. Ingest only adds and updates.
- Sitemap entries on other hosts are skipped, not stored.
- `crawl_discover_sitemap` writes JSONL to `AWESOME_SEO_DATA_DIR`, relative to the working directory. Plugin runs need that directory set.
- P1 "observation normalization helpers" is thin. Extend in P3 when real sources arrive.
- `scripts/*.ts` run through Node type stripping and are not typechecked.
- `.serena/` is git-ignored. `docs/ROADMAP.md` P3 needs Google service account setup before implementation.

## Next: P3 (Search Console vertical slice)

Blocked on setup, not code: a service account key file outside the repo, with access granted on the GSC property. Confirm the property and key location before starting.

## Toolchain

pnpm 12.16.1 (via corepack), uv 0.11.8, Node 24.22.0, Python 3.12, Claude Code 2.1.308. SQLite 3.53.4 (via better-sqlite3 13.0.3).
