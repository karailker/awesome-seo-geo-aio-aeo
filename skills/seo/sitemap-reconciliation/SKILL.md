---
name: sitemap-reconciliation
description: Compares the URLs in the sitemap with the pages that Search Console has data for in one period, and lists URLs present in one and not the other. Use in SEO audits after sitemap discovery and Search Console collection.
---

## Purpose
Show which sitemap URLs have no Search Console page data in the period, and which Search Console pages are not in the sitemap.

## When to use
- After `/sitemap-sync` and a Search Console page pull.
- Not for: Bing or Yandex URL sets (P8), or fixing the sitemap.

## Inputs
- `origin`, `start`, `end`.
- Sitemap pages ingested into `pages` with `source='sitemap'`.
- Search Console page rows for the period.

## Tools
- `pnpm sitemap:ingest` (sitemap) and `pnpm seo:audit` (Search Console plus the report).

## Method
- Both sides are normalized with `normalizeUrl` (fragment removed, absolute http(s) only).
- "Sitemap only": in the sitemap, no Search Console page row for the period.
- "Search Console only": Search Console page row, not in the sitemap.
- Hosts matter. `www.` and apex hosts are different URLs. Report them as found, and do not merge them.

## Evidence rules
- These are reconciliation facts, not findings. They are listed with counts. They are not findings and need no evidence ids.

## Output schema
The `## Sitemap and Search Console reconciliation` section of the report.

## Quality checks
- Sitemap count and Search Console page count are both stated.
- Lists are capped at 20 entries, with the remaining count stated.

## Missing and failed data
- Sitemap not ingested: say so and show no sitemap-only list.
- No Search Console page rows: say "Not available". Do not treat every sitemap URL as missing.
