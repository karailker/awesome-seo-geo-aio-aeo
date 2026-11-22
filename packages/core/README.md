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
| `render-urls --origin <url> [--run <id>] [--out <file>]` | Write the pages of a run that returned no text (likely built by JavaScript) as crawl input for a `render: true` crawl |
| `crawl-merge --base <file> --patch <file> --out <file> --run-id <id>` | Fold a rendered crawl into a base crawl file; the result is one new run to `crawl-ingest` |
| `diff --origin <url> --from <run> --to <run>` or `--sitemap-old <f> --sitemap-new <f>` | Change report between two crawl runs or two sitemap snapshots |
| `audit --origin <url> [--mode quick\|deep] [--start D --end D] [--run <id> ...] [--access f] [--gsc f] [--ga4 f] [--metrica f] [--bing f] [--yandex f]` | One report for the whole site: a ranked Needs attention list, one Missing data list, then the technical, GEO / AIO / AEO and SEO reports. Without a period the search part is reported as missing |
| `config [--file awesome-seo.json]` / `config --init --origin <url>` | Validate and print the project settings (source identifiers, no secrets), or write a template |
| `approval ...` | Write approval flow used by the hook and `/approve-action` |

Errors go to stderr with exit code 1. `geo-audit` needs a crawl run for the site first.
