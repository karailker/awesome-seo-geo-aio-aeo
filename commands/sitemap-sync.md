---
description: Discover the site's sitemap URLs with the crawl MCP and ingest them into the pages table (idempotent).
argument-hint: "[sitemap-url]"
---

Sync sitemap URLs for the seeded site. Read-only: no approval needed.

1. Make sure the database is current: `pnpm db:migrate`.
2. Find the site. Use the origin and sitemap URL printed by `pnpm db:seed`. If the site is not seeded, stop and tell the user to run `pnpm db:seed --origin <origin>` first.
3. If `$ARGUMENTS` gives a sitemap URL, use it. Otherwise use the site's sitemap URL from step 2.
4. Call the MCP tool `mcp__plugin_awesome-seo_crawl__crawl_discover_sitemap` with:
   - `sitemap_url`: the sitemap URL
   - `output_path`: `snapshots/sitemap-<UTC timestamp, e.g. 20261105T100000Z>.jsonl`
   - `url_cap`: the site's `url_cap` (default 500)
5. If the result has `ok: false`, report the errors and stop. Do not ingest.
6. Otherwise run `pnpm sitemap:ingest --origin <origin> data/<output_path>`. The JSONL path is under the data directory (`data/`).
7. Report what the tool and the ingest actually returned: URL count, sitemap count, skipped lines, every error and warning code. Do not infer values for sitemaps that failed. If a child sitemap failed, say which one.

Running it again with the same sitemap is safe: pages are keyed by site and URL, so only `lastmod` and `last_seen_at` change.
