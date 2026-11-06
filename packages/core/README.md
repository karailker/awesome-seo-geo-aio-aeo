# @karailker/awesome-seo-core

Shared core for the awesome-seo Claude Code plugin (version 0.2.3, MIT): SQLite store (WAL, foreign keys), Drizzle schema and versioned migrations, ingest for sitemap, crawl, AI crawler access, Search Console, GA4, Bing, Yandex Metrica and Webmaster snapshots, evidence-gated reports, and the write-approval engine.

Used by the MCP servers (`@karailker/awesome-seo-mcp-*`). Repository: https://github.com/karailker/awesome-seo-geo-aio-aeo

## CLI

Run with `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo <command>` from the project folder. The database is `./data/awesome-seo.sqlite` unless `AWESOME_SEO_DB` is set.

| Command | Purpose |
|---|---|
| `migrate` | Create or upgrade the schema (current version 3) |
| `seed --origin <url>` | Register the site (canonical origin, sitemap URL, URL cap) |
| `sitemap-ingest --origin <url> <file.jsonl>` | Store sitemap URLs (idempotent) |
| `crawl-ingest --origin <url> <file.jsonl>` | Store one crawl run |
| `access-ingest --origin <url> <access.json>` | Store a saved `crawl_check_access` result (idempotent) |
| `seo-audit`, `geo-audit` | Markdown reports. `geo-audit --access <file>` also stores the access result |
| `technical-audit --origin <url> [--run <id>]` | Markdown technical report for a crawl run: counts, redirects, canonical, titles, hreflang, headings |
| `approval ...` | Write approval flow used by the hook and `/approve-action` |

Errors go to stderr with exit code 1. `geo-audit` needs a crawl run for the site first.
