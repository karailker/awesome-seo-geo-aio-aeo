---
name: sitemap-reconciliation
description: Compares the URLs in the sitemap with the pages that Search Console has data for in one period, and lists URLs present in one and not the other. Use in SEO audits after sitemap discovery and Search Console collection.
---

## Purpose
Show which sitemap URLs have no page data in the period from each search source (Search Console, Bing Webmaster, Yandex Webmaster), and which source pages are not in the sitemap.

## When to use
- After `/sitemap-sync` and a Search Console page pull.
- Not for: fixing the sitemap.

## Inputs
- `origin`, `start`, `end`.
- Sitemap pages ingested into `pages` with `source='sitemap'`.
- Search Console page rows for the period.

## Tools
- `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo sitemap-ingest` (sitemap) and `npx -y -p @karailker/awesome-seo-core@0.2 awesome-seo seo-audit` (Search Console plus the report).

## Method
- Both sides are normalized with `normalizeUrl` (fragment removed, absolute http(s) only).
- Range sources (Search Console, Bing): a page counts if its observation period overlaps the report period.
- Yandex: a snapshot of pages in search on the collection date. The report states that date.
- "Sitemap only": in the sitemap, no page data from that source.
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
