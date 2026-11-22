# @karailker/awesome-seo-core

Shared core for the awesome-seo Claude Code plugin (version 0.2.6, MIT): SQLite store (WAL, foreign keys), Drizzle schema and versioned migrations, ingest for sitemap, crawl, AI crawler access, Search Console, GA4, Bing, Yandex Metrica and Webmaster snapshots, evidence-gated reports, and the write-approval engine.

Used by the MCP servers (`@karailker/awesome-seo-mcp-*`). Repository: https://github.com/karailker/awesome-seo-geo-aio-aeo

## CLI

Run with `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo <command>` from the project folder. The database is `./data/awesome-seo.sqlite` unless `AWESOME_SEO_DB` is set.

| Command | Purpose |
|---|---|
| `migrate` | Create or upgrade the schema (current version 4) |
| `seed --origin <url>` | Register the site (canonical origin, sitemap URL, URL cap) |
| `sitemap-ingest --origin <url> <file.jsonl>` | Store sitemap URLs (idempotent). `ingested` counts rows written; `created` counts URLs new to the site |
| `crawl-ingest --origin <url> <file.jsonl>` | Store one crawl run |
| `seo-audit`, `geo-audit` | Markdown reports. `geo-audit --access <file>` also stores the access result |
| `technical-audit --origin <url> [--run <id> ...] [--gsc <file.jsonl> ...]` | Markdown technical report: counts, status problems, redirects, canonical, titles, hreflang, headings. Repeat `--run` to report several crawl runs together. `--gsc` adds the Search Console pages the crawl did not check |
| `gsc-urls --origin <url> --gsc <pages.jsonl> [--out <file>]` | Write the Search Console pages that no crawl run fetched as crawl input (`{"url": ...}` lines), for `crawl_fetch_pages` |
| `approval ...` | Write approval flow used by the hook and `/approve-action` |

Errors go to stderr with exit code 1. `geo-audit` needs a crawl run for the site first.
