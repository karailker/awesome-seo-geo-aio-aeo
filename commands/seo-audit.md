---
description: Search Console and sitemap audit for one period. Every finding cites observations; no evidence, no finding.
argument-hint: "<origin> <start YYYY-MM-DD> <end YYYY-MM-DD>"
---

Run the search-only SEO audit for `$ARGUMENTS`. Read-only: no approval needed. Source of truth for the rules: `docs/AGENTS-AND-SKILLS.md` and `docs/SECURITY-AND-APPROVAL.md`.

1. Parse `origin`, `start`, `end`. Stop if any is missing or a date is not `YYYY-MM-DD`.
2. Make sure the database is current (`pnpm db:migrate`) and the site is seeded (`pnpm db:seed --origin <origin>`). If not, stop and say so.
3. Pull Search Console data for the period. Use the domain property `sc-domain:<host>` unless the user names another property. Make two calls to `mcp__plugin_awesome-seo_google__google_gsc_search_analytics`:
   - `dimensions: ["page"]`, `output_path: "gsc/<host>-pages-<start>-<end>.jsonl"`
   - `dimensions: ["query"]`, `output_path: "gsc/<host>-queries-<start>-<end>.jsonl"`
   - Both with `start_date`, `end_date`, `row_limit: 25000`.
   If a call returns `AUTH_MISSING`, `PERMISSION_DENIED`, or `NOT_FOUND`, do not stop. Record the error as missing Search Console data and continue. Never fill in values.
4. Make sure sitemap URLs are ingested. If the report later says no sitemap URLs exist, tell the user to run `/sitemap-sync`.
5. Build the report: `mkdir -p data/reports` and then `pnpm seo:audit --origin <origin> --start <start> --end <end> --gsc data/gsc/<file1> --gsc data/gsc/<file2> > data/reports/seo-audit-<host>-<start>-<end>.md`. Pass only the files that were written.
6. Show the user the report path and a short summary: the findings with their counts, the missing data, and the reconciliation counts. Quote the report's own wording. Do not add conclusions the report does not state. Do not claim sitemap or GA4 results that were not collected.
