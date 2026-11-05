---
description: Fetch the seeded site's discovered URLs with the crawl MCP (robots.txt, redirects, extraction) and ingest the run into crawl_runs and crawl_results. Read-only on the site.
argument-hint: "[url-cap, default 500]"
---

Crawl the seeded site's URLs. Read-only. The site gets one request per second per host, identifiable User-Agent, and robots.txt is checked at every redirect hop. A 500-URL run takes about 10 minutes, so say so before starting.

1. Run `pnpm db:migrate` so the crawl tables exist.
2. Find the site: the origin printed by `pnpm db:seed`. If it is not seeded, stop and tell the user to run `pnpm db:seed --origin <origin>` first.
3. Input: the latest discovery file from `/sitemap-sync` under `data/snapshots/` (for example `snapshots/sitemap-<timestamp>.jsonl`). If none exists, stop and tell the user to run `/sitemap-sync` first.
4. URL cap: `$ARGUMENTS` if it is a number, otherwise the site's `url_cap` (default 500).
5. Call `mcp__plugin_awesome-seo_crawl__crawl_fetch_pages` with:
   - `input_path`: the snapshot path relative to `data/`
   - `output_path`: `crawl/<host>-<UTC timestamp>.jsonl`
   - `url_cap`: from step 4
   - `store_raw_html`: false (default; only change it if the user asks)
6. If the result has `ok: false`, report the errors and stop. Do not ingest.
7. Otherwise run `pnpm crawl:ingest --origin <origin> data/<output_path>`. The script skips a run that is already stored.
8. Report what the tools returned: run id, URL count, ok, robots-blocked, and error counts, and the error codes (`ROBOTS_DISALLOWED`, `NOT_FOUND`, `HTTP_ERROR`, `TIMEOUT`, `ROBOTS_UNAVAILABLE`, `NOT_HTML`, `EXTRACT_FAILED`, `TOO_MANY_REDIRECTS`). Do not claim a page's status that the run did not record. A robots-blocked page is "not fetched", not "missing".
